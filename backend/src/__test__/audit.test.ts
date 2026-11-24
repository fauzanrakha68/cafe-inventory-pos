import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function makeUser(key: string, role: string) {
  const email = `p8-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [`p8-${key}`, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
  const u = await pool.query('select id from users where email = $1', [email]);
  ids[`user_${key}`] = u.rows[0].id;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

// semua log yang dibuat oleh user test ini, urut dari yang paling lama
async function logs(entity?: string) {
  const r = await pool.query(
    `select action, entity, entity_id, before_data, after_data from audit_logs
     where user_id = any($1) and ($2::text is null or entity = $2) order by id`,
    [[ids.user_admin, ids.user_store], entity ?? null]
  );
  return r.rows;
}

beforeAll(async () => {
  await makeUser('admin', 'admin');
  await makeUser('store', 'store_keeper');
});

afterAll(async () => {
  await pool.query('delete from stock_movements where ingredient_id in (select id from ingredients where name like $1)', ['p8-%']);
  await pool.query('delete from stock_batches where ingredient_id in (select id from ingredients where name like $1)', ['p8-%']);
  await pool.query("delete from menus where name like 'p8-%'");
  await pool.query("delete from ingredients where name like 'p8-%'");
  await pool.query("delete from audit_logs where user_id in (select id from users where email like 'p8-%@test.local')");
  await pool.query("delete from users where email like 'p8-%@test.local'");
  await pool.end();
});

describe('audit log', () => {
  it('bahan: tambah, ubah (before/after), hapus tercatat', async () => {
    const c = await request(app).post('/ingredients').set(auth('store')).send({ name: 'p8-kopi', unit: 'gram', min_stock: 10 });
    expect(c.status).toBe(201);
    const id = c.body.id;
    const u = await request(app).put(`/ingredients/${id}`).set(auth('store')).send({ name: 'p8-kopi', unit: 'gram', min_stock: 25 });
    expect(u.status).toBe(200);
    expect((await request(app).delete(`/ingredients/${id}`).set(auth('store'))).status).toBe(204);

    const l = await logs('ingredient');
    expect(l.map((x) => x.action)).toEqual(['create', 'update', 'delete']);
    expect(l[0].before_data).toBeNull();
    expect(l[1].before_data.min_stock).toBe('10.000');
    expect(l[1].after_data.min_stock).toBe('25.000');
    expect(l[2].after_data).toBeNull();
    expect(l.every((x) => x.entity_id === id)).toBe(true);
  });

  it('menu: perubahan harga mencatat harga lama dan baru', async () => {
    const ing = await request(app).post('/ingredients').set(auth('admin')).send({ name: 'p8-susu', unit: 'ml' });
    const body = (price: number) => ({ name: 'p8-latte', price, recipe: [{ ingredient_id: ing.body.id, quantity: 150 }] });
    const c = await request(app).post('/menus').set(auth('admin')).send(body(20000));
    expect(c.status).toBe(201);
    expect((await request(app).put(`/menus/${c.body.id}`).set(auth('admin')).send(body(23000))).status).toBe(200);

    const l = await logs('menu');
    expect(l.map((x) => x.action)).toEqual(['create', 'update']);
    expect(l[1].before_data.price).toBe(20000);
    expect(l[1].after_data.price).toBe(23000);
    expect(l[1].after_data.recipe[0].name).toBe('p8-susu');
  });

  it('PO: dibuat, diterima, dan dibatalkan tercatat; penerimaan ganda ditolak tanpa log baru', async () => {
    const sup = await request(app).post('/suppliers').set(auth('store')).send({ name: 'p8-supplier' });
    const ing = await request(app).post('/ingredients').set(auth('store')).send({ name: 'p8-gula', unit: 'gram' });
    const mk = () =>
      request(app).post('/purchase-orders').set(auth('store'))
        .send({ supplier_id: sup.body.id, items: [{ ingredient_id: ing.body.id, quantity: 100, unit_cost: 5 }] });
    const po1 = (await mk()).body.id;
    const po2 = (await mk()).body.id;

    const rec = { items: [{ ingredient_id: ing.body.id, expires_at: '2099-01-01' }] };
    expect((await request(app).post(`/purchase-orders/${po1}/receive`).set(auth('store')).send(rec)).status).toBe(201);
    expect((await request(app).post(`/purchase-orders/${po1}/receive`).set(auth('store')).send(rec)).status).toBe(409);
    expect((await request(app).post(`/purchase-orders/${po2}/cancel`).set(auth('store'))).status).toBe(200);
    expect((await request(app).post(`/purchase-orders/${po2}/cancel`).set(auth('store'))).status).toBe(409);

    const l = (await logs('purchase_order')).map((x) => `${x.action}:${x.entity_id}`);
    expect(l).toEqual([`create:${po1}`, `create:${po2}`, `receive:${po1}`, `cancel:${po2}`]);

    await pool.query('delete from purchase_orders where created_by = $1', [ids.user_store]);
    await pool.query('delete from suppliers where name = $1', ['p8-supplier']);
  });

  it('waste dan opname tercatat bersama perubahan stoknya', async () => {
    const ing = (await pool.query("select id from ingredients where name = 'p8-gula'")).rows[0].id;
    expect((await request(app).post('/waste').set(auth('store')).send({ ingredient_id: ing, quantity: 10, reason: 'tumpah' })).status).toBe(201);
    expect((await request(app).post('/opnames').set(auth('store')).send({ items: [{ ingredient_id: ing, counted_qty: 80 }] })).status).toBe(201);

    const w = await logs('waste');
    expect(w).toHaveLength(1);
    expect(w[0].after_data.ingredient).toBe('p8-gula');
    const o = await logs('opname');
    expect(o).toHaveLength(1);
    expect(o[0].after_data.items[0]).toMatchObject({ system_qty: '90.000', counted_qty: '80.000' });

    await pool.query('delete from stock_opnames where created_by = $1', [ids.user_store]);
    await pool.query('delete from waste_logs where created_by = $1', [ids.user_store]);
  });

  it('pembuatan user tercatat tanpa password', async () => {
    const r = await request(app).post('/users').set(auth('admin'))
      .send({ name: 'p8-baru', email: 'p8-baru@test.local', password: 'password123', role: 'kasir' });
    expect(r.status).toBe(201);
    const l = await logs('user');
    expect(l.at(-1)!.after_data.email).toBe('p8-baru@test.local');
    expect(JSON.stringify(l.at(-1)!.after_data)).not.toMatch(/password|hash/i);
  });

  it('aksi yang gagal tidak meninggalkan log', async () => {
    const before = (await logs()).length;
    expect((await request(app).put('/ingredients/99999999').set(auth('admin')).send({ name: 'x', unit: 'gram' })).status).toBe(404);
    expect((await request(app).delete('/menus/99999999').set(auth('admin'))).status).toBe(404);
    expect((await logs()).length).toBe(before);
  });

  it('GET /audit-logs: hanya admin, bisa difilter dan dipaginasi', async () => {
    expect((await request(app).get('/audit-logs').set(auth('store'))).status).toBe(403);
    const all = await request(app).get('/audit-logs?limit=2').set(auth('admin'));
    expect(all.status).toBe(200);
    expect(all.body.rows).toHaveLength(2);
    expect(all.body.has_more).toBe(true);
    expect(all.body.rows[0]).toHaveProperty('user_name');

    const f = await request(app).get('/audit-logs?entity=opname&limit=200').set(auth('admin'));
    expect(f.body.rows.every((r: any) => r.entity === 'opname')).toBe(true);
  });
});