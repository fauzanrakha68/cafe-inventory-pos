import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { audit } from '../audit';
import { ClientError } from '../errors';
import { authenticate, requireRole } from '../middleware/auth';
import { allocate, applyTakes, lockBatches, toMilliFromNumber } from '../stockOps';
import { fromMilli } from '../utils';

export const wasteRouter = Router();
wasteRouter.use(authenticate, requireRole('admin', 'store_keeper'));

const wasteSchema = z.object({
  ingredient_id: z.number().int().positive(),
  quantity: z.number().positive(),
  reason: z.enum(['kedaluwarsa', 'rusak', 'tumpah', 'lainnya']),
  note: z.string().max(200).optional(),
  batch_id: z.number().int().positive().optional(),
});

// Pembuangan bahan. Tanpa batch_id: diambil dari batch yang paling dulu kedaluwarsa
// (termasuk yang sudah kedaluwarsa). Dengan batch_id: hanya dari batch itu.
wasteRouter.post('/', async (req, res) => {
  const parsed = wasteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { ingredient_id, reason, note, batch_id } = parsed.data;

  const need = toMilliFromNumber(parsed.data.quantity);
  if (need <= 0n) return res.status(400).json({ error: 'Jumlah terlalu kecil' });

  try {
    const waste = await withTx(async (client) => {
      const ing = await client.query('select name from ingredients where id = $1', [ingredient_id]);
      if (!ing.rows[0]) throw new ClientError(400, 'Bahan tidak ditemukan');

      let batches = await lockBatches(client, ingredient_id);
      if (batch_id !== undefined) {
        batches = batches.filter((b) => b.id === batch_id);
        if (batches.length === 0) throw new ClientError(400, 'Batch tidak ditemukan atau sudah habis');
      }

      const { takes, short } = allocate(batches, need);
      if (short > 0n) {
        throw new ClientError(409, `Stok ${ing.rows[0].name} tidak cukup`, { ingredient: ing.rows[0].name });
      }

      const row = await client.query(
        `insert into waste_logs (ingredient_id, quantity, reason, note, created_by)
         values ($1, $2::numeric, $3, $4, $5)
         returning id, ingredient_id, quantity, reason, note, created_at`,
        [ingredient_id, fromMilli(need), reason, note ?? null, req.user!.id]
      );
      await applyTakes(client, ingredient_id, takes, 'waste', row.rows[0].id, req.user!.id);
      await audit(client, req.user!.id, 'create', 'waste', row.rows[0].id, null, {
        ...row.rows[0],
        ingredient: ing.rows[0].name,
      });
      return row.rows[0];
    });
    res.status(201).json(waste);
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message, ...e.extra });
    throw e;
  }
});

wasteRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `select w.id, w.quantity, w.reason, w.note, w.created_at,
            i.name as ingredient, i.unit, u.name as user_name
     from waste_logs w
     join ingredients i on i.id = w.ingredient_id
     join users u on u.id = w.created_by
     order by w.created_at desc, w.id desc
     limit 100`
  );
  res.json(rows);
});