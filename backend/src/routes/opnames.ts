import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { ClientError } from '../errors';
import { authenticate, requireRole } from '../middleware/auth';
import { allocate, applyTakes, lockBatches, toMilliFromNumber } from '../stockOps';
import { fromMilli, parseId, toMilli } from '../utils';

export const opnamesRouter = Router();
opnamesRouter.use(authenticate, requireRole('admin', 'store_keeper'));

const opnameSchema = z.object({
  note: z.string().max(200).optional(),
  items: z
    .array(z.object({ ingredient_id: z.number().int().positive(), counted_qty: z.number().min(0) }))
    .min(1),
});

// Stock opname: hitung fisik versus catatan sistem (semua batch yang masih ada sisa, termasuk yang
// kedaluwarsa). Selisih kurang memotong batch dari yang paling dulu kedaluwarsa; selisih lebih
// ditambahkan ke batch terbaru. Setiap perubahan dicatat di buku besar (type 'opname').
opnamesRouter.post('/', async (req, res) => {
  const parsed = opnameSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { note, items } = parsed.data;

  const ids = items.map((i) => i.ingredient_id);
  if (new Set(ids).size !== ids.length) {
    return res.status(400).json({ error: 'Bahan tidak boleh dobel dalam satu opname' });
  }

  try {
    const opnameId = await withTx(async (client) => {
      const head = await client.query(
        'insert into stock_opnames (note, created_by) values ($1, $2) returning id',
        [note ?? null, req.user!.id]
      );
      const id = head.rows[0].id as number;

      // bahan dikunci urut id, sama seperti penjualan, supaya tidak saling deadlock
      const sorted = [...items].sort((a, b) => a.ingredient_id - b.ingredient_id);
      for (const it of sorted) {
        const ing = await client.query('select name from ingredients where id = $1', [it.ingredient_id]);
        if (!ing.rows[0]) throw new ClientError(400, 'Bahan tidak ditemukan');

        const batches = await lockBatches(client, it.ingredient_id);
        const system = batches.reduce((s, b) => s + toMilli(b.remaining_qty), 0n);
        const counted = toMilliFromNumber(it.counted_qty);
        const diff = counted - system;

        await client.query(
          `insert into stock_opname_items (opname_id, ingredient_id, system_qty, counted_qty)
           values ($1, $2, $3::numeric, $4::numeric)`,
          [id, it.ingredient_id, fromMilli(system), fromMilli(counted)]
        );

        if (diff < 0n) {
          const { takes } = allocate(batches, -diff);
          await applyTakes(client, it.ingredient_id, takes, 'opname', id, req.user!.id);
        } else if (diff > 0n) {
          // batch dengan kedaluwarsa paling akhir (boleh yang sudah habis); kalau belum pernah ada batch, tolak
          const latest = await client.query(
            `select id from stock_batches where ingredient_id = $1
             order by expires_at desc, id desc limit 1 for update`,
            [it.ingredient_id]
          );
          if (!latest.rows[0]) {
            throw new ClientError(409, `Belum ada batch untuk ${ing.rows[0].name}, lakukan penerimaan barang dulu`);
          }
          await client.query(
            'update stock_batches set remaining_qty = remaining_qty + $1::numeric where id = $2',
            [fromMilli(diff), latest.rows[0].id]
          );
          await client.query(
            `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by)
             values ($1, $2, 'opname', $3::numeric, 'opname', $4, $5)`,
            [it.ingredient_id, latest.rows[0].id, fromMilli(diff), id, req.user!.id]
          );
        }
      }
      return id;
    });
    res.status(201).json(await getOpname(opnameId));
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

async function getOpname(id: number) {
  const h = await pool.query(
    `select o.id, o.note, o.created_at, u.name as user_name
     from stock_opnames o join users u on u.id = o.created_by where o.id = $1`,
    [id]
  );
  if (!h.rows[0]) return null;
  const items = await pool.query(
    `select i.name as ingredient, i.unit, oi.ingredient_id, oi.system_qty, oi.counted_qty,
            (oi.counted_qty - oi.system_qty) as diff
     from stock_opname_items oi join ingredients i on i.id = oi.ingredient_id
     where oi.opname_id = $1 order by i.name`,
    [id]
  );
  return { ...h.rows[0], items: items.rows };
}

opnamesRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    `select o.id, o.note, o.created_at, u.name as user_name,
            (select count(*)::int from stock_opname_items oi where oi.opname_id = o.id) as item_count,
            (select count(*)::int from stock_opname_items oi
              where oi.opname_id = o.id and oi.counted_qty <> oi.system_qty) as diff_count
     from stock_opnames o join users u on u.id = o.created_by
     order by o.created_at desc, o.id desc limit 100`
  );
  res.json(rows);
});

opnamesRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const opname = await getOpname(id);
  if (!opname) return res.status(404).json({ error: 'Opname tidak ditemukan' });
  res.json(opname);
});