import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { authenticate } from '../middleware/auth';

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });

  const { email, password } = parsed.data;
  const { rows } = await pool.query(
    'select id, name, email, role, password_hash from users where email = $1',
    [email]
  );
  const user = rows[0];
  const ok = user && (await bcrypt.compare(password, user.password_hash));
  if (!ok) return res.status(401).json({ error: 'Email atau password salah' });

  const token = jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '8h' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
  });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const { rows } = await pool.query(
    'select id, name, email, role from users where id = $1',
    [req.user!.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'User tidak ditemukan' });
  res.json(rows[0]);
});