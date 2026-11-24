import { Pool, PoolClient } from 'pg';

export type AuditAction = 'create' | 'update' | 'delete' | 'receive' | 'cancel';

// Catat siapa mengubah apa. Panggil dengan client transaksi yang sama dengan perubahan datanya,
// supaya jejak audit dan datanya selalu berhasil atau gagal bersama.
export async function audit(
  db: Pool | PoolClient,
  userId: number,
  action: AuditAction,
  entity: string,
  entityId: number | null,
  before: unknown,
  after: unknown
): Promise<void> {
  await db.query(
    `insert into audit_logs (user_id, action, entity, entity_id, before_data, after_data)
     values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      userId,
      action,
      entity,
      entityId,
      before === null || before === undefined ? null : JSON.stringify(before),
      after === null || after === undefined ? null : JSON.stringify(after),
    ]
  );
}