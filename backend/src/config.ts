import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl: process.env.DATABASE_URL ?? '',
  jwtSecret: process.env.JWT_SECRET ?? '',
};

if (!config.databaseUrl || !config.jwtSecret) {
  throw new Error('DATABASE_URL dan JWT_SECRET wajib diisi di .env');
}