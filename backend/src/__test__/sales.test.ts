import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function makeUser(key: string, role: string) {
  const email = `p4-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [`p4-${key}`, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });

async function ingredient(name: string, unit = 'gram') {
  const r = await pool.query('insert into ingredients (name, unit) values ($1, $2) returning id', [name, unit]);
  return r.rows[0].id as number;
}

async function menu(name: string, price: number, recipe: [number, number][], active = true) {
  const m = await pool.query('insert into menus (name, price, active) values ($1, $2, $3) returning id', [name, price, active]);
  for (const [ing, qty] of recipe) {
    await pool.query('insert into recipe_items (menu_id, ingredient_id, quantity) values ($1, $2, $3)', [m.rows[0].id, ing, qty]);
  }
  return m.rows[0].id as number;
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

async function totalRemaining(ingredientId: number) {
  const r = await pool.query('select coalesce(sum(remaining_qty), 0) as s from stock_batches where ingredient_id = $1', [ingredientId]);
  return Number(r.rows[0].s);
}

const sell = (who: string, items: { menu_id: number; qty: number }[]) =>
  request(app).post('/sales').set(auth(who)).send({ items });

afterAll(async () => {
  const ing = [ids.kopi, ids.susu, ids.teh, ids.gula];
  await pool.query("delete from sales where cashier_id in (select id from users where email like 'p4-%@test.local')");
  await pool.query('delete from stock_movements where ingredient_id = any($1)', [ing]);
  await pool.query('delete from stock_batches where ingredient_id = any($1)', [ing]);
  await pool.query("delete from menus where name like 'p4-%'");
  await pool.query('delete from ingredients where id = any($1)', [ing]);
  await pool.query("delete from users where email like 'p4-%@test.local'");
  await pool.end();
});

describe('penjualan dan pemotongan stok', () => {
  beforeAll(async () => {
    await makeUser('kasir', 'kasir');
    await makeUser('kasir2', 'kasir');
    await makeUser('store', 'store_keeper');
    await makeUser('admin', 'admin');

    ids.kopi = await ingredient('p4-kopi');
    ids.susu = await ingredient('p4-susu', 'ml');
    ids.teh = await ingredient('p4-teh');
    ids.gula = await ingredient('p4-gula');

    // batch sengaja dimasukkan tidak berurutan: FEFO harus urut kedaluwarsa, bukan urut id
    ids.kopiLate = await batch(ids.kopi, 100, '2099-01-01');
    ids.kopiSoon = await batch(ids.kopi, 40, '2098-01-01');
    ids.kopiExpired = await batch(ids.kopi, 500, '2020-01-01');
    ids.susuB = await batch(ids.susu, 1000, '2098-01-01');

    ids.espresso = await menu('p4-espresso', 18000, [[ids.kopi, 18]]);
    ids.latte = await menu('p4-latte', 25000, [[ids.kopi, 18], [ids.susu, 200]]);
    ids.off = await menu('p4-off', 1000, [[ids.kopi, 1]], false);
  });

  it('store keeper tidak boleh membuat penjualan (403)', async () => {
    const res = await sell('store', [{ menu_id: ids.espresso, qty: 1 }]);
    expect(res.status).toBe(403);
  });

  it('menu nonaktif ditolak dan tidak mengubah stok', async () => {
    const res = await sell('kasir', [{ menu_id: ids.off, qty: 1 }]);
    expect(res.status).toBe(400);
    expect(await remaining(ids.kopiSoon)).toBe(40);
  });

  it('memotong batch yang lebih dulu kedaluwarsa, mencatat buku besar, dan menghitung total', async () => {
    const res = await sell('kasir', [
      { menu_id: ids.espresso, qty: 1 },
      { menu_id: ids.latte, qty: 1 },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.total).toBe(43000);
    expect(res.body.items).toHaveLength(2);

    // 36 gram kopi, semuanya dari batch 2098 (bukan batch 2099, bukan yang kedaluwarsa)
    expect(await remaining(ids.kopiSoon)).toBe(4);
    expect(await remaining(ids.kopiLate)).toBe(100);
    expect(await remaining(ids.kopiExpired)).toBe(500);
    expect(await remaining(ids.susuB)).toBe(800);

    const mv = await pool.query(
      "select ingredient_id, qty_change from stock_movements where type = 'sale' and ref_id = $1 order by ingredient_id",
      [res.body.id]
    );
    expect(mv.rows).toHaveLength(2);
    const byIng = Object.fromEntries(mv.rows.map((r) => [r.ingredient_id, Number(r.qty_change)]));
    expect(byIng[ids.kopi]).toBe(-36);
    expect(byIng[ids.susu]).toBe(-200);
  });

  it('kebutuhan yang melebihi satu batch diambil dari batch berikutnya', async () => {
    // sisa batch 2098 = 4, butuh 18 -> 4 dari 2098, 14 dari 2099
    const res = await sell('kasir', [{ menu_id: ids.espresso, qty: 1 }]);
    expect(res.status).toBe(201);
    expect(await remaining(ids.kopiSoon)).toBe(0);
    expect(await remaining(ids.kopiLate)).toBe(86);
    const mv = await pool.query("select count(*)::int as n from stock_movements where type = 'sale' and ref_id = $1", [res.body.id]);
    expect(mv.rows[0].n).toBe(2);
  });

  it('stok bahan kurang: 409 menyebut bahan, dan seluruh transaksi dibatalkan', async () => {
    // tambah kopi supaya cukup untuk 5 latte (90 g); susu hanya cukup 4 latte (800/200)
    await batch(ids.kopi, 100, '2100-01-01');
    const before = await pool.query("select count(*)::int as n from sales where cashier_id = (select id from users where email = 'p4-kasir@test.local')");
    const res = await sell('kasir', [{ menu_id: ids.latte, qty: 5 }]);
    expect(res.status).toBe(409);
    expect(res.body.ingredient).toBe('p4-susu');
    expect(res.body.error).toContain('p4-susu');

    // kopi (dikunci lebih dulu) tidak boleh ikut terpotong, dan tidak ada penjualan tersimpan
    expect(await remaining(ids.kopiLate)).toBe(86);
    expect(await remaining(ids.susuB)).toBe(800);
    const after = await pool.query("select count(*)::int as n from sales where cashier_id = (select id from users where email = 'p4-kasir@test.local')");
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it('riwayat: kasir hanya melihat miliknya, admin melihat semua', async () => {
    const mine = await sell('kasir2', [{ menu_id: ids.espresso, qty: 1 }]);
    expect(mine.status).toBe(201);

    const list2 = await request(app).get('/sales').set(auth('kasir2'));
    expect(list2.status).toBe(200);
    expect(list2.body.map((s: any) => s.id)).toEqual([mine.body.id]);

    const listAdmin = await request(app).get('/sales').set(auth('admin'));
    expect(listAdmin.body.length).toBeGreaterThan(1);

    // kasir lain tidak bisa membuka detail penjualan orang lain
    const other = await request(app).get(`/sales/${mine.body.id}`).set(auth('kasir'));
    expect(other.status).toBe(404);
    const own = await request(app).get(`/sales/${mine.body.id}`).set(auth('kasir2'));
    expect(own.status).toBe(200);
    expect(own.body.items[0].name).toBe('p4-espresso');
  });
});

describe('konkurensi', () => {
  let teh = 0;
  let gula = 0;
  let tehGula = 0;
  let gulaTeh = 0;
  let tehBatch = 0;
  let gulaBatch = 0;

  beforeAll(async () => {
    teh = ids.teh;
    gula = ids.gula;
    // dua menu memakai dua bahan yang sama dengan urutan resep terbalik: pola klasik deadlock
    tehGula = await menu('p4-teh-gula', 10000, [[teh, 5], [gula, 5]]);
    gulaTeh = await menu('p4-gula-teh', 10000, [[gula, 5], [teh, 5]]);
  });

  it('dua penjualan serentak untuk porsi terakhir: hanya satu berhasil, stok tidak minus', async () => {
    tehBatch = await batch(teh, 5, '2098-01-01');
    gulaBatch = await batch(gula, 5, '2098-01-01');

    const [a, b] = await Promise.all([
      sell('kasir', [{ menu_id: tehGula, qty: 1 }]),
      sell('kasir2', [{ menu_id: gulaTeh, qty: 1 }]),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await remaining(tehBatch)).toBe(0);
    expect(await remaining(gulaBatch)).toBe(0);
  });

  it('banyak penjualan serentak: jumlah yang berhasil sama dengan stok, tanpa deadlock atau 500', async () => {
    // stok cukup untuk tepat 7 porsi (35 gram), kirim 20 permintaan campuran
    await pool.query('update stock_batches set remaining_qty = 0 where ingredient_id = any($1)', [[teh, gula]]);
    await pool.query('update stock_batches set remaining_qty = 35 where id = any($1)', [[tehBatch, gulaBatch]]);

    const calls = Array.from({ length: 20 }, (_, i) =>
      sell(i % 2 ? 'kasir' : 'kasir2', [{ menu_id: i % 3 ? tehGula : gulaTeh, qty: 1 }])
    );
    const results = await Promise.all(calls);

    expect(results.filter((r) => r.status === 500)).toHaveLength(0);
    expect(results.filter((r) => r.status === 201)).toHaveLength(7);
    expect(results.filter((r) => r.status === 409)).toHaveLength(13);
    expect(await remaining(tehBatch)).toBe(0);
    expect(await remaining(gulaBatch)).toBe(0);
    expect(await totalRemaining(teh)).toBe(0);
  });
});