import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { parseId } from '../utils';

export const suppliersRouter = Router();
suppliersRouter.use(authenticate, requireRole('admin', 'store_keeper'));

const schema = z.object({
  name: z.string().min(1).max(100),
  phone: z.string().max(30).optional(),
  address: z.string().max(200).optional(),
});

suppliersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query('select id, name, phone, address from suppliers order by name');
  res.json(rows);
});

suppliersRouter.post('/', async (req, res) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, phone, address } = parsed.data;
  try {
    const { rows } = await pool.query(
      'insert into suppliers (name, phone, address) values ($1, $2, $3) returning id, name, phone, address',
      [name, phone ?? null, address ?? null]
    );
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nama supplier sudah ada' });
    throw e;
  }
});

suppliersRouter.put('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, phone, address } = parsed.data;
  try {
    const { rows } = await pool.query(
      `update suppliers set name = $1, phone = $2, address = $3 where id = $4
       returning id, name, phone, address`,
      [name, phone ?? null, address ?? null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Supplier tidak ditemukan' });
    res.json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Nama supplier sudah ada' });
    throw e;
  }
});

suppliersRouter.delete('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const result = await pool.query('delete from suppliers where id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Supplier tidak ditemukan' });
    res.status(204).end();
  } catch (e: any) {
    if (e.code === '23503') return res.status(409).json({ error: 'Supplier sudah dipakai purchase order' });
    throw e;
  }
});