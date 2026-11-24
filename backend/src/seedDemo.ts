// Data demo: kafe fiktif "Kopi Senja" dengan 14 hari riwayat (penjualan, PO, pembuangan, opname,
// audit log). Semuanya dibuat lewat SQL dengan tanggal mundur, dan stok disimulasikan dengan aturan
// yang sama seperti aplikasi (FEFO, batch kedaluwarsa tidak dijual), jadi laporan dan buku besar
// konsisten. Pakai angka acak bertanda tetap (seed), jadi hasilnya selalu sama.
//
//   npm run seed:demo -- --reset
import bcrypt from 'bcryptjs';
import { PoolClient } from 'pg';
import { pool, withTx } from './db';

// ---------- util ----------
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261124);
const randInt = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1));
function pickWeighted<T extends { w: number }>(items: T[]): T {
  let r = rnd() * items.reduce((s, i) => s + i.w, 0);
  for (const i of items) {
    r -= i.w;
    if (r < 0) return i;
  }
  return items[items.length - 1];
}

const pad = (n: number) => String(n).padStart(2, '0');
const wibToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const ts = (date: string, seconds: number) =>
  `${date}T${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}+07:00`;
const at = (h: number, m = 0) => h * 3600 + m * 60;

// ---------- data master ----------
type Ing = { key: string; name: string; unit: 'gram' | 'ml' | 'pcs'; min: number; cost: number; shelf: number };
const INGREDIENTS: Ing[] = [
  { key: 'kopi', name: 'Biji kopi espresso', unit: 'gram', min: 2000, cost: 180, shelf: 180 },
  { key: 'susu', name: 'Susu segar', unit: 'ml', min: 5000, cost: 18, shelf: 7 },
  { key: 'sirup', name: 'Sirup gula aren', unit: 'ml', min: 1500, cost: 45, shelf: 365 },
  { key: 'gula', name: 'Gula pasir', unit: 'gram', min: 1000, cost: 15, shelf: 365 },
  { key: 'matcha', name: 'Bubuk matcha', unit: 'gram', min: 150, cost: 700, shelf: 120 },
  { key: 'cokelat', name: 'Bubuk cokelat', unit: 'gram', min: 500, cost: 120, shelf: 365 },
  { key: 'teh', name: 'Teh celup', unit: 'pcs', min: 30, cost: 480, shelf: 365 },
  { key: 'croissant', name: 'Croissant beku', unit: 'pcs', min: 10, cost: 7000, shelf: 60 },
  { key: 'telur', name: 'Telur ayam', unit: 'pcs', min: 20, cost: 2200, shelf: 7 },
  { key: 'mentega', name: 'Mentega', unit: 'gram', min: 300, cost: 110, shelf: 90 },
  { key: 'cup', name: 'Cup plastik 16 oz', unit: 'pcs', min: 150, cost: 700, shelf: 730 },
];
const ING = Object.fromEntries(INGREDIENTS.map((i) => [i.key, i]));

type MenuDef = { key: string; name: string; price: number; w: number; recipe: Record<string, number> };
const MENUS: MenuDef[] = [
  { key: 'espresso', name: 'Espresso', price: 18000, w: 5, recipe: { kopi: 18, cup: 1 } },
  { key: 'americano', name: 'Americano', price: 22000, w: 12, recipe: { kopi: 18, cup: 1 } },
  { key: 'latte', name: 'Cafe Latte', price: 28000, w: 20, recipe: { kopi: 18, susu: 150, cup: 1 } },
  { key: 'cappuccino', name: 'Cappuccino', price: 28000, w: 10, recipe: { kopi: 18, susu: 120, cup: 1 } },
  { key: 'gulaaren', name: 'Kopi Susu Gula Aren', price: 25000, w: 25, recipe: { kopi: 18, susu: 100, sirup: 25, cup: 1 } },
  { key: 'matcha', name: 'Matcha Latte', price: 30000, w: 10, recipe: { matcha: 6, susu: 150, gula: 8, cup: 1 } },
  { key: 'cokelat', name: 'Cokelat Panas', price: 26000, w: 5, recipe: { cokelat: 25, susu: 180, gula: 8, cup: 1 } },
  { key: 'teh', name: 'Teh Hitam', price: 15000, w: 5, recipe: { teh: 1, gula: 10, cup: 1 } },
  { key: 'croissant', name: 'Croissant', price: 22000, w: 5, recipe: { croissant: 1 } },
  { key: 'eggcroissant', name: 'Egg Croissant', price: 32000, w: 3, recipe: { croissant: 1, telur: 1, mentega: 5 } },
];
const LATTE_OLD_PRICE = 26000; // naik jadi 28.000 pada hari ke-8 dari akhir
const LATTE_RAISE_OFFSET = -8;

