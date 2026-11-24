import request from 'supertest';
import bcrypt from 'bcryptjs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { app } from '../app';
import { pool } from '../db';

const PASSWORD = 'password123';

async function upsertUser(email: string, role: string) {
  const hash = await bcrypt.hash(PASSWORD, 4);
  await pool.query(
    `insert into users (name, email, password_hash, role)
     values ($1, $2, $3, $4)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [email, email, hash, role]
  );
}

async function login(email: string, password = PASSWORD) {
  return request(app).post('/auth/login').send({ email, password });
}

describe('auth dan hak akses', () => {
  beforeAll(async () => {
    await upsertUser('t-admin@test.local', 'admin');
    await upsertUser('t-kasir@test.local', 'kasir');
  });

  afterAll(async () => {
    await pool.query("delete from audit_logs where user_id in (select id from users where email like 't-%@test.local')");
    await pool.query("delete from users where email like 't-%@test.local'");
    await pool.end();
  });

  it('login berhasil mengembalikan token dan peran', async () => {
    const res = await login('t-kasir@test.local');
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('kasir');
  });

  it('password salah ditolak 401', async () => {
    const res = await login('t-kasir@test.local', 'salah');
    expect(res.status).toBe(401);
  });

  it('tanpa token ditolak 401', async () => {
    const res = await request(app).get('/users');
    expect(res.status).toBe(401);
  });

  it('kasir tidak boleh kelola user (403)', async () => {
    const { body } = await login('t-kasir@test.local');
    const res = await request(app).get('/users').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(403);
  });

  it('admin boleh kelola user (200)', async () => {
    const { body } = await login('t-admin@test.local');
    const res = await request(app).get('/users').set('Authorization', `Bearer ${body.token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});