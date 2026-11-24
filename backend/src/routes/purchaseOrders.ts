import { Router } from 'express';
import { z } from 'zod';
import { Pool, PoolClient } from 'pg';
import { pool, withTx } from '../db';
import { audit } from '../audit';
import { ClientError } from '../errors';
import { authenticate, requireRole } from '../middleware/auth';
import { toMilliFromNumber } from '../stockOps';
import { fromMilli, parseId } from '../utils';

export const purchaseOrdersRouter = Router();
purchaseOrdersRouter.use(authenticate, requireRole('admin', 'store_keeper'));

const poSchema = z.object({
  supplier_id: z.number().int().positive(),
  note: z.string().max(200).optional(),
  items: z
    .array(
      z.object({
        ingredient_id: z.number().int().positive(),
        quantity: z.number().positive(),
        unit_cost: z.number().int().min(0),
      })
    )
    .min(1),
});

const receiveSchema = z.object({
  items: z
    .array(
      z.object({
        ingredient_id: z.number().int().positive(),
        expires_at: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .refine((d) => !Number.isNaN(Date.parse(d)), 'Tanggal tidak valid'),
      })
    )
    .min(1),
});

async function getPO(db: Pool | PoolClient, id: number) {
  const h = await db.query(
    `select po.id, po.status, po.note, po.created_at, po.received_at,
            po.supplier_id, s.name as supplier, u.name as user_name
     from purchase_orders po
     join suppliers s on s.id = po.supplier_id
     join users u on u.id = po.created_by
     where po.id = $1`,
    [id]
  );
  if (!h.rows[0]) return null;
  const items = await db.query(
    `select poi.ingredient_id, i.name, i.unit, poi.quantity, poi.unit_cost
     from purchase_order_items poi join ingredients i on i.id = poi.ingredient_id
     where poi.purchase_order_id = $1 order by poi.id`,
    [id]
  );
  return { ...h.rows[0], items: items.rows };
}

purchaseOrdersRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null;
  const { rows } = await pool.query(
    `select po.id, po.status, po.note, po.created_at, po.received_at, s.name as supplier,
            (select count(*)::int from purchase_order_items x where x.purchase_order_id = po.id) as item_count,
            (select round(coalesce(sum(x.quantity * x.unit_cost), 0))::bigint
               from purchase_order_items x where x.purchase_order_id = po.id) as total
     from purchase_orders po join suppliers s on s.id = po.supplier_id
     where ($1::text is null or po.status = $1)
     order by po.created_at desc, po.id desc limit 100`,
    [status]
  );
  res.json(rows.map((r) => ({ ...r, total: Number(r.total) })));
});

purchaseOrdersRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const po = await getPO(pool, id);
  if (!po) return res.status(404).json({ error: 'Purchase order tidak ditemukan' });
  res.json(po);
});

