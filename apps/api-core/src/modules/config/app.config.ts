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

  // Public base URL where the API is reachable from the outside world.
  // Used to build OAuth callback URLs. On the VPS this is https://khohoc.online;
  // in dev it defaults to http://localhost:4000.
  publicBaseUrl: process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000',

  oauth: {
    google: {
      clientId: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
    },
    github: {
      clientId: process.env.GITHUB_OAUTH_CLIENT_ID ?? '',
      clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET ?? '',
    },
  },

  i18n: {
    default: process.env.DEFAULT_LOCALE ?? 'vi',
    supported: (process.env.SUPPORTED_LOCALES ?? 'vi,en').split(','),
  },

  database: { url: required('DATABASE_URL') },
  redis: { url: process.env.REDIS_URL ?? 'redis://localhost:6379' },
  // Telemetry store (P5+). Empty URL → writes no-op so the tutor and editor
  // still work if Mongo is offline; we never want telemetry to block a user.
  mongo: {
    url: process.env.MONGO_URL ?? '',
    db: process.env.MONGO_DB ?? 'lms_telemetry',
  },
  sandbox: { url: process.env.SANDBOX_URL ?? 'http://localhost:5001' },
  ai: {
    gatewayUrl: process.env.AI_GATEWAY_URL ?? 'http://localhost:5002',
    // Kept here only so the tier resolver can check whether paid-tier
    // routing is viable — the key itself is consumed inside ai-gateway.
    deepseek: { apiKey: process.env.DEEPSEEK_API_KEY ?? '' },
  },
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
