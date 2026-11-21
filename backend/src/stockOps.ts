import { PoolClient } from 'pg';
import { fromMilli, toMilli } from './utils';

export type LockedBatch = { id: number; remaining_qty: string; expires_at: string };
export type Take = { id: number; take: bigint };

// Kunci semua batch yang masih ada sisa untuk satu bahan, kedaluwarsa terdekat dulu.
// Batch yang sudah kedaluwarsa ikut: fisiknya masih ada, jadi bisa dibuang atau dihitung saat opname.
export async function lockBatches(client: PoolClient, ingredientId: number): Promise<LockedBatch[]> {
  const r = await client.query(
    `select id, remaining_qty, expires_at from stock_batches
     where ingredient_id = $1 and remaining_qty > 0
     order by expires_at, id
     for update`,
    [ingredientId]
  );
  return r.rows;
}

// Bagi kebutuhan (seperseribu satuan) ke batch berurutan. `short` > 0 berarti stok tidak cukup.
export function allocate(batches: LockedBatch[], amount: bigint): { takes: Take[]; short: bigint } {
  let left = amount;
  const takes: Take[] = [];
  for (const b of batches) {
    if (left <= 0n) break;
    const avail = toMilli(b.remaining_qty);
    const take = avail < left ? avail : left;
    takes.push({ id: b.id, take });
    left -= take;
  }
  return { takes, short: left };
}

// Kurangi batch dan catat tiap pengurangan di buku besar.
export async function applyTakes(
  client: PoolClient,
  ingredientId: number,
  takes: Take[],
  type: 'waste' | 'opname',
  refId: number,
  userId: number
) {
  for (const t of takes) {
    await client.query(
      'update stock_batches set remaining_qty = remaining_qty - $1::numeric where id = $2',
      [fromMilli(t.take), t.id]
    );
    await client.query(
      `insert into stock_movements (ingredient_id, batch_id, type, qty_change, ref_type, ref_id, created_by)
       values ($1, $2, $3, $4::numeric, $3, $5, $6)`,
      [ingredientId, t.id, type, fromMilli(-t.take), refId, userId]
    );
  }
}

// Angka dari klien (number) -> seperseribu satuan, dibulatkan ke 3 desimal seperti kolom numeric(14,3).
export function toMilliFromNumber(n: number): bigint {
  return toMilli(n.toFixed(3));
}