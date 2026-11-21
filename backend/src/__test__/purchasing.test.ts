import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function makeUser(key: string, role: string) {
  const email = `p6-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [`p6-${key}`, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
const post = (path: string, who: string, body: object = {}) =>
  request(app).post(path).set(auth(who)).send(body);

async function ingredient(name: string) {
  const r = await pool.query("insert into ingredients (name, unit) values ($1, 'gram') returning id", [name]);
  return r.rows[0].id as number;
}

async function batchesOf(ingredientId: number) {
  const r = await pool.query(
    'select initial_qty, remaining_qty, unit_cost, expires_at from stock_batches where ingredient_id = $1 order by id',
    [ingredientId]
  );
  return r.rows.map((b) => ({
    initial: Number(b.initial_qty),
    remaining: Number(b.remaining_qty),
    cost: b.unit_cost as number,
    expires: b.expires_at as string,
  }));
}

async function receiveMovements(poId: number) {
  const r = await pool.query(
    `select ingredient_id, qty_change from stock_movements
     where type = 'receive' and ref_type = 'purchase_order' and ref_id = $1 order by ingredient_id`,
    [poId]
  );
  return r.rows.map((m) => ({ ing: m.ingredient_id as number, qty: Number(m.qty_change) }));
}

const newPO = (who = 'store', items?: object[]) =>
  post('/purchase-orders', who, {
    supplier_id: ids.supA,
    items: items ?? [
      { ingredient_id: ids.gula, quantity: 100, unit_cost: 20 },
      { ingredient_id: ids.kopi, quantity: 50, unit_cost: 30 },
    ],
  });

const receiveBody = () => ({
  items: [
    { ingredient_id: ids.gula, expires_at: '2098-01-01' },
    { ingredient_id: ids.kopi, expires_at: '2099-01-01' },
  ],
});

beforeAll(async () => {
  await makeUser('store', 'store_keeper');
  await makeUser('kasir', 'kasir');
  await makeUser('admin', 'admin');
  ids.gula = await ingredient('p6-gula');
  ids.kopi = await ingredient('p6-kopi');
});

afterAll(async () => {
  const ing = [ids.gula, ids.kopi];
  const users = "(select id from users where email like 'p6-%@test.local')";
  await pool.query('delete from stock_movements where ingredient_id = any($1)', [ing]);
  await pool.query('delete from stock_batches where ingredient_id = any($1)', [ing]);
  await pool.query(`delete from purchase_orders where created_by in ${users}`);
  await pool.query("delete from suppliers where name like 'p6-%'");
  await pool.query('delete from ingredients where id = any($1)', [ing]);
  await pool.query("delete from users where email like 'p6-%@test.local'");
  await pool.end();
});

describe('supplier', () => {
  it('kasir tidak boleh mengakses supplier maupun PO (403)', async () => {
    expect((await request(app).get('/suppliers').set(auth('kasir'))).status).toBe(403);
    expect((await newPO('kasir')).status).toBe(403);
  });

  it('membuat, menolak nama dobel, mengubah, dan melihat daftar', async () => {
    const created = await post('/suppliers', 'store', { name: 'p6-supplier-a', phone: '0812' });
    expect(created.status).toBe(201);
    ids.supA = created.body.id;

    expect((await post('/suppliers', 'store', { name: 'p6-supplier-a' })).status).toBe(409);

    const upd = await request(app).put(`/suppliers/${ids.supA}`).set(auth('admin'))
      .send({ name: 'p6-supplier-a', phone: '0899', address: 'Bandung' });
    expect(upd.status).toBe(200);
    expect(upd.body.phone).toBe('0899');

    const list = await request(app).get('/suppliers').set(auth('store'));
    expect(list.body.some((s: any) => s.id === ids.supA)).toBe(true);
  });
});

describe('purchase order', () => {
  let poId = 0;

  it('input tidak valid ditolak', async () => {
    const dup = await newPO('store', [
      { ingredient_id: ids.gula, quantity: 1, unit_cost: 1 },
      { ingredient_id: ids.gula, quantity: 2, unit_cost: 1 },
    ]);
    expect(dup.status).toBe(400);

    const zero = await newPO('store', [{ ingredient_id: ids.gula, quantity: 0, unit_cost: 1 }]);
    expect(zero.status).toBe(400);

    const noSupplier = await post('/purchase-orders', 'store', {
      supplier_id: 999999999,
      items: [{ ingredient_id: ids.gula, quantity: 1, unit_cost: 1 }],
    });
    expect(noSupplier.status).toBe(400);

    const noIngredient = await newPO('store', [{ ingredient_id: 999999999, quantity: 1, unit_cost: 1 }]);
    expect(noIngredient.status).toBe(400);
  });

  it('membuat PO berstatus dipesan, lengkap dengan total di daftar', async () => {
    const res = await newPO();
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ordered');
    expect(res.body.items).toHaveLength(2);
    poId = res.body.id;

    const list = await request(app).get('/purchase-orders').set(auth('admin'));
    const row = list.body.find((p: any) => p.id === poId);
    expect(row.total).toBe(3500);
    expect(row.item_count).toBe(2);
    expect(row.supplier).toBe('p6-supplier-a');
  });

  it('penerimaan yang tidak lengkap, berlebih, atau sudah lewat ditolak dan tidak membuat batch', async () => {
    const missing = await post(`/purchase-orders/${poId}/receive`, 'store', {
      items: [{ ingredient_id: ids.gula, expires_at: '2098-01-01' }],
    });
    expect(missing.status).toBe(400);

    const extra = await post(`/purchase-orders/${poId}/receive`, 'store', {
      items: [...receiveBody().items, { ingredient_id: 999999999, expires_at: '2098-01-01' }],
    });
    expect(extra.status).toBe(400);

    const past = await post(`/purchase-orders/${poId}/receive`, 'store', {
      items: receiveBody().items.map((i) => ({ ...i, expires_at: '2020-01-01' })),
    });
    expect(past.status).toBe(400);

    expect(await batchesOf(ids.gula)).toEqual([]);
    expect(await batchesOf(ids.kopi)).toEqual([]);
  });

  it('penerimaan membuat batch sesuai PO, mencatat buku besar, dan mengubah status', async () => {
    const res = await post(`/purchase-orders/${poId}/receive`, 'store', receiveBody());
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('received');
    expect(res.body.received_at).toBeTruthy();

    expect(await batchesOf(ids.gula)).toEqual([{ initial: 100, remaining: 100, cost: 20, expires: '2098-01-01' }]);
    expect(await batchesOf(ids.kopi)).toEqual([{ initial: 50, remaining: 50, cost: 30, expires: '2099-01-01' }]);
    expect(await receiveMovements(poId)).toEqual([
      { ing: ids.gula, qty: 100 },
      { ing: ids.kopi, qty: 50 },
    ]);

    // stok langsung terlihat di ringkasan stok
    const stock = await request(app).get('/stock').set(auth('store'));
    const gula = stock.body.find((r: any) => r.name === 'p6-gula');
    expect(Number(gula.available)).toBe(100);
  });

  it('PO yang sudah diterima tidak bisa diterima ulang atau dibatalkan', async () => {
    expect((await post(`/purchase-orders/${poId}/receive`, 'store', receiveBody())).status).toBe(409);
    expect((await post(`/purchase-orders/${poId}/cancel`, 'store')).status).toBe(409);
    expect((await batchesOf(ids.gula))).toHaveLength(1);
  });

  it('PO dibatalkan tidak bisa diterima, dan pembatalan ganda atau id asing ditolak', async () => {
    const po = await newPO();
    const cancelled = await post(`/purchase-orders/${po.body.id}/cancel`, 'store');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.status).toBe('cancelled');

    expect((await post(`/purchase-orders/${po.body.id}/receive`, 'store', receiveBody())).status).toBe(409);
    expect((await post(`/purchase-orders/${po.body.id}/cancel`, 'store')).status).toBe(409);
    expect((await post('/purchase-orders/999999999/cancel', 'store')).status).toBe(404);
  });

  it('dua penerimaan serentak untuk PO yang sama: hanya satu berhasil, batch tidak ganda', async () => {
    const po = await newPO();
    const [a, b] = await Promise.all([
      post(`/purchase-orders/${po.body.id}/receive`, 'store', receiveBody()),
      post(`/purchase-orders/${po.body.id}/receive`, 'admin', receiveBody()),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await receiveMovements(po.body.id)).toHaveLength(2);
    // batch dari PO pertama (1) + PO ini (1) per bahan
    expect(await batchesOf(ids.gula)).toHaveLength(2);
  });

  it('supplier yang sudah dipakai PO tidak bisa dihapus, yang belum dipakai bisa', async () => {
    expect((await request(app).delete(`/suppliers/${ids.supA}`).set(auth('admin'))).status).toBe(409);

    const unused = await post('/suppliers', 'store', { name: 'p6-supplier-b' });
    expect((await request(app).delete(`/suppliers/${unused.body.id}`).set(auth('admin'))).status).toBe(204);
    expect((await request(app).delete(`/suppliers/${unused.body.id}`).set(auth('admin'))).status).toBe(404);
  });
});