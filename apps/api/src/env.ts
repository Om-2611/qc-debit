import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Repo-root .env (apps/api/src → ../../../.env). Real environment variables win over the file.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  /** Production: folder of the built web app, served from the API's origin (see static.ts). */
  WEB_DIST: z.string().optional(),
  /** Web Push (browser notifications). Leave blank to turn push off; the in-app bell still works. See HANDOVER.md. */
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@dalmiapolypro.in'),
});

const parsed = schema.safeParse({
  ...process.env,
  API_PORT: process.env.API_PORT ?? process.env.PORT,
});
if (!parsed.success) {
  const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Invalid environment configuration (see .env.example):\n${lines}`);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  [parsed.data.JWT_ACCESS_SECRET, parsed.data.JWT_REFRESH_SECRET].some((s) => s.startsWith('change-me'))
) {
  throw new Error('Refusing to start in production with the placeholder JWT secrets from .env.example.');
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
