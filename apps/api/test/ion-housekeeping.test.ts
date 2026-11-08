import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { env } from '../src/env';
import { cleanupScreenshots, jpegSize, screenshotProblem } from '../src/ion/screenshots';
import { prisma } from '../src/prisma';
import { fakeJpeg, login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
let admin: Session;
let adminId: string;
let reportId: string;

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  admin = await login(app, 'ADMIN');
  adminId = (await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id;
  const report = await prisma.report.create({ data: { reportNo: 'QC/26-27/0001', status: 'APPROVED', reportDate: new Date('2026-11-03'), createdById: adminId } });
  reportId = report.id;
});
afterEach(async () => {
  await prisma.ionPush.deleteMany();
});
afterAll(async () => {
  await prisma.importBatch.deleteMany();
  await resetDatabase();
  await seedEngineConfig();
  await prisma.$disconnect();
});

describe('JPEG screenshots', () => {
  it('reads the size from the start-of-frame marker and refuses anything else', () => {
    expect(jpegSize(fakeJpeg(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(jpegSize(Buffer.from('nope'))).toBeNull();
    expect(screenshotProblem('image/jpeg', fakeJpeg(1600, 900))).toBeNull();
    expect(screenshotProblem('image/jpeg', fakeJpeg(1601, 900))).toContain('1601px');
    expect(screenshotProblem('image/png', fakeJpeg())).toContain('JPEG');
    expect(screenshotProblem('image/jpeg', Buffer.alloc(0))).toContain('Empty');
  });
});

describe('screenshot retention', () => {
  /** A finished push with `n` screenshots, the first one `ageDays` old and each later one an hour newer. */
  async function pushWith(status: 'SUBMITTED' | 'DRAFT_CREATED' | 'DRY_RUN_OK' | 'FAILED' | 'FAILED_RETRYABLE' | 'CHECK_MANUALLY' | 'RUNNING', ageDays: number, n = 4) {
    const finished = ageDays === 0 ? null : ago(ageDays);
    const push = await prisma.ionPush.create({
      data: {
        reportId,
        env: 'TRAINING',
        runMode: status === 'DRY_RUN_OK' ? 'DRY_RUN' : 'DRAFT_ONLY',
        status,
        payload: {},
        requestedById: adminId,
        finishedAt: finished,
        lockedBy: status === 'RUNNING' ? 'pc-1' : null,
        // reset, so several of these can coexist for one report
        resetAt: new Date(),
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const shot = await prisma.ionScreenshot.create({ data: { pushId: push.id, label: `s${i + 1}`, mime: 'image/jpeg', data: new Uint8Array(fakeJpeg(800, 600, 50)), createdAt: new Date((finished ?? new Date()).getTime() - (n - i) * 3_600_000) } });
      ids.push(shot.id);
      await prisma.ionPushStep.create({ data: { pushId: push.id, seq: i + 1, step: `step ${i + 1}`, outcome: 'ok', screenshotId: shot.id } });
    }
    return { push, ids };
  }
  const left = (pushId: string) => prisma.ionScreenshot.findMany({ where: { pushId }, orderBy: { createdAt: 'asc' }, select: { label: true } });

  it('keeps everything for failed, failed_retryable and check_manually pushes, however old', async () => {
    const kept = [await pushWith('FAILED', 400), await pushWith('FAILED_RETRYABLE', 400), await pushWith('CHECK_MANUALLY', 400)];
    expect(await cleanupScreenshots()).toBe(0);
    for (const { push } of kept) expect(await left(push.id)).toHaveLength(4);
  });

  it('thins a successful push to its final screenshot once it is older than the retention days', async () => {
    expect(env.ION_SCREENSHOT_RETENTION_DAYS).toBe(30);
    const old = await pushWith('SUBMITTED', 31);
    const draft = await pushWith('DRAFT_CREATED', 45);
    const dry = await pushWith('DRY_RUN_OK', 90);
    expect(await cleanupScreenshots()).toBe(9);
    for (const { push } of [old, draft, dry]) expect(await left(push.id)).toEqual([{ label: 's4' }]);
    // the step log stays, only the dead links go
    const steps = await prisma.ionPushStep.findMany({ where: { pushId: old.push.id }, orderBy: { seq: 'asc' } });
    expect(steps.map((s) => s.screenshotId)).toEqual([null, null, null, old.ids[3]]);
    // idempotent
    expect(await cleanupScreenshots()).toBe(0);
  });

  it('leaves recent successful pushes and running jobs alone', async () => {
    const recent = await pushWith('SUBMITTED', 29);
    const running = await pushWith('RUNNING', 0);
    expect(await cleanupScreenshots()).toBe(0);
    expect(await left(recent.push.id)).toHaveLength(4);
    expect(await left(running.push.id)).toHaveLength(4);
  });

  it('follows the retention setting', async () => {
    const push = await pushWith('SUBMITTED', 10);
    expect(await cleanupScreenshots()).toBe(0);
    env.ION_SCREENSHOT_RETENTION_DAYS = 7;
    try {
      expect(await cleanupScreenshots()).toBe(3);
      expect(await left(push.push.id)).toHaveLength(1);
    } finally {
      env.ION_SCREENSHOT_RETENTION_DAYS = 30;
    }
  });
});

describe('undoing an import that was loaded on iON', () => {
  async function importedReport(reportNo: string, batchId: string) {
    return prisma.report.create({ data: { reportNo, status: 'APPROVED', source: 'IMPORTED', reportDate: new Date('2026-11-03'), createdById: adminId, importBatchId: batchId } });
  }
  async function batchOf(...reportNos: string[]) {
    const batch = await prisma.importBatch.create({ data: { fileName: 'trucks.xlsx', uploadedById: adminId, importedCount: reportNos.length } });
    const reports = [];
    for (const no of reportNos) reports.push(await importedReport(no, batch.id));
    return { batch, reports };
  }
  const undo = (batchId: string) => request(app).delete(`/api/admin/import/batches/${batchId}`).set(admin.auth);
  const push = (reportId: string, data: object) => prisma.ionPush.create({ data: { reportId, env: 'TRAINING', runMode: 'DRAFT_ONLY', payload: {}, requestedById: adminId, ...data } });

  afterEach(async () => {
    await prisma.ionPush.deleteMany({ where: { report: { reportNo: { startsWith: 'IMP/' } } } });
    await prisma.report.deleteMany({ where: { reportNo: { startsWith: 'IMP/' } } });
    await prisma.importBatch.deleteMany();
  });

  it('is refused while any report has a live iON push, naming the QC numbers and DN numbers', async () => {
    const { batch, reports } = await batchOf('IMP/1', 'IMP/2', 'IMP/3');
    await push(reports[0]!.id, { status: 'DRAFT_CREATED', ionDnNo: 'NL/APDN/4621', finishedAt: new Date() });
    await push(reports[1]!.id, { status: 'CHECK_MANUALLY', draftClickedAt: new Date(), finishedAt: new Date() });
    const res = await undo(batch.id);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('IMP/1 (iON NL/APDN/4621)');
    expect(res.body.message).toContain('IMP/2 (iON push check manually, no DN number)');
    expect(res.body.message).not.toContain('IMP/3');
    // nothing was touched
    expect(await prisma.report.count({ where: { importBatchId: batch.id } })).toBe(3);
    expect((await prisma.importBatch.findUniqueOrThrow({ where: { id: batch.id } })).undoneAt).toBeNull();
    expect(await prisma.ionPush.count()).toBe(2);
  });

  it('goes through once those pushes are reset, and takes dry runs and reset pushes away with the reports', async () => {
    const { batch, reports } = await batchOf('IMP/1', 'IMP/2');
    await push(reports[0]!.id, { status: 'SUBMITTED', ionDnNo: 'NL/APDN/4621', finishedAt: new Date(), resetAt: new Date(), resetNote: 'cancelled in iON' });
    await push(reports[1]!.id, { status: 'DRY_RUN_OK', runMode: 'DRY_RUN', finishedAt: new Date() });
    const res = await undo(batch.id);
    expect(res.status).toBe(200);
    expect(res.body.deletedReports).toBe(2);
    expect(await prisma.ionPush.count()).toBe(0);
  });

  it('still undoes an import with no iON push, as before', async () => {
    const { batch } = await batchOf('IMP/1');
    expect((await undo(batch.id)).status).toBe(200);
  });
});
