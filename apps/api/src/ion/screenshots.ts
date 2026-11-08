import { env } from '../env';
import { prisma } from '../prisma';

/** What the worker must produce (Playwright: page.screenshot({ type: 'jpeg', quality })), and the server enforces. */
export const SCREENSHOT_SPEC = { mime: 'image/jpeg', quality: 60, maxWidth: 1600, maxBytes: 1.5 * 1024 * 1024 } as const;

/** Width and height from the JPEG's start-of-frame marker; null when the bytes are not a JPEG. */
export function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1]!;
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    // Start-of-frame markers (not DHT 0xC4, JPG 0xC8, DAC 0xCC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (data[i + 5]! << 8) | data[i + 6]!, width: (data[i + 7]! << 8) | data[i + 8]! };
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    i += 2 + ((data[i + 2]! << 8) | data[i + 3]!);
  }
  return null;
}

/** Why this upload is not acceptable, or null. */
export function screenshotProblem(mime: string, data: Uint8Array): string | null {
  if (mime !== SCREENSHOT_SPEC.mime) return `Screenshots are stored as JPEG; got ${mime}.`;
  if (data.length === 0) return 'Empty screenshot.';
  if (data.length > SCREENSHOT_SPEC.maxBytes) return `Screenshot is larger than ${(SCREENSHOT_SPEC.maxBytes / 1024 / 1024).toFixed(1)} MB (JPEG quality ${SCREENSHOT_SPEC.quality}, width at most ${SCREENSHOT_SPEC.maxWidth}px).`;
  const size = jpegSize(data);
  if (!size) return 'The file is not a readable JPEG.';
  if (size.width > SCREENSHOT_SPEC.maxWidth) return `Screenshot is ${size.width}px wide; the limit is ${SCREENSHOT_SPEC.maxWidth}px.`;
  return null;
}

/** Pushes that went through: only their final screenshot is worth keeping once they are old. */
const SUCCESSFUL = ['SUBMITTED', 'DRAFT_CREATED', 'DRY_RUN_OK'] as const;

/**
 * Retention. Screenshots of failed, failed_retryable and check_manually pushes are kept whole. For a push that
 * finished successfully, everything but the last screenshot goes once it is `ION_SCREENSHOT_RETENTION_DAYS` old.
 * Returns how many were deleted.
 */
export async function cleanupScreenshots(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - env.ION_SCREENSHOT_RETENTION_DAYS * 86_400_000);
  const pushes = await prisma.ionPush.findMany({
    where: { status: { in: [...SUCCESSFUL] }, finishedAt: { lt: cutoff }, lockedBy: null, screenshots: { some: {} } },
    select: { id: true, screenshots: { select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
  let deleted = 0;
  for (const push of pushes) {
    const old = push.screenshots.slice(0, -1).map((s) => s.id);
    if (old.length === 0) continue;
    await prisma.$transaction([
      prisma.ionPushStep.updateMany({ where: { pushId: push.id, screenshotId: { in: old } }, data: { screenshotId: null } }),
      prisma.ionScreenshot.deleteMany({ where: { id: { in: old } } }),
    ]);
    deleted += old.length;
  }
  return deleted;
}

let lastCleanup = 0;

/** Called when a worker claims: at most once an hour, and a failure here never affects the claim. */
export function cleanupScreenshotsSometimes(now: Date = new Date()): void {
  if (now.getTime() - lastCleanup < 3_600_000) return;
  lastCleanup = now.getTime();
  cleanupScreenshots(now).catch((err) => console.error('iON screenshot cleanup failed', err));
}
