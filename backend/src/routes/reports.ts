import { Router } from 'express';
import { pool } from '../db';
import { authenticate, requireRole } from '../middleware/auth';

export const reportsRouter = Router();
reportsRouter.use(authenticate, requireRole('admin'));

const wibToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });

function isRealDate(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function shiftDays(s: string, n: number) {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// default: 7 hari terakhir (hari ini ikut) dalam zona WIB, maksimal 366 hari
function parseRange(query: any): { from: string; to: string } | { error: string } {
  const to = typeof query.to === 'string' ? query.to : wibToday();
  const from = typeof query.from === 'string' ? query.from : shiftDays(to, -6);
  if (!isRealDate(from) || !isRealDate(to)) return { error: 'Tanggal tidak valid (format YYYY-MM-DD)' };
  if (from > to) return { error: 'Tanggal awal tidak boleh setelah tanggal akhir' };
  if (shiftDays(from, 366) < to) return { error: 'Rentang maksimal 366 hari' };
  return { from, to };
}

type Day = { date: string; sales_count: number; revenue: number; cogs: number; profit: number; waste_cost: number };

async function buildReport(from: string, to: string) {
  // batas waktu memakai hari kalender WIB
  const range = `>= ($1::date::timestamp at time zone 'Asia/Jakarta')
                 and created_at < (($2::date + 1)::timestamp at time zone 'Asia/Jakarta')`;
  const day = `((created_at at time zone 'Asia/Jakarta')::date)`;

  const days = await pool.query(
    `with d as (select g::date as date from generate_series($1::date, $2::date, interval '1 day') g),
          s as (select ${day} as date, count(*) as n, sum(total) as revenue
                from sales where created_at ${range} group by 1),
          c as (select ((m.created_at at time zone 'Asia/Jakarta')::date) as date,
                       round(sum(-m.qty_change * b.unit_cost)) as cost
                from stock_movements m join stock_batches b on b.id = m.batch_id
                where m.type = 'sale' and m.created_at ${range.replace(/created_at/g, 'm.created_at')}
                group by 1),
          w as (select ((m.created_at at time zone 'Asia/Jakarta')::date) as date,
                       round(sum(-m.qty_change * b.unit_cost)) as cost
                from stock_movements m join stock_batches b on b.id = m.batch_id
                where m.type = 'waste' and m.created_at ${range.replace(/created_at/g, 'm.created_at')}
                group by 1)
     select to_char(d.date, 'YYYY-MM-DD') as date,
            coalesce(s.n, 0)::int as sales_count,
            coalesce(s.revenue, 0)::bigint as revenue,
            coalesce(c.cost, 0)::bigint as cogs,
            coalesce(w.cost, 0)::bigint as waste_cost
     from d left join s on s.date = d.date left join c on c.date = d.date left join w on w.date = d.date
     order by d.date`,
    [from, to]
  );

  const rows: Day[] = days.rows.map((r) => {
    const revenue = Number(r.revenue);
    const cogs = Number(r.cogs);
    return {
      date: r.date,
      sales_count: r.sales_count,
      revenue,
      cogs,
      profit: revenue - cogs,
      waste_cost: Number(r.waste_cost),
    };
  });

  const menus = await pool.query(
    `select m.name, sum(si.qty)::int as qty, sum(si.qty * si.unit_price)::bigint as revenue
     from sale_items si
     join sales s on s.id = si.sale_id
     join menus m on m.id = si.menu_id
     where s.created_at >= ($1::date::timestamp at time zone 'Asia/Jakarta')
       and s.created_at < (($2::date + 1)::timestamp at time zone 'Asia/Jakarta')
     group by m.id, m.name
     order by qty desc, m.name`,
    [from, to]
  );

  const totals = rows.reduce(
    (t, r) => ({
      sales_count: t.sales_count + r.sales_count,
      revenue: t.revenue + r.revenue,
      cogs: t.cogs + r.cogs,
      profit: t.profit + r.profit,
      waste_cost: t.waste_cost + r.waste_cost,
    }),
    { sales_count: 0, revenue: 0, cogs: 0, profit: 0, waste_cost: 0 }
  );

  return {
    from,
    to,
    days: rows,
    menus: menus.rows.map((m) => ({ name: m.name as string, qty: m.qty as number, revenue: Number(m.revenue) })),
    totals,
  };
}

reportsRouter.get('/summary', async (req, res) => {
  const range = parseRange(req.query);
  if ('error' in range) return res.status(400).json({ error: range.error });
  res.json(await buildReport(range.from, range.to));
});

function csvCell(v: string | number) {
  const s = String(v);
  // cegah rumus di Excel (CSV injection) lalu escape tanda kutip
  const safe = /^[=+\-@\t\r]/.test(s) && typeof v === 'string' ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

reportsRouter.get('/summary.csv', async (req, res) => {
  const range = parseRange(req.query);
  if ('error' in range) return res.status(400).json({ error: range.error });
  const r = await buildReport(range.from, range.to);

  const lines: (string | number)[][] = [
    ['Tanggal', 'Jumlah transaksi', 'Pendapatan', 'HPP', 'Laba kotor', 'Nilai pembuangan'],
    ...r.days.map((d) => [d.date, d.sales_count, d.revenue, d.cogs, d.profit, d.waste_cost]),
    ['Total', r.totals.sales_count, r.totals.revenue, r.totals.cogs, r.totals.profit, r.totals.waste_cost],
    [],
    ['Menu', 'Terjual', 'Pendapatan'],
    ...r.menus.map((m) => [m.name, m.qty, m.revenue]),
  ];
  const body = '\uFEFF' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="laporan-${r.from}_${r.to}.csv"`);
  res.send(body);
});