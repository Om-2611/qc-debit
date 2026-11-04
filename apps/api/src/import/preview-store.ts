import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { badRequest } from '../lib/errors';

/**
 * Parsed uploads wait here between "preview" and "confirm import": one JSON file per preview under
 * apps/api/tmp/import-previews (git-ignored). Files older than a day are removed whenever a new one is written.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
// apps/api, both from src/import (tsx, tests) and from the bundled dist/server.js.
const API_ROOT = [path.resolve(HERE, '..'), path.resolve(HERE, '../..')].find((dir) => existsSync(path.join(dir, 'package.json'))) ?? process.cwd();
const DIR = process.env.IMPORT_PREVIEW_DIR ?? path.join(API_ROOT, 'tmp', 'import-previews');
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const newPreviewId = (): string => randomUUID();

/** The id becomes a file name, so anything that is not a UUID is refused (no path traversal). */
function fileFor(previewId: string): string {
  if (!UUID.test(previewId)) throw badRequest('Invalid preview id');
  return path.join(DIR, `${previewId}.json`);
}

async function removeExpired(): Promise<void> {
  const cutoff = Date.now() - MAX_AGE_MS;
  for (const name of await fs.readdir(DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(DIR, name);
    try {
      if ((await fs.stat(file)).mtimeMs < cutoff) await fs.unlink(file);
    } catch {
      // another request removed it first
    }
  }
}

export async function writePreview(previewId: string, data: unknown): Promise<void> {
  await fs.mkdir(DIR, { recursive: true });
  await removeExpired();
  await fs.writeFile(fileFor(previewId), JSON.stringify(data), 'utf8');
}

/** null = unknown, expired or already committed. */
export async function readPreview<T>(previewId: string): Promise<T | null> {
  const file = fileFor(previewId);
  try {
    if (Date.now() - (await fs.stat(file)).mtimeMs > MAX_AGE_MS) return null;
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

export async function deletePreview(previewId: string): Promise<void> {
  await fs.rm(fileFor(previewId), { force: true });
}
