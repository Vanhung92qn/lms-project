import { registerAs } from '@nestjs/config';

/**
 * Strongly-typed application config. Values are read once from process.env at
 * startup. Anything missing here is a config error and should abort boot — we
 * do not silently fall back in production.
 */
export const appConfig = registerAs('app', () => ({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT_API ?? 4000),
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:3000',

  jwt: {
    accessSecret: required('JWT_ACCESS_SECRET'),
    refreshSecret: required('JWT_REFRESH_SECRET'),
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },

  i18n: {
    default: process.env.DEFAULT_LOCALE ?? 'vi',
    supported: (process.env.SUPPORTED_LOCALES ?? 'vi,en').split(','),
  },

  database: { url: required('DATABASE_URL') },
  redis: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
}));

function required(key: string): string {
  const v = process.env[key];
  if (!v || v.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    // In development we fall back to a stable-but-obviously-fake dev default
    // so `pnpm dev` works without a .env file on first run.
    return `dev-fallback-${key}`;
  }
  return v;
}
