import { Router } from 'express';
import { z } from 'zod';
import { Pool, PoolClient } from 'pg';
import { pool, withTx } from '../db';
import { authenticate, requireRole } from '../middleware/auth';
import { parseId } from '../utils';

export const menusRouter = Router();
menusRouter.use(authenticate);

const menuSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().min(0),
  active: z.boolean().default(true),
  recipe: z
    .array(
      z.object({
        ingredient_id: z.number().int().positive(),
        quantity: z.number().positive(),
      })
    )
    .min(1),
});

async function getMenu(db: Pool | PoolClient, id: number) {
  const m = await db.query('select id, name, price, active from menus where id = $1', [id]);
  if (!m.rows[0]) return null;
  const r = await db.query(
    `select ri.ingredient_id, i.name, i.unit, ri.quantity
     from recipe_items ri join ingredients i on i.id = ri.ingredient_id
     where ri.menu_id = $1 order by i.name`,
    [id]
  );
  return { ...m.rows[0], recipe: r.rows };
}

function hasDuplicate(recipe: { ingredient_id: number }[]) {
  return new Set(recipe.map((r) => r.ingredient_id)).size !== recipe.length;
}

function handleDbError(e: any, res: import('express').Response) {
  if (e.code === '23505') return res.status(409).json({ error: 'Nama menu sudah dipakai' });
  if (e.code === '23503') return res.status(400).json({ error: 'Ada bahan resep yang tidak ditemukan' });
  throw e;
}

menusRouter.get('/', async (req, res) => {
  const seeAll = req.user!.role !== 'kasir';
  // resep ikut dikirim sebagai ringkasan, supaya UI tidak perlu satu request per menu
  const { rows } = await pool.query(
    `select m.id, m.name, m.price, m.active,
       coalesce(
         json_agg(
           json_build_object('ingredient_id', ri.ingredient_id, 'name', i.name, 'unit', i.unit, 'quantity', ri.quantity::text)
           order by i.name
         ) filter (where ri.ingredient_id is not null),
         '[]'::json
       ) as recipe
     from menus m
     left join recipe_items ri on ri.menu_id = m.id
     left join ingredients i on i.id = ri.ingredient_id
     where ($1::boolean or m.active)
     group by m.id
     order by m.name`,
    [seeAll]
  );
  res.json(rows);
});

menusRouter.get('/:id', async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const menu = await getMenu(pool, id);
  if (!menu) return res.status(404).json({ error: 'Menu tidak ditemukan' });
  res.json(menu);
});

menusRouter.post('/', requireRole('admin'), async (req, res) => {
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, price, active, recipe } = parsed.data;
  if (hasDuplicate(recipe)) return res.status(400).json({ error: 'Bahan resep tidak boleh dobel' });
  try {
    const menu = await withTx(async (client) => {
      const ins = await client.query(
        'insert into menus (name, price, active) values ($1, $2, $3) returning id',
        [name, price, active]
      );
      const menuId = ins.rows[0].id as number;
      for (const item of recipe) {
        await client.query(
          'insert into recipe_items (menu_id, ingredient_id, quantity) values ($1, $2, $3)',
          [menuId, item.ingredient_id, item.quantity]
        );
      }
      return getMenu(client, menuId);
    });
    res.status(201).json(menu);
  } catch (e) {
    return handleDbError(e, res);
  }
});

menusRouter.put('/:id', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  const parsed = menuSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Input tidak valid' });
  const { name, price, active, recipe } = parsed.data;
  if (hasDuplicate(recipe)) return res.status(400).json({ error: 'Bahan resep tidak boleh dobel' });
  try {
    const menu = await withTx(async (client) => {
      const upd = await client.query(
        'update menus set name = $1, price = $2, active = $3 where id = $4 returning id',
        [name, price, active, id]
      );
      if (!upd.rows[0]) return null;
      await client.query('delete from recipe_items where menu_id = $1', [id]);
      for (const item of recipe) {
        await client.query(
          'insert into recipe_items (menu_id, ingredient_id, quantity) values ($1, $2, $3)',
          [id, item.ingredient_id, item.quantity]
        );
      }
      return getMenu(client, id);
    });
    if (!menu) return res.status(404).json({ error: 'Menu tidak ditemukan' });
    res.json(menu);
  } catch (e) {
    return handleDbError(e, res);
  }
});

menusRouter.delete('/:id', requireRole('admin'), async (req, res) => {
  const id = parseId(req.params.id);
  if (!id) return res.status(400).json({ error: 'ID tidak valid' });
  try {
    const result = await pool.query('delete from menus where id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Menu tidak ditemukan' });
    res.status(204).end();
  } catch (e: any) {
    if (e.code === '23503') {
      return res.status(409).json({ error: 'Menu sudah pernah terjual, nonaktifkan saja' });
    }
    throw e;
  }
});