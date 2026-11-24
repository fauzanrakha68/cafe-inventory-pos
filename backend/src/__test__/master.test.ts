import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
let ingredientId = 0;

async function makeUser(key: string, role: string) {
  const email = `m-${key}@test.local`;
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

describe('master data', () => {
  beforeAll(async () => {
    await makeUser('admin', 'admin');
    await makeUser('kasir', 'kasir');
    await makeUser('store', 'store_keeper');
  });

  afterAll(async () => {
    await pool.query("delete from menus where name like 'm-%'");
    await pool.query("delete from ingredients where name like 'm-%'");
    await pool.query("delete from audit_logs where user_id in (select id from users where email like 'm-%@test.local')"); 
    await pool.query("delete from users where email like 'm-%@test.local'");
    await pool.end();
  });

  it('kasir tidak boleh membuat bahan (403)', async () => {
    const res = await request(app).post('/ingredients').set(auth('kasir'))
      .send({ name: 'm-kopi', unit: 'gram', min_stock: 500 });
    expect(res.status).toBe(403);
  });

  it('store keeper boleh membuat bahan', async () => {
    const res = await request(app).post('/ingredients').set(auth('store'))
      .send({ name: 'm-kopi', unit: 'gram', min_stock: 500 });
    expect(res.status).toBe(201);
    ingredientId = res.body.id;
  });

  it('nama bahan dobel ditolak 409', async () => {
    const res = await request(app).post('/ingredients').set(auth('store'))
      .send({ name: 'm-kopi', unit: 'gram', min_stock: 0 });
    expect(res.status).toBe(409);
  });

  it('kasir tidak boleh membuat menu, admin boleh', async () => {
    const body = { name: 'm-latte', price: 25000, recipe: [{ ingredient_id: ingredientId, quantity: 18 }] };
    const denied = await request(app).post('/menus').set(auth('kasir')).send(body);
    expect(denied.status).toBe(403);
    const ok = await request(app).post('/menus').set(auth('admin')).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.recipe).toHaveLength(1);
  });

  it('kasir bisa melihat daftar menu', async () => {
    const res = await request(app).get('/menus').set(auth('kasir'));
    expect(res.status).toBe(200);
    expect(res.body.some((m: any) => m.name === 'm-latte')).toBe(true);
  });

  it('bahan yang dipakai resep tidak bisa dihapus (409)', async () => {
    const res = await request(app).delete(`/ingredients/${ingredientId}`).set(auth('admin'));
    expect(res.status).toBe(409);
  });
});