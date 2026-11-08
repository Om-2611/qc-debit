import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Repo-root .env (apps/api/src → ../../../.env). Real environment variables win over the file.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

/** A blank line in .env (KEY=) means unset. */
const blankToUndefined = <T extends z.ZodTypeAny>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema);

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
  /** Master switch for "Load on TCS iON". Off by default everywhere; jobs are neither created nor handed to the worker while off. */
  ION_PUSH_ENABLED: z
    .enum(['true', 'false', '1', '0'])
    .default('false')
    .transform((v) => v === 'true' || v === '1'),
  /** Which iON the jobs created here are for. The worker only takes jobs of the environment it is connected to. */
  ION_ENV: z.enum(['training', 'live']).default('training'),
  /** dry_run | draft_only | full. Default draft_only everywhere: set full explicitly to let jobs Submit. On live this is the only mode; nobody can pick another. */
  ION_RUN_MODE: blankToUndefined(z.enum(['dry_run', 'draft_only', 'full']).optional()),
  /** Shared secret of the worker PC, sent as a bearer token to /api/ion-worker. Unset = the worker API answers 503. */
  ION_WORKER_TOKEN: blankToUndefined(z.string().min(32, 'ION_WORKER_TOKEN must be at least 32 characters').optional()),
  /** A running job whose worker has been silent this long is treated as dead. */
  ION_HEARTBEAT_TIMEOUT_SECONDS: z.coerce.number().int().min(10).default(120),
  /** Screenshots of successful pushes are thinned to the final one after this many days; those of failed / check_manually pushes are kept. */
  ION_SCREENSHOT_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Automatic re-queues after a transient failure before anything exists in iON. */
  ION_MAX_AUTO_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
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
/** The run mode jobs get when the request does not (and, on live, always). Draft-only unless ION_RUN_MODE=full is set explicitly. */
export const defaultIonRunMode = (): 'dry_run' | 'draft_only' | 'full' => env.ION_RUN_MODE ?? 'draft_only';
export const isProduction = env.NODE_ENV === 'production';
