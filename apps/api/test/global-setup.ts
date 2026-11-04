import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Creates (if needed) and migrates the dedicated test database before any test file runs. */
export default function setup(): void {
  const url = process.env.DATABASE_URL ?? '';
  if (!/_test(\?|$)/.test(url)) {
    throw new Error(`Refusing to run API tests against a non-test database: ${url || '(unset)'}`);
  }
  execSync('pnpm exec prisma migrate deploy', {
    cwd: path.resolve(here, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
