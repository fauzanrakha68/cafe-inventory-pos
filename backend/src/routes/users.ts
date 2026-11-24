import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../db';
import { audit } from '../audit';
import { authenticate, requireRole } from '../middleware/auth';

export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('admin'));

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(['admin', 'kasir', 'store_keeper']),
});

usersRouter.get('/', async (_req, res) => {
  const { rows } = await pool.query(
    'select id, name, email, role, created_at from users order by id'
  );
  res.json(rows);
});

usersRouter.post('/', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });

  const { name, email, password, role } = parsed.data;
  const hash = await bcrypt.hash(password, 10);
  try {
    const { rows } = await pool.query(
      `insert into users (name, email, password_hash, role)
       values ($1, $2, $3, $4)
       returning id, name, email, role`,
      [name, email, hash, role]
    );
    await audit(pool, req.user!.id, 'create', 'user', rows[0].id, null, rows[0]);
    res.status(201).json(rows[0]);
  } catch (e: any) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email sudah terdaftar' });
    throw e;
  }
});