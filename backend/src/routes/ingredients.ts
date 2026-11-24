import { Router } from 'express';
import { z } from 'zod';
import { pool, withTx } from '../db';
import { audit } from '../audit';
import { authenticate, requireRole } from '../middleware/auth';
import { parseId } from '../utils';

export const ingredientsRouter = Router();
ingredientsRouter.use(authenticate, requireRole('admin', 'store_keeper'));

const schema = z.object({
  name: z.string().min(1),
  unit: z.enum(['gram', 'ml', 'pcs']),
  min_stock: z.number().min(0).default(0),
});

ingredientsRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'select id, name, unit, min_stock from ingredients order by name'
  );
  res.json(rows);
});

ingredientsRouter.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, unit, min_stock } = parsed.data;
  try {
    const created = await withTx(async (client) => {
      const { rows } = await client.query(
        `insert into ingredients (name, unit, min_stock) values ($1, $2, $3)
         returning id, name, unit, min_stock`,
        [name, unit, min_stock]
      );
      await audit(client, req.user!.id, 'create', 'ingredient', rows[0].id, null, rows[0]);
      return rows[0];
    });
    res.status(201).json(created);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nama bahan sudah ada' });
    throw e;
  }
});

ingredientsRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, unit, min_stock } = parsed.data;
  try {
    const updated = await withTx(async (client) => {
      const before = await client.query(
        'select id, name, unit, min_stock from ingredients where id = $1 for update',
        [id]
      );
      if (!before.rows[0]) return null;
      const { rows } = await client.query(
        `update ingredients set name = $1, unit = $2, min_stock = $3 where id = $4
         returning id, name, unit, min_stock`,
        [name, unit, min_stock, id]
      );
      await audit(client, req.user!.id, 'update', 'ingredient', id, before.rows[0], rows[0]);
      return rows[0];
    });
    if (!updated) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
    res.json(updated);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nama bahan sudah ada' });
    throw e;
  }
});

ingredientsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const found = await withTx(async (client) => {
      const before = await client.query('select id, name, unit, min_stock from ingredients where id = $1', [id]);
      if (!before.rows[0]) return false;
      await client.query('delete from ingredients where id = $1', [id]);
      await audit(client, req.user!.id, 'delete', 'ingredient', id, before.rows[0], null);
      return true;
    });
    if (!found) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
    res.status(204).end();
  } catch (e: any) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Bahan masih dipakai resep atau punya stok' });
    }
    throw e;
  }
});