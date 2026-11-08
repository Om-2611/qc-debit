import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

// Set on process.env (not `test.env`) so the global setup and every worker see the same values.
// Tests must never touch the development database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://dalmia:dalmia_dev@localhost:5433/dalmia_qc_test?schema=public';

// The iON push is off by default; its tests switch it on.
process.env.ION_PUSH_ENABLED = 'true';
process.env.ION_ENV = 'training';
delete process.env.ION_RUN_MODE;
process.env.ION_WORKER_TOKEN = 'test-worker-token-0123456789-0123456789-abcdef';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Tests share one database, so files run one after another.
    fileParallelism: false,
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
