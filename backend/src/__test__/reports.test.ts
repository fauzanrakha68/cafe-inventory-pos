import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

// Data dibuat di tahun 2001 supaya tidak tercampur dengan test lain yang berjalan paralel.
const FROM = '2001-03-04';
const TO = '2001-03-07';

async function makeUser(key: string, role: string) {
  const email = `p7-${key}@test.local`;
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [`p7-${key}`, email, hash, role]
  );
  const res = await request(app).post('/auth/login').send({ email, password: PASSWORD });
  tokens[key] = res.body.token;
  const u = await pool.query('select id from users where email = $1', [email]);
  ids[`user_${key}`] = u.rows[0].id;
}

const auth = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
const get = (path: string, who: string) => request(app).get(path).set(auth(who));

beforeAll(async () => {
  await makeUser('admin', 'admin');
  await makeUser('kasir', 'kasir');

  const ing = await pool.query("insert into ingredients (name, unit) values ('p7-kopi', 'gram') returning id");
  ids.ing = ing.rows[0].id;
  const b = await pool.query(
    `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at)
     values ($1, 1000, 955, 10, '2099-01-01') returning id`,
    [ids.ing]
  );
  ids.batch = b.rows[0].id;
  const m = await pool.query("insert into menus (name, price) values ('=p7-menu', 5000) returning id");
  ids.menu = m.rows[0].id;

  // 5 Mar 2001 pukul 10:00 WIB: jual 2 gelas @5000, pakai 40 gram (HPP 40 x 10 = 400)
  const s = await pool.query(
    "insert into sales (cashier_id, total, created_at) values ($1, 10000, '2001-03-05 10:00+07') returning id",
    [ids.user_kasir]
  );
  await pool.query('insert into sale_items (sale_id, menu_id, qty, unit_price) values ($1, $2, 2, 5000)', [s.rows[0].id, ids.menu]);
  await pool.query(
    `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_at)
     values ($1, $2, 'sale', -40, 'sale', $3, '2001-03-05 10:00+07')`,
    [ids.ing, ids.batch, s.rows[0].id]
  );
  // 05 Mar 2001 pukul 18:00 UTC = 6 Mar 01:00 WIB, jadi masuk tanggal 6 (buang 5 gram, nilai 50)
  await pool.query(
    `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, created_at)
     values ($1, $2, 'waste', -5, 'waste', '2001-03-05 18:00+00')`,
    [ids.ing, ids.batch]
  );
});

afterAll(async () => {
  await pool.query('delete from stock_movements where ingredient_id = $1', [ids.ing]);
  await pool.query('delete from sales where cashier_id = $1', [ids.user_kasir]);
  await pool.query('delete from stock_batches where ingredient_id = $1', [ids.ing]);
  await pool.query('delete from menus where id = $1', [ids.menu]);
  await pool.query('delete from ingredients where id = $1', [ids.ing]);
  await pool.query("delete from audit_logs where user_id in (select id from users where email like 'p7-%@test.local')");
  await pool.query("delete from users where email like 'p7-%@test.local'");
  await pool.end();
});

describe('laporan', () => {
  it('hanya admin yang boleh (kasir 403, tanpa token 401)', async () => {
    expect((await get(`/reports/summary?from=${FROM}&to=${TO}`, 'kasir')).status).toBe(403);
    expect((await request(app).get('/reports/summary')).status).toBe(401);
  });

  it('menghitung pendapatan, HPP, laba, dan pembuangan per hari WIB', async () => {
    const res = await get(`/reports/summary?from=${FROM}&to=${TO}`, 'admin');
    expect(res.status).toBe(200);
    expect(res.body.days.map((d: any) => d.date)).toEqual(['2001-03-04', '2001-03-05', '2001-03-06', '2001-03-07']);

    const byDate = Object.fromEntries(res.body.days.map((d: any) => [d.date, d]));
    expect(byDate['2001-03-04']).toMatchObject({ sales_count: 0, revenue: 0, cogs: 0, profit: 0, waste_cost: 0 });
    expect(byDate['2001-03-05']).toMatchObject({ sales_count: 1, revenue: 10000, cogs: 400, profit: 9600, waste_cost: 0 });
    expect(byDate['2001-03-06']).toMatchObject({ sales_count: 0, revenue: 0, cogs: 0, waste_cost: 50 });

    expect(res.body.totals).toMatchObject({ sales_count: 1, revenue: 10000, cogs: 400, profit: 9600, waste_cost: 50 });
    expect(res.body.menus).toEqual([{ name: '=p7-menu', qty: 2, revenue: 10000 }]);
  });

  it('menolak tanggal tidak valid, terbalik, atau rentang terlalu panjang (400)', async () => {
    for (const q of ['from=2001-02-30&to=2001-03-01', 'from=abc', 'from=2001-03-07&to=2001-03-04', 'from=1990-01-01&to=2001-01-01']) {
      expect((await get(`/reports/summary?${q}`, 'admin')).status).toBe(400);
    }
  });

  it('default tanpa parameter: 7 hari terakhir', async () => {
    const res = await get('/reports/summary', 'admin');
    expect(res.status).toBe(200);
    expect(res.body.days).toHaveLength(7);
  });

  it('CSV: header, total, BOM, dan nama menu berawalan = dinetralkan', async () => {
    const res = await get(`/reports/summary.csv?from=${FROM}&to=${TO}`, 'admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain(`laporan-${FROM}_${TO}.csv`);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text).toContain('Tanggal,Jumlah transaksi,Pendapatan,HPP,Laba kotor,Nilai pembuangan');
    expect(text).toContain('2001-03-05,1,10000,400,9600,0');
    expect(text).toContain('Total,1,10000,400,9600,50');
    expect(text).toContain("'=p7-menu,2,10000");
  });
});