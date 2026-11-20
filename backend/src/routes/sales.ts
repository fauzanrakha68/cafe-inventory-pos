import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { parseId, toMilli, fromMilli } from '../utils';

export const salesRouter = Router();
salesRouter.use(authenticate);

// "hari ini" menurut WIB, sama seperti di routes/stock.ts
const TODAY = "(now() at time zone 'Asia/Jakarta')::date";

const saleSchema = z.object({
  items: z
    .array(z.object({ menu_id: z.number().int().positive(), qty: z.number().int().min(1).max(1000) }))
    .min(1),
});

class ClientError extends Error {
  constructor(public status: number, message: string, public extra: object = {}) {
    super(message);
  }
}

// Satu penjualan = satu transaksi database:
// 1. hitung kebutuhan bahan dari resep (porsi x takaran)
// 2. per bahan, urut id: kunci batch yang belum kedaluwarsa (kedaluwarsa terdekat dulu)
// 3. kurangi batch satu per satu; kalau total kurang, batalkan semuanya (409)
// 4. catat pergerakan stok dan simpan penjualan
salesRouter.post('/', requireRole('kasir', 'admin'), async (req, res) => {
  const parsed = saleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });

  // gabungkan baris menu yang sama
  const qtyByMenu = new Map<number, number>();
  for (const it of parsed.data.items) {
    qtyByMenu.set(it.menu_id, (qtyByMenu.get(it.menu_id) ?? 0) + it.qty);
  }
  const menuIds = [...qtyByMenu.keys()];

  try {
    const sale = await withTx(async (client) => {
      const menus = await client.query(
        'select id, name, price from menus where id = any($1) and active',
        [menuIds]
      );
      if (menus.rowCount !== menuIds.length) {
        throw new ClientError(400, 'Ada menu yang tidak ditemukan atau tidak aktif');
      }

      const total = menus.rows.reduce((s, m) => s + m.price * qtyByMenu.get(m.id)!, 0);
      const saleRow = await client.query(
        'insert into sales (cashier_id, total) values ($1, $2) returning id, total, created_at',
        [req.user!.id, total]
      );
      const saleId = saleRow.rows[0].id as number;

      const items = [];
      for (const m of menus.rows) {
        await client.query(
          'insert into sale_items (sale_id, menu_id, qty, unit_price) values ($1, $2, $3, $4)',
          [saleId, m.id, qtyByMenu.get(m.id), m.price]
        );
        items.push({ menu_id: m.id, name: m.name, qty: qtyByMenu.get(m.id), unit_price: m.price });
      }

      // kebutuhan per bahan, dalam seperseribu satuan
      const recipe = await client.query(
        `select ri.menu_id, ri.ingredient_id, i.name, ri.quantity
         from recipe_items ri join ingredients i on i.id = ri.ingredient_id
         where ri.menu_id = any($1)`,
        [menuIds]
      );
      const needs = new Map<number, { name: string; need: bigint }>();
      for (const r of recipe.rows) {
        const add = toMilli(r.quantity) * BigInt(qtyByMenu.get(r.menu_id)!);
        const cur = needs.get(r.ingredient_id);
        needs.set(r.ingredient_id, { name: r.name, need: (cur?.need ?? 0n) + add });
      }

      // bahan selalu dikunci urut id, jadi dua kasir tidak saling deadlock
      const ingredientIds = [...needs.keys()].sort((a, b) => a - b);
      for (const ingId of ingredientIds) {
        const { name, need } = needs.get(ingId)!;
        const batches = await client.query(
          `select id, remaining_qty from stock_batches
           where ingredient_id = $1 and remaining_qty > 0 and expires_at >= ${TODAY}
           order by expires_at, id
           for update`,
          [ingId]
        );

        let left = need;
        const takes: { id: number; take: bigint }[] = [];
        for (const b of batches.rows) {
          if (left <= 0n) break;
          const avail = toMilli(b.remaining_qty);
          const take = avail < left ? avail : left;
          takes.push({ id: b.id, take });
          left -= take;
        }
        if (left > 0n) {
          throw new ClientError(409, `Stok ${name} tidak cukup`, { ingredient: name });
        }

        for (const t of takes) {
          await client.query(
            'update stock_batches set remaining_qty = remaining_qty - $1::numeric where id = $2',
            [fromMilli(t.take), t.id]
          );
          await client.query(
            `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by)
             values ($1, $2, 'sale', $3::numeric, 'sale', $4, $5)`,
            [ingId, t.id, fromMilli(-t.take), saleId, req.user!.id]
          );
        }
      }

      return { ...saleRow.rows[0], items };
    });
    res.status(201).json(sale);
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message, ...e.extra });
    throw e;
  }
});

// Riwayat: kasir hanya melihat penjualannya sendiri, admin melihat semua
salesRouter.get('/', requireRole('kasir', 'admin'), async (req, res) => {
  const own = req.user!.role === 'kasir';
  const { rows } = await pool.query(
    `select s.id, s.total, s.created_at, u.name as cashier
     from sales s join users u on u.id = s.cashier_id
     where ($1::boolean = false or s.cashier_id = $2)
     order by s.created_at desc, s.id desc
     limit 100`,
    [own, req.user!.id]
  );
  res.json(rows);
});

salesRouter.get('/:id', requireRole('kasir', 'admin'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const s = await pool.query(
    `select s.id, s.total, s.created_at, s.cashier_id, u.name as cashier
     from sales s join users u on u.id = s.cashier_id where s.id = $1`,
    [id]
  );
  const sale = s.rows[0];
  // penjualan milik kasir lain pura-pura tidak ada
  if (!sale || (req.user!.role === 'kasir' && sale.cashier_id !== req.user!.id)) {
    return res.status(404).json({ error: 'Penjualan tidak ditemukan' });
  }
  const items = await pool.query(
    `select si.menu_id, m.name, si.qty, si.unit_price
     from sale_items si join menus m on m.id = si.menu_id
     where si.sale_id = $1 order by si.id`,
    [id]
  );
  res.json({ ...sale, items: items.rows });
});