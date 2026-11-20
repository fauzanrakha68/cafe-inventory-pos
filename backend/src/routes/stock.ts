import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { parseId } from '../utils';

export const stockRouter = Router();
stockRouter.use(authenticate, requireRole('admin', 'store_keeper'));

// "hari ini" menurut WIB, bukan zona waktu server database
const TODAY = "(now() at time zone 'Asia/Jakarta')::date";

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        ingredient_id: z.number().int().positive(),
        quantity: z.number().positive(),
        unit_cost: z.number().int().min(0),
        expires_at: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((d) => !Number.isNaN(Date.parse(d)), 'Tanggal tidak valid'),
      })
    )
    .min(1),
});

// Penerimaan barang: tiap item jadi satu batch + satu baris buku besar
stockRouter.post('/receive', async (req, res) => {
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { items } = parsed.data;

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  if (items.some((i) => i.expires_at < today)) {
    return res.status(400).json({ error: 'Tanggal kedaluwarsa sudah lewat' });
  }

  try {
    const batches = await withTx(async (client) => {
      const out = [];
      for (const it of items) {
        const b = await client.query(
          `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at)
           values ($1, $2, $2, $3, $4)
           returning id, ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at`,
          [it.ingredient_id, it.quantity, it.unit_cost, it.expires_at]
        );
        await client.query(
          `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by)
           values ($1, $2, 'receive', $3, 'batch', $2, $4)`,
          [it.ingredient_id, b.rows[0].id, it.quantity, req.user!.id]
        );
        out.push(b.rows[0]);
      }
      return out;
    });
    res.status(201).json(batches);
  } catch (e: any) {
    if (e.code === '23503') return res.status(400).json({ error: 'Bahan tidak ditemukan' });
    throw e;
  }
});

// Ringkasan stok per bahan, dengan penanda stok minimum
stockRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `with s as (
       select i.id, i.name, i.unit, i.min_stock,
         coalesce(sum(b.remaining_qty) filter (where b.expires_at >= ${TODAY}), 0) as available,
         coalesce(sum(b.remaining_qty) filter (where b.expires_at < ${TODAY}), 0) as expired,
         min(b.expires_at) filter (where b.remaining_qty > 0 and b.expires_at >= ${TODAY}) as nearest_expiry
       from ingredients i
       left join stock_batches b on b.ingredient_id = i.id
       group by i.id
     )
     select *, (min_stock > 0 and available <= min_stock) as is_low
     from s order by name`
  );
  res.json(rows);
});

// Daftar batch yang masih ada sisa untuk satu bahan, urut kedaluwarsa terdekat
stockRouter.get('/:ingredientId/batches', async (req, res) => {
  const id = parseId(req.params.ingredientId);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const { rows } = await pool.query(
    `select id, initial_qty, remaining_qty, unit_cost, expires_at, received_at,
            (expires_at < ${TODAY}) as is_expired
     from stock_batches
     where ingredient_id = $1 and remaining_qty > 0
     order by expires_at, id`,
    [id]
  );
  res.json(rows);
});