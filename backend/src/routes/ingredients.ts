import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
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
    const { rows } = await pool.query(
      `insert into ingredients (name, unit, min_stock) values ($1, $2, $3)
       returning id, name, unit, min_stock`,
      [name, unit, min_stock]
    );
    res.status(201).json(rows[0]);
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
    const { rows } = await pool.query(
      `update ingredients set name = $1, unit = $2, min_stock = $3 where id = $4
       returning id, name, unit, min_stock`,
      [name, unit, min_stock, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
    res.json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nama bahan sudah ada' });
    throw e;
  }
});

ingredientsRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const result = await pool.query('delete from ingredients where id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Bahan tidak ditemukan' });
    res.status(204).end();
  } catch (e: any) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Bahan masih dipakai resep atau punya stok' });
    }
    throw e;
  }
});