purchaseOrdersRouter.post('/', async (req, res) => {
  const parsed = poSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { supplier_id, note, items } = parsed.data;

  const ingIds = items.map((i) => i.ingredient_id);
  if (new Set(ingIds).size !== ingIds.length) {
    return res.status(400).json({ error: 'Bahan tidak boleh dobel dalam satu PO' });
  }
  const qty = items.map((i) => toMilliFromNumber(i.quantity));
  if (qty.some((q) => q <= 0n)) return res.status(400).json({ error: 'Jumlah terlalu kecil' });

  try {
    const id = await withTx(async (client) => {
      const sup = await client.query('select 1 from suppliers where id = $1', [supplier_id]);
      if (!sup.rows[0]) throw new ClientError(400, 'Supplier tidak ditemukan');
      const found = await client.query('select id from ingredients where id = any($1)', [ingIds]);
      if (found.rowCount !== ingIds.length) throw new ClientError(400, 'Ada bahan yang tidak ditemukan');

      const head = await client.query(
        `insert into purchase_orders (supplier_id, note, created_by) values ($1, $2, $3) returning id`,
        [supplier_id, note ?? null, req.user!.id]
      );
      const poId = head.rows[0].id as number;
      for (let i = 0; i < items.length; i++) {
        await client.query(
          `insert into purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_cost)
           values ($1, $2, $3::numeric, $4)`,
          [poId, items[i].ingredient_id, fromMilli(qty[i]), items[i].unit_cost]
        );
      }
      await audit(client, req.user!.id, 'create', 'purchase_order', poId, null, {
        supplier_id,
        note: note ?? null,
        items,
      });
      return poId;
    });
    res.status(201).json(await getPO(pool, id));
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

// Barang datang: tiap item PO menjadi satu batch (jumlah dan harga sesuai PO) dengan kedaluwarsa
// yang diisi saat penerimaan. Baris PO dikunci, jadi dua penerimaan serentak tidak membuat batch ganda.
purchaseOrdersRouter.post('/:id/receive', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const parsed = receiveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  if (parsed.data.items.some((i) => i.expires_at < today)) {
    return res.status(400).json({ error: 'Tanggal kedaluwarsa sudah lewat' });
  }
  const expiry = new Map(parsed.data.items.map((i) => [i.ingredient_id, i.expires_at]));
  if (expiry.size !== parsed.data.items.length) {
    return res.status(400).json({ error: 'Bahan tidak boleh dobel' });
  }

  try {
    await withTx(async (client) => {
      const po = await client.query('select status from purchase_orders where id = $1 for update', [id]);
      if (!po.rows[0]) throw new ClientError(404, 'Purchase order tidak ditemukan');
      if (po.rows[0].status !== 'ordered') {
        throw new ClientError(409, 'Purchase order sudah diterima atau dibatalkan');
      }

      const poItems = await client.query(
        `select ingredient_id, quantity, unit_cost from purchase_order_items
         where purchase_order_id = $1 order by id`,
        [id]
      );
      const covered =
        poItems.rows.length === expiry.size && poItems.rows.every((r) => expiry.has(r.ingredient_id));
      if (!covered) {
        throw new ClientError(400, 'Isi tanggal kedaluwarsa untuk semua bahan di PO, tanpa bahan lain');
      }

      for (const r of poItems.rows) {
        const b = await client.query(
          `insert into stock_batches (ingredient_id, initial_qty, remaining_qty, unit_cost, expires_at)
           values ($1, $2::numeric, $2::numeric, $3, $4) returning id`,
          [r.ingredient_id, r.quantity, r.unit_cost, expiry.get(r.ingredient_id)]
        );
        await client.query(
          `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by)
           values ($1, $2, 'receive', $3::numeric, 'purchase_order', $4, $5)`,
          [r.ingredient_id, b.rows[0].id, r.quantity, id, req.user!.id]
        );
      }
      await client.query(
        "update purchase_orders set status = 'received', received_at = now() where id = $1",
        [id]
      );
      await audit(client, req.user!.id, 'receive', 'purchase_order', id, { status: 'ordered' }, {
        status: 'received',
        expires: Object.fromEntries(expiry),
      });
    });
    res.status(201).json(await getPO(pool, id));
  } catch (e) {
    if (e instanceof ClientError) return res.status(e.status).json({ error: e.message });
    throw e;
  }
});

purchaseOrdersRouter.post('/:id/cancel', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const upd = await withTx(async (client) => {
    const r = await client.query(
      "update purchase_orders set status = 'cancelled' where id = $1 and status = 'ordered' returning id",
      [id]
    );
    if (r.rows[0]) await audit(client, req.user!.id, 'cancel', 'purchase_order', id, { status: 'ordered' }, { status: 'cancelled' });
    return r;
  });
  if (!upd.rows[0]) {
    const exists = await pool.query('select 1 from purchase_orders where id = $1', [id]);
    if (!exists.rows[0]) return res.status(404).json({ error: 'Purchase order tidak ditemukan' });
    return res.status(409).json({ error: 'Hanya PO berstatus dipesan yang bisa dibatalkan' });
  }
  res.json(await getPO(pool, id));
});