const SUPPLIERS = [
  { key: 'biji', name: 'CV Biji Nusantara', phone: '022-5550101', address: 'Jl. Braga No. 12, Bandung' },
  { key: 'susu', name: 'Susu Segar Lembang', phone: '0812-5550102', address: 'Jl. Raya Lembang No. 88, Lembang' },
  { key: 'grosir', name: 'Toko Grosir Maju Jaya', phone: '022-5550103', address: 'Pasar Baru Blok C-14, Bandung' },
  { key: 'bakery', name: 'Bakery Frozen Prima', phone: '0813-5550104', address: 'Jl. Soekarno-Hatta No. 301, Bandung' },
];

// Jadwal PO: dibuat sehari sebelum barang datang (pukul 16.00), diterima pukul 08.00.
type PoDef = {
  supplier: string;
  deliver: number; // hari ke- (0 = hari ini, -1 = kemarin, ...)
  items: Record<string, number | [number, number]>; // jumlah, atau [jumlah, harga per satuan]
  note: string;
  cancelled?: boolean;
};
const POS: PoDef[] = [
  { supplier: 'biji', deliver: -13, note: 'Stok awal pembukaan', items: { kopi: 5000, matcha: 500, cokelat: 2000, teh: 100 } },
  { supplier: 'susu', deliver: -13, note: 'Stok awal pembukaan', items: { susu: 22000, telur: 30, mentega: 500 } },
  { supplier: 'grosir', deliver: -13, note: 'Stok awal pembukaan', items: { sirup: 4500, gula: 3000, cup: 1000 } },
  { supplier: 'bakery', deliver: -13, note: 'Stok awal pembukaan', items: { croissant: 50 } },
  { supplier: 'susu', deliver: -10, note: 'Susu rutin', items: { susu: 22000 } },
  { supplier: 'susu', deliver: -7, note: 'Susu dan telur', items: { susu: 22000, telur: 40 } },
  { supplier: 'grosir', deliver: -6, note: 'Restok sirup dan cup', items: { sirup: 4000, cup: 300 } },
  { supplier: 'bakery', deliver: -6, note: 'Restok croissant', items: { croissant: 40 } },
  { supplier: 'biji', deliver: -8, note: 'Restok kopi dan matcha', items: { kopi: [5000, 185], matcha: 200 } },
  { supplier: 'susu', deliver: -4, note: 'Susu rutin', items: { susu: [22000, 19] } },
  { supplier: 'biji', deliver: -4, note: 'Restok kopi', items: { kopi: [3600, 190] } },
  { supplier: 'susu', deliver: -2, note: 'Susu rutin', items: { susu: [22000, 19] } },
  { supplier: 'biji', deliver: -2, note: 'Restok kopi (dibatalkan, harga naik)', items: { kopi: [2000, 205] }, cancelled: true },
];

type WasteDef = { offset: number; time: number; key: string; qty: number; reason: string; note: string };
const WASTES: WasteDef[] = [
  { offset: -11, time: at(15, 20), key: 'susu', qty: 600, reason: 'tumpah', note: 'Galon tumpah saat mengisi mesin' },
  { offset: -9, time: at(8, 40), key: 'cup', qty: 25, reason: 'rusak', note: 'Cup penyok dari dus' },
  { offset: -6, time: at(9, 10), key: 'croissant', qty: 3, reason: 'rusak', note: 'Hancur saat pengiriman' },
  { offset: -3, time: at(10, 0), key: 'kopi', qty: 150, reason: 'lainnya', note: 'Kalibrasi grinder' },
  { offset: -1, time: at(18, 45), key: 'susu', qty: 400, reason: 'tumpah', note: 'Pitcher terjatuh' },
];
// selisih opname (hanya kurang, seperti yang biasa terjadi: susut, tumpah kecil, salah takar)
const OPNAMES = [
  { offset: -7, time: at(22, 0), note: 'Opname mingguan', diffs: { kopi: -120, susu: -450, telur: -2, croissant: 0 } as Record<string, number> },
  { offset: -1, time: at(22, 0), note: 'Opname bahan kering', diffs: { cokelat: -60, matcha: -8, teh: 0 } as Record<string, number> },
];

