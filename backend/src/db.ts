import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// kolom DATE tetap string 'YYYY-MM-DD', tidak diubah jadi Date (hindari geser zona waktu)
types.setTypeParser(1082, (v) => v);

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}