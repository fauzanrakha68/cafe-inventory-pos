import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function makeUser(key: string, role: string) {
  const email = `p5-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [`p5-${key}`, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

async function ingredient(name: string) {
  const r = await pool.query("insert into ingredients (name, unit) values ($1, 'gram') returning id", [name]);
  return r.rows[0].id as number;
}

async function batch(ingredientId: number, qty: number, expires: string) {
  const r = await pool.query(
    `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at)
     values ($1, $2, $2, 10, $3) returning id`,
    [ingredientId, qty, expires]
  );
  return r.rows[0].id as number;
}

async function remaining(batchId: number) {
  const r = await pool.query('select remaining_qty from stock_batches where id = $1', [batchId]);
  return Number(r.rows[0].remaining_qty);
}

async function movements(type: string, refId: number) {
  const r = await pool.query(
    'select batch_id, qty_change from stock_movements where type = $1 and ref_id = $2 order by id',
    [type, refId]
  );
  return r.rows.map((m) => ({ batch_id: m.batch_id as number, qty: Number(m.qty_change) }));
}

const count = async (table: string) =>
  (await pool.query(`select count(*)::int as n from ${table}`)).rows[0].n as number;

beforeAll(async () => {
  await makeUser('store', 'store_keeper');
  await makeUser('kasir', 'kasir');
  await makeUser('admin', 'admin');

  ids.tepung = await ingredient('p5-tepung');
  ids.keju = await ingredient('p5-keju');
  ids.mentega = await ingredient('p5-mentega');
  ids.garam = await ingredient('p5-garam'); // sengaja tanpa batch

  // tepung: total 100, batch sengaja tidak berurutan
  ids.tepungLate = await batch(ids.tepung, 30, '2099-01-01');
  ids.tepungSoon = await batch(ids.tepung, 50, '2098-01-01');
  ids.tepungExpired = await batch(ids.tepung, 20, '2020-01-01');

  ids.kejuA = await batch(ids.keju, 10, '2098-01-01');
  ids.kejuB = await batch(ids.keju, 20, '2099-01-01');
  ids.mentegaC = await batch(ids.mentega, 5, '2098-01-01');
});

afterAll(async () => {
  const ing = [ids.tepung, ids.keju, ids.mentega, ids.garam];
  const users = "(select id from users where email like 'p5-%@test.local')";
  await pool.query(`delete from stock_opnames where created_by in ${users}`);
  await pool.query(`delete from waste_logs where created_by in ${users}`);
  await pool.query('delete from stock_movements where ingredient_id = any($1)', [ing]);
  await pool.query('delete from stock_batches where ingredient_id = any($1)', [ing]);
  await pool.query('delete from ingredients where id = any($1)', [ing]);
  await pool.query("delete from users where email like 'p5-%@test.local'");
  await pool.end();
});

const waste = (who: string, body: object) => request(app).post('/waste').set(auth(who)).send(body);
const opname = (who: string, body: object) => request(app).post('/opnames').set(auth(who)).send(body);

describe('waste', () => {
  it('kasir tidak boleh membuang bahan (403)', async () => {
    const res = await waste('kasir', { ingredient_id: ids.tepung, quantity: 1, reason: 'rusak' });
    expect(res.status).toBe(403);
  });

  it('alasan di luar daftar ditolak', async () => {
    const res = await waste('store', { ingredient_id: ids.tepung, quantity: 1, reason: 'iseng' });
    expect(res.status).toBe(400);
  });

  it('tanpa batch_id: batch kedaluwarsa dibuang lebih dulu, sisanya dari batch berikutnya, dan tercatat', async () => {
    const res = await waste('store', { ingredient_id: ids.tepung, quantity: 30, reason: 'kedaluwarsa' });
    expect(res.status).toBe(201);
    expect(await remaining(ids.tepungExpired)).toBe(0);
    expect(await remaining(ids.tepungSoon)).toBe(40);
    expect(await remaining(ids.tepungLate)).toBe(30);
    expect(await movements('waste', res.body.id)).toEqual([
      { batch_id: ids.tepungExpired, qty: -20 },
      { batch_id: ids.tepungSoon, qty: -10 },
    ]);
  });

  it('dengan batch_id: hanya batch itu yang berkurang', async () => {
    const res = await waste('store', { ingredient_id: ids.tepung, quantity: 5, reason: 'tumpah', batch_id: ids.tepungLate });
    expect(res.status).toBe(201);
    expect(await remaining(ids.tepungLate)).toBe(25);
    expect(await remaining(ids.tepungSoon)).toBe(40);
  });

  it('batch milik bahan lain ditolak', async () => {
    const res = await waste('store', { ingredient_id: ids.tepung, quantity: 1, reason: 'rusak', batch_id: ids.kejuA });
    expect(res.status).toBe(400);
    expect(await remaining(ids.kejuA)).toBe(10);
  });

  it('stok tidak cukup: 409 dan tidak ada yang berubah', async () => {
    const before = await count('waste_logs');
    const res = await waste('store', { ingredient_id: ids.tepung, quantity: 100, reason: 'rusak' });
    expect(res.status).toBe(409);
    expect(res.body.ingredient).toBe('p5-tepung');
    expect(await remaining(ids.tepungSoon)).toBe(40);
    expect(await remaining(ids.tepungLate)).toBe(25);
    expect(await count('waste_logs')).toBe(before);
  });

  it('dua pembuangan serentak untuk stok yang hanya cukup satu: satu berhasil, stok tidak minus', async () => {
    // sisa tepung: 40 (soon) + 25 (late) = 65; dua permintaan 40
    const [a, b] = await Promise.all([
      waste('store', { ingredient_id: ids.tepung, quantity: 40, reason: 'rusak' }),
      waste('admin', { ingredient_id: ids.tepung, quantity: 40, reason: 'rusak' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect((await remaining(ids.tepungSoon)) + (await remaining(ids.tepungLate))).toBe(25);
  });

  it('riwayat pembuangan bisa dilihat store keeper', async () => {
    const res = await request(app).get('/waste').set(auth('store'));
    expect(res.status).toBe(200);
    expect(res.body.some((w: any) => w.ingredient === 'p5-tepung')).toBe(true);
  });
});

describe('stock opname', () => {
  it('kasir tidak boleh membuat opname (403)', async () => {
    const res = await opname('kasir', { items: [{ ingredient_id: ids.keju, counted_qty: 1 }] });
    expect(res.status).toBe(403);
  });

  it('selisih kurang memotong batch yang lebih dulu kedaluwarsa dan tercatat', async () => {
    const res = await opname('store', { items: [{ ingredient_id: ids.keju, counted_qty: 25 }] });
    expect(res.status).toBe(201);
    const item = res.body.items[0];
    expect(Number(item.system_qty)).toBe(30);
    expect(Number(item.counted_qty)).toBe(25);
    expect(Number(item.diff)).toBe(-5);
    expect(await remaining(ids.kejuA)).toBe(5);
    expect(await remaining(ids.kejuB)).toBe(20);
    expect(await movements('opname', res.body.id)).toEqual([{ batch_id: ids.kejuA, qty: -5 }]);
  });

  it('selisih lebih ditambahkan ke batch terbaru', async () => {
    const res = await opname('store', { items: [{ ingredient_id: ids.keju, counted_qty: 40 }] });
    expect(res.status).toBe(201);
    expect(Number(res.body.items[0].diff)).toBe(15);
    expect(await remaining(ids.kejuA)).toBe(5);
    expect(await remaining(ids.kejuB)).toBe(35);
    expect(await movements('opname', res.body.id)).toEqual([{ batch_id: ids.kejuB, qty: 15 }]);
  });

  it('jumlah sama dengan sistem tidak mengubah stok maupun buku besar', async () => {
    const res = await opname('store', { items: [{ ingredient_id: ids.keju, counted_qty: 40 }] });
    expect(res.status).toBe(201);
    expect(Number(res.body.items[0].diff)).toBe(0);
    expect(await movements('opname', res.body.id)).toEqual([]);
  });

  it('beberapa bahan sekaligus dalam satu opname', async () => {
    const res = await opname('store', {
      note: 'hitung akhir bulan',
      items: [
        { ingredient_id: ids.mentega, counted_qty: 8 },
        { ingredient_id: ids.keju, counted_qty: 40 },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(2);
    expect(await remaining(ids.mentegaC)).toBe(8);

    const list = await request(app).get('/opnames').set(auth('admin'));
    const row = list.body.find((o: any) => o.id === res.body.id);
    expect(row.item_count).toBe(2);
    expect(row.diff_count).toBe(1);

    const detail = await request(app).get(`/opnames/${res.body.id}`).set(auth('store'));
    expect(detail.status).toBe(200);
    expect(detail.body.note).toBe('hitung akhir bulan');
  });

  it('bahan dobel ditolak', async () => {
    const res = await opname('store', {
      items: [{ ingredient_id: ids.keju, counted_qty: 1 }, { ingredient_id: ids.keju, counted_qty: 2 }],
    });
    expect(res.status).toBe(400);
  });

  it('bahan yang tidak ada membatalkan seluruh opname', async () => {
    const before = await count('stock_opnames');
    const res = await opname('store', {
      items: [{ ingredient_id: ids.mentega, counted_qty: 1 }, { ingredient_id: 999999999, counted_qty: 1 }],
    });
    expect(res.status).toBe(400);
    expect(await count('stock_opnames')).toBe(before);
    expect(await remaining(ids.mentegaC)).toBe(8);
  });

  it('selisih lebih untuk bahan tanpa batch: 409 dan semuanya dibatalkan', async () => {
    const before = await count('stock_opnames');
    const res = await opname('store', {
      items: [{ ingredient_id: ids.mentega, counted_qty: 1 }, { ingredient_id: ids.garam, counted_qty: 5 }],
    });
    expect(res.status).toBe(409);
    expect(await count('stock_opnames')).toBe(before);
    expect(await remaining(ids.mentegaC)).toBe(8);
  });
});