// ---------- simulasi ----------
type Batch = { id: number; ing: string; initial: number; remaining: number; expires: string };

async function main() {
  const reset = process.argv.includes('--reset');
  const existing = (await pool.query('select count(*)::int as n from ingredients')).rows[0].n as number;
  if (existing > 0 && !reset) {
    console.error('Database sudah berisi data bahan. Untuk menimpa semuanya jalankan: npm run seed:demo -- --reset');
    await pool.end();
    process.exit(1);
  }

  const hash = await bcrypt.hash('password123', 10);
  const result = await withTx(async (c) => {
    await c.query(
      `truncate audit_logs, stock_movements, sale_items, sales, stock_opname_items, stock_opnames, waste_logs,
                purchase_order_items, purchase_orders, stock_batches, recipe_items, menus, ingredients, suppliers
       restart identity cascade`
    );
    return simulate(c, hash);
  });

  console.log(`Seed demo selesai:
  penjualan        : ${result.sales} transaksi (${result.skipped} dilewati karena stok habis)
  pendapatan       : Rp ${result.revenue.toLocaleString('id-ID')}
  purchase order   : ${result.pos}
  pembuangan       : ${result.wastes}
  stock opname     : ${result.opnames}
  audit log        : ${result.audits}
  stok menipis     : ${result.low.join(', ') || '-'}
  rekonsiliasi     : buku besar = total sisa batch untuk semua bahan`);
  console.log('Login: admin@cafe.test / kasir@cafe.test / kasir2@cafe.test / store@cafe.test, password: password123');
  await pool.end();
}

