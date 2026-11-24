import { Router } from 'express';
import { pool } from '../db';
import { authenticate, requireRole } from '../middleware/auth';

export const auditRouter = Router();
auditRouter.use(authenticate, requireRole('admin'));

auditRouter.get('/', async (req, res) => {
  const entity = typeof req.query.entity === 'string' && req.query.entity ? req.query.entity : null;
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset) || 0, 0);

  const { rows } = await pool.query(
    `select a.id, a.action, a.entity, a.entity_id, a.before_data, a.after_data, a.created_at,
            u.name as user_name
     from audit_logs a left join users u on u.id = a.user_id
     where ($1::text is null or a.entity = $1)
     order by a.created_at desc, a.id desc
     limit $2 offset $3`,
    [entity, limit + 1, offset]
  );
  // minta satu baris lebih untuk tahu masih ada halaman berikutnya
  res.json({ rows: rows.slice(0, limit), has_more: rows.length > limit });
});