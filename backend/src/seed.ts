import bcrypt from 'bcryptjs';
import { pool } from './db';

async function main() {
  const hash = await bcrypt.hash('password123', 10);
  const users = [
    ['Admin', 'admin@cafe.test', 'admin'],
    ['Kasir Satu', 'kasir@cafe.test', 'kasir'],
    ['Store Keeper', 'store@cafe.test', 'store_keeper'],
  ];
  for (const [name, email, role] of users) {
    await pool.query(
      `insert into users (name, email, password_hash, role)
       values ($1, $2, $3, $4) on conflict (email) do nothing`,
      [name, email, hash, role]
    );
  }
  console.log('seed selesai');
  await pool.end();
}

main();