async function simulate(c: PoolClient, hash: string) {
  // --- pengguna
  const people = [
    ['Admin', 'admin@cafe.test', 'admin'],
    ['Kasir Satu', 'kasir@cafe.test', 'kasir'],
    ['Kasir Dua', 'kasir2@cafe.test', 'kasir'],
    ['Store Keeper', 'store@cafe.test', 'store_keeper'],
  ];
  for (const [name, email, role] of people) {
    await c.query(
      `insert into users (name, email, password_hash, role) values ($1, $2, $3, $4)
       on conflict (email) do nothing`,
      [name, email, hash, role]
    );
  }
  const uid = async (email: string) => (await c.query('select id from users where email = $1', [email])).rows[0].id as number;
  const U = { admin: await uid('admin@cafe.test'), kasir1: await uid('kasir@cafe.test'), kasir2: await uid('kasir2@cafe.test'), store: await uid('store@cafe.test') };

  const today = wibToday();
  const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Jakarta', hour12: false }).split(':').map(Number);
  const nowSeconds = now[0] * 3600 + now[1] * 60 + now[2];
  const dateOf = (offset: number) => addDays(today, offset);
  const inFuture = (offset: number, seconds: number) => offset === 0 && seconds > nowSeconds;

  let auditCount = 0;
  const audit = async (when: string, user: number, action: string, entity: string, entityId: number | null, before: unknown, after: unknown) => {
    await c.query(
      `insert into audit_logs (user_id, action, entity, entity_id, before_data, after_data, created_at)
       values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
      [user, action, entity, entityId, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after), when]
    );
    auditCount++;
  };

  // --- data master (dibuat 14 hari lalu oleh admin)
  const setupAt = ts(dateOf(-14), at(9));
  const ingId: Record<string, number> = {};
  for (const i of INGREDIENTS) {
    const r = await c.query('insert into ingredients (name, unit, min_stock) values ($1, $2, $3) returning id', [i.name, i.unit, i.min]);
    ingId[i.key] = r.rows[0].id;
    await audit(setupAt, U.admin, 'create', 'ingredient', r.rows[0].id, null, { id: r.rows[0].id, name: i.name, unit: i.unit, min_stock: `${i.min}.000` });
  }
  const supId: Record<string, number> = {};
  for (const s of SUPPLIERS) {
    const r = await c.query('insert into suppliers (name, phone, address) values ($1, $2, $3) returning id', [s.name, s.phone, s.address]);
    supId[s.key] = r.rows[0].id;
  }
  const menuId: Record<string, number> = {};
  const menuObj = (m: MenuDef, price: number, id: number) => ({
    id,
    name: m.name,
    price,
    active: true,
    recipe: Object.entries(m.recipe)
      .map(([k, q]) => ({ ingredient_id: ingId[k], name: ING[k].name, unit: ING[k].unit, quantity: `${q}.000` }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
  const priceOf = (m: MenuDef, offset: number) => (m.key === 'latte' && offset < LATTE_RAISE_OFFSET ? LATTE_OLD_PRICE : m.price);
  for (const m of MENUS) {
    const r = await c.query('insert into menus (name, price, active) values ($1, $2, true) returning id', [m.name, priceOf(m, -14)]);
    menuId[m.key] = r.rows[0].id;
    for (const [k, q] of Object.entries(m.recipe)) {
      await c.query('insert into recipe_items (menu_id, ingredient_id, quantity) values ($1, $2, $3)', [r.rows[0].id, ingId[k], q]);
    }
    await audit(setupAt, U.admin, 'create', 'menu', r.rows[0].id, null, menuObj(m, priceOf(m, -14), r.rows[0].id));
  }

  // --- keadaan stok di memori (selalu diselaraskan dengan yang ditulis ke database)
  const batches: Batch[] = [];
  const stats = { sales: 0, skipped: 0, pos: 0, wastes: 0, opnames: 0, revenue: 0 };
  const sorted = (key: string, validOn?: string) =>
    batches
      .filter((b) => b.ing === key && b.remaining > 0 && (!validOn || b.expires >= validOn))
      .sort((a, b) => (a.expires < b.expires ? -1 : a.expires > b.expires ? 1 : a.id - b.id));
  const take = (key: string, need: number, validOn?: string) => {
    const out: { batch: Batch; qty: number }[] = [];
    let left = need;
    for (const b of sorted(key, validOn)) {
      if (left <= 0) break;
      const q = Math.min(b.remaining, left);
      out.push({ batch: b, qty: q });
      left -= q;
    }
    return left > 0 ? null : out;
  };
  const move = async (when: string, key: string, batch: Batch, qty: number, type: string, refType: string, refId: number, user: number) => {
    batch.remaining += qty; // qty negatif untuk pengurangan
    await c.query(
      `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [ingId[key], batch.id, type, qty, refType, refId, user, when]
    );
  };

  type Ev = { t: number; run: () => Promise<void> };
  const poIds = new Map<PoDef, number>();

  for (let offset = -14; offset <= 0; offset++) {
    const date = dateOf(offset);
    const events: Ev[] = [];
    const add = (t: number, run: () => Promise<void>) => {
      if (!inFuture(offset, t)) events.push({ t, run });
    };

    // pembuangan batch kedaluwarsa tiap pagi oleh store keeper
    add(at(7), async () => {
      for (const b of batches.filter((x) => x.remaining > 0 && x.expires < date)) {
        const qty = b.remaining;
        const w = await c.query(
          `insert into waste_logs (ingredient_id, quantity, reason, note, created_by, created_at)
           values ($1, $2, 'kedaluwarsa', 'Batch kedaluwarsa dibuang', $3, $4) returning id`,
          [ingId[b.ing], qty, U.store, ts(date, at(7))]
        );
        await move(ts(date, at(7)), b.ing, b, -qty, 'waste', 'waste', w.rows[0].id, U.store);
        await audit(ts(date, at(7)), U.store, 'create', 'waste', w.rows[0].id, null, {
          id: w.rows[0].id, ingredient_id: ingId[b.ing], quantity: `${qty}.000`, reason: 'kedaluwarsa', note: 'Batch kedaluwarsa dibuang', ingredient: ING[b.ing].name,
        });
        stats.wastes++;
      }
    });

    // PO dibuat (hari sebelum pengiriman, pukul 16.00), diterima, atau dibatalkan
    for (const po of POS) {
      const items = Object.entries(po.items).map(([k, v]) => ({
        key: k,
        qty: Array.isArray(v) ? v[0] : v,
        cost: Array.isArray(v) ? v[1] : ING[k].cost,
      }));
      if (po.deliver - 1 === offset) {
        add(at(16), async () => {
          const when = ts(date, at(16));
          const h = await c.query(
            `insert into purchase_orders (supplier_id, note, created_by, created_at) values ($1, $2, $3, $4) returning id`,
            [supId[po.supplier], po.note, U.store, when]
          );
          poIds.set(po, h.rows[0].id);
          for (const it of items) {
            await c.query(
              `insert into purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost) values ($1, $2, $3, $4)`,
              [h.rows[0].id, ingId[it.key], it.qty, it.cost]
            );
          }
          await audit(when, U.store, 'create', 'purchase_order', h.rows[0].id, null, {
            supplier_id: supId[po.supplier], note: po.note,
            items: items.map((it) => ({ ingredient_id: ingId[it.key], quantity: it.qty, unit_cost: it.cost })),
          });
          stats.pos++;
        });
      }
      if (po.deliver === offset) {
        if (po.cancelled) {
          add(at(10), async () => {
            const when = ts(date, at(10));
            const id = poIds.get(po)!;
            await c.query(`update purchase_orders set status = 'cancelled' where id = $1`, [id]);
            await audit(when, U.store, 'cancel', 'purchase_order', id, { status: 'ordered' }, { status: 'cancelled' });
          });
        } else {
          add(at(8), async () => {
            const when = ts(date, at(8));
            const id = poIds.get(po)!;
            const expires: Record<number, string> = {};
            for (const it of items) {
              const exp = addDays(date, ING[it.key].shelf);
              expires[ingId[it.key]] = exp;
              const b = await c.query(
                `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at, received_at)
                 values ($1, $2, $2, $3, $4, $5) returning id`,
                [ingId[it.key], it.qty, it.cost, exp, when]
              );
              const batch: Batch = { id: b.rows[0].id, ing: it.key, initial: it.qty, remaining: 0, expires: exp };
              batches.push(batch);
              await move(when, it.key, batch, it.qty, 'receive', 'purchase_order', id, U.store);
            }
            await c.query(`update purchase_orders set status = 'received', received_at = $2 where id = $1`, [id, when]);
            await audit(when, U.store, 'receive', 'purchase_order', id, { status: 'ordered' }, { status: 'received', expires });
          });
        }
      }
    }

    // perubahan data master oleh admin
    if (offset === LATTE_RAISE_OFFSET) {
      add(at(9), async () => {
        const m = MENUS.find((x) => x.key === 'latte')!;
        await c.query('update menus set price = $1 where id = $2', [m.price, menuId.latte]);
        await audit(ts(date, at(9)), U.admin, 'update', 'menu', menuId.latte, menuObj(m, LATTE_OLD_PRICE, menuId.latte), menuObj(m, m.price, menuId.latte));
      });
    }
    if (offset === -5) {
      add(at(11), async () => {
        const i = ING.matcha;
        await c.query('update ingredients set min_stock = 150 where id = $1', [ingId.matcha]);
        await audit(ts(date, at(11)), U.admin, 'update', 'ingredient', ingId.matcha,
          { id: ingId.matcha, name: i.name, unit: i.unit, min_stock: '100.000' }, { id: ingId.matcha, name: i.name, unit: i.unit, min_stock: '150.000' });
      });
    }

    // pembuangan manual
    for (const w of WASTES.filter((x) => x.offset === offset)) {
      add(w.time, async () => {
        const when = ts(date, w.time);
        const takes = take(w.key, w.qty);
        if (!takes) return;
        const r = await c.query(
          `insert into waste_logs (ingredient_id, quantity, reason, note, created_by, created_at)
           values ($1, $2, $3, $4, $5, $6) returning id`,
          [ingId[w.key], w.qty, w.reason, w.note, U.store, when]
        );
        for (const t of takes) await move(when, w.key, t.batch, -t.qty, 'waste', 'waste', r.rows[0].id, U.store);
        await audit(when, U.store, 'create', 'waste', r.rows[0].id, null, {
          id: r.rows[0].id, ingredient_id: ingId[w.key], quantity: `${w.qty}.000`, reason: w.reason, note: w.note, ingredient: ING[w.key].name,
        });
        stats.wastes++;
      });
    }

    // stock opname (selisih kurang diambil dari batch paling dulu kedaluwarsa, termasuk yang sudah lewat)
    for (const o of OPNAMES.filter((x) => x.offset === offset)) {
      add(o.time, async () => {
        const when = ts(date, o.time);
        const head = await c.query('insert into stock_opnames (note, created_by, created_at) values ($1, $2, $3) returning id', [o.note, U.store, when]);
        const auditItems: unknown[] = [];
        for (const [key, diff] of Object.entries(o.diffs).sort((a, b) => ingId[a[0]] - ingId[b[0]])) {
          const system = batches.filter((b) => b.ing === key).reduce((s, b) => s + b.remaining, 0);
          const counted = system + diff;
          await c.query(
            `insert into stock_opname_items (opname_id, ingredient_id, system_qty, counted_qty) values ($1, $2, $3, $4)`,
            [head.rows[0].id, ingId[key], system, counted]
          );
          auditItems.push({ ingredient_id: ingId[key], system_qty: `${system}.000`, counted_qty: `${counted}.000` });
          if (diff < 0) {
            const takes = take(key, -diff)!;
            for (const t of takes) await move(when, key, t.batch, -t.qty, 'opname', 'opname', head.rows[0].id, U.store);
          }
        }
        await audit(when, U.store, 'create', 'opname', head.rows[0].id, null, { note: o.note, items: auditItems });
        stats.opnames++;
      });
    }

    // penjualan harian
    if (offset >= -13) {
      const weekend = [0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay());
      const count = weekend ? randInt(44, 60) : randInt(28, 40);
      const slots = [
        { from: at(7, 30), to: at(10), w: 25 },
        { from: at(10), to: at(12), w: 12 },
        { from: at(12), to: at(14, 30), w: 28 },
        { from: at(14, 30), to: at(17), w: 12 },
        { from: at(17), to: at(21, 30), w: 23 },
      ];
      for (let n = 0; n < count; n++) {
        const slot = pickWeighted(slots);
        const t = randInt(slot.from, slot.to - 1);
        const lineCount = pickWeighted([{ n: 1, w: 50 }, { n: 2, w: 35 }, { n: 3, w: 15 }]).n;
        const cart = new Map<string, number>();
        for (let l = 0; l < lineCount; l++) {
          const m = pickWeighted(MENUS);
          cart.set(m.key, (cart.get(m.key) ?? 0) + (rnd() < 0.9 ? 1 : 2));
        }
        add(t, async () => {
          // butuh stok cukup untuk seluruh keranjang (dan hanya batch yang belum kedaluwarsa), kalau tidak dilewati
          const need = new Map<string, number>();
          for (const [mk, q] of cart) {
            for (const [ik, per] of Object.entries(MENUS.find((m) => m.key === mk)!.recipe)) need.set(ik, (need.get(ik) ?? 0) + per * q);
          }
          for (const [ik, q] of need) {
            if (!take(ik, q, date)) {
              stats.skipped++;
              return;
            }
          }
          const when = ts(date, t);
          const cashier = t < at(15) ? U.kasir1 : U.kasir2;
          const lines = [...cart].map(([mk, q]) => {
            const m = MENUS.find((x) => x.key === mk)!;
            return { m, q, price: priceOf(m, offset) };
          });
          const total = lines.reduce((s, l) => s + l.q * l.price, 0);
          const sale = await c.query('insert into sales (cashier_id, total, created_at) values ($1, $2, $3) returning id', [cashier, total, when]);
          for (const l of lines) {
            await c.query('insert into sale_items (sale_id, menu_id, qty, unit_price) values ($1, $2, $3, $4)', [sale.rows[0].id, menuId[l.m.key], l.q, l.price]);
          }
          for (const [ik, q] of [...need].sort((a, b) => ingId[a[0]] - ingId[b[0]])) {
            for (const tk of take(ik, q, date)!) await move(when, ik, tk.batch, -tk.qty, 'sale', 'sale', sale.rows[0].id, cashier);
          }
          stats.sales++;
          stats.revenue += total;
        });
      }
    }

    events.sort((a, b) => a.t - b.t);
    for (const e of events) await e.run();
  }

  // --- tulis sisa stok akhir tiap batch
  for (const b of batches) await c.query('update stock_batches set remaining_qty = $1 where id = $2', [b.remaining, b.id]);

  // --- rekonsiliasi: buku besar harus sama dengan total sisa batch, dan tidak boleh ada stok minus
  const recon = await c.query(
    `select i.name,
            coalesce((select sum(remaining_qty) from stock_batches where ingredient_id = i.id), 0) as batch_sum,
            coalesce((select sum(qty_change) from stock_movements where ingredient_id = i.id), 0) as ledger_sum
     from ingredients i`
  );
  for (const r of recon.rows) {
    if (Number(r.batch_sum) !== Number(r.ledger_sum)) throw new Error(`Rekonsiliasi gagal untuk ${r.name}: batch ${r.batch_sum} vs buku besar ${r.ledger_sum}`);
  }
  if (batches.some((b) => b.remaining < 0)) throw new Error('Ada batch bernilai minus');

  const low = INGREDIENTS.filter((i) => {
    const avail = batches.filter((b) => b.ing === i.key && b.expires >= today).reduce((s, b) => s + b.remaining, 0);
    return avail < i.min;
  }).map((i) => i.name);

  return { ...stats, audits: auditCount, low };
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});