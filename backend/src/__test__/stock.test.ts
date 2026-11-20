import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
let ingredientId = 0;

async function makeUser(key: string, role: string) {
  const email = `s-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [email, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

async function stockRow() {
  const res = await request(app).get('/stock').set(auth('store'));
  return res.body.find((r: any) => r.name === 's-susu');
}

describe('penerimaan barang dan stok', () => {
  beforeAll(async () => {
    await makeUser('store', 'store_keeper');
    await makeUser('kasir', 'kasir');
    const ing = await pool.query(
      "insert into ingredients (name, unit, min_stock) values ('s-susu', 'ml', 1000) returning id"
    );
    ingredientId = ing.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('delete from stock_movements where ingredient_id = $1', [ingredientId]);
    await pool.query('delete from stock_batches where ingredient_id = $1', [ingredientId]);
    await pool.query('delete from ingredients where id = $1', [ingredientId]);
    await pool.query("delete from users where email like 's-%@test.local'");
    await pool.end();
  });

  it('kasir tidak boleh melihat stok (403)', async () => {
    const res = await request(app).get('/stock').set(auth('kasir'));
    expect(res.status).toBe(403);
  });

  it('tanggal kedaluwarsa yang sudah lewat ditolak', async () => {
    const res = await request(app).post('/stock/receive').set(auth('store'))
      .send({ items: [{ ingredient_id: ingredientId, quantity: 100, unit_cost: 20, expires_at: '2020-01-01' }] });
    expect(res.status).toBe(400);
  });

  it('penerimaan pertama membuat batch dan stok di bawah minimum menandai is_low', async () => {
    const res = await request(app).post('/stock/receive').set(auth('store'))
      .send({ items: [{ ingredient_id: ingredientId, quantity: 600, unit_cost: 20, expires_at: '2099-01-01' }] });
    expect(res.status).toBe(201);
    const row = await stockRow();
    expect(Number(row.available)).toBe(600);
    expect(row.is_low).toBe(true);
  });

  it('penerimaan kedua menaikkan stok di atas minimum', async () => {
    await request(app).post('/stock/receive').set(auth('store'))
      .send({ items: [{ ingredient_id: ingredientId, quantity: 500, unit_cost: 22, expires_at: '2098-01-01' }] });
    const row = await stockRow();
    expect(Number(row.available)).toBe(1100);
    expect(row.is_low).toBe(false);
    expect(row.nearest_expiry).toBe('2098-01-01');
  });

  it('batch kedaluwarsa tidak dihitung sebagai stok tersedia', async () => {
    await pool.query(
      `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at)
       values ($1, 300, 300, 20, '2020-01-01')`,
      [ingredientId]
    );
    const row = await stockRow();
    expect(Number(row.available)).toBe(1100);
    expect(Number(row.expired)).toBe(300);
  });

  it('daftar batch urut kedaluwarsa terdekat dan buku besar mencatat penerimaan', async () => {
    const res = await request(app).get(`/stock/${ingredientId}/batches`).set(auth('store'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].expires_at).toBe('2020-01-01');
    const mv = await pool.query(
      "select count(*)::int as n from stock_movements where ingredient_id = $1 and type = 'receive'",
      [ingredientId]
    );
    expect(mv.rows[0].n).toBe(2);
  });
});