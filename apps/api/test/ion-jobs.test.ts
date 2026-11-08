import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { IonReportViewDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { env } from '../src/env';
import { todayIst } from '../src/ion/money';
import { prisma } from '../src/prisma';
import { fakeJpeg, login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
const TOKEN = process.env.ION_WORKER_TOKEN!;
const bearer = { Authorization: `Bearer ${TOKEN}` };
let admin: Session, manager: Session;
let reportId: string;

/** The approved golden report: Ecoloom (UP) into DPNL, Rs 1,000. */
async function seedGoldenReport(): Promise<string> {
  const [adminUser, plant, clear, green, moisture] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } }),
    prisma.plant.findUniqueOrThrow({ where: { code: 'DPNL' } }),
    prisma.material.findUniqueOrThrow({ where: { code: 'CLEAR' } }),
    prisma.material.findUniqueOrThrow({ where: { code: 'GREEN' } }),
    prisma.parameter.findUniqueOrThrow({ where: { code: 'MOISTURE' } }),
  ]);
  await prisma.material.update({ where: { id: clear.id }, data: { ionItemCode: 'RM-13001' } });
  const supplier = await prisma.supplier.create({ data: { name: 'Ecoloom', code: 'ECO', gstin: '09AAAAA0000A1Z5', ionSupplierCode: 'CRRM_140290', ionStateCode: '09' } });
  const report = await prisma.report.create({
    data: {
      reportNo: 'QC/26-27/0013',
      status: 'APPROVED',
      reportDate: new Date('2026-11-03'),
      supplierId: supplier.id,
      plantId: plant.id,
      truckNumber: 'MH 15 XY 1234',
      grnNumber: 'DPNL/GRN_RM/2627/4331',
      invoiceNumber: 'ECPL/26-27/0632',
      invoiceDate: new Date('2026-10-27'),
      approvedTotal: '1000.00',
      createdById: adminUser.id,
      materialLines: {
        create: [
          { materialId: clear.id, invoiceWeightKg: 10000, invoiceRate: 30 },
          { materialId: green.id, invoiceWeightKg: 2000, invoiceRate: 20 },
        ],
      },
      deductions: {
        create: [{ parameterId: moisture.id, normPercent: 0, actualPercent: 0, rate: 0, weightBase: 'TOTAL_DALMIA_WEIGHT', standardQty: 0, standardAmount: 0, approvedQty: 0, approvedAmount: 1000, differenceQty: 0, differenceAmount: 0 }],
      },
    },
  });
  return report.id;
}

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [admin, manager] = await Promise.all([login(app, 'ADMIN'), login(app, 'QC_MANAGER')]);
  reportId = await seedGoldenReport();
});
afterEach(async () => {
  // Scenarios start clean; the real reset path has its own test.
  await prisma.ionPush.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany({ where: { reportId } });
  env.ION_PUSH_ENABLED = true;
  env.ION_ENV = 'training';
  env.ION_WORKER_TOKEN = TOKEN;
});
afterAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------- helpers

/** Most scenarios need a full run; on live the server fixes the mode, so nothing is added there. */
const create = (body: object = {}) => request(app).post(`/api/ion/reports/${reportId}/push`).set(admin.auth).send(env.ION_ENV === 'live' ? body : { runMode: 'full', ...body });
const createDefault = () => request(app).post(`/api/ion/reports/${reportId}/push`).set(admin.auth).send({});
const view = async (): Promise<IonReportViewDto> => (await request(app).get(`/api/ion/reports/${reportId}`).set(admin.auth)).body;
const claimAs = (workerId: string, environment: 'training' | 'live' = 'training') => request(app).post('/api/ion-worker/claim').set(bearer).send({ workerId, env: environment });
const w = (id: string, path: string, body: object) => request(app).post(`/api/ion-worker/pushes/${id}/${path}`).set(bearer).send(body);
const milestone = (id: string, workerId: string, name: string, extra: object = {}) => w(id, 'milestone', { workerId, name, ...extra });
const finishAs = (id: string, workerId: string, body: object) => w(id, 'finish', { workerId, ...body });
const row = (id: string) => prisma.ionPush.findUniqueOrThrow({ where: { id } });

/** Create + claim; returns the job. */
async function queueAndClaim(workerId = 'pc-1', body: object = {}) {
  const res = await create(body);
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const job = await claimAs(workerId);
  expect(job.status).toBe(200);
  return job.body as { id: string; runMode: string; payload: { amount: string; voucherDate: string }; resume: { dnNo: string; checkpoint: string | null } | null };
}
const editsDone = async (id: string, wid: string) => {
  for (const checkpoint of ['item_saved', 'taxes_done', 'expense_saved']) expect((await milestone(id, wid, 'checkpoint', { checkpoint })).status).toBe(204);
};
const adminNotifications = () => prisma.notification.count({ where: { user: { role: 'ADMIN' } } });

// ---------------------------------------------------------------- access

describe('who may do what', () => {
  it('the admin API is for admins; the worker API needs the worker token and answers 503 when none is set', async () => {
    expect((await request(app).post(`/api/ion/reports/${reportId}/push`).send({})).status).toBe(401);
    expect((await request(app).post(`/api/ion/reports/${reportId}/push`).set(manager.auth).send({})).status).toBe(403);
    expect((await request(app).get(`/api/ion/reports/${reportId}`).set(manager.auth)).status).toBe(403);

    expect((await request(app).post('/api/ion-worker/claim').send({ workerId: 'x', env: 'training' })).status).toBe(401);
    expect((await request(app).post('/api/ion-worker/claim').set('Authorization', 'Bearer wrong').send({ workerId: 'x', env: 'training' })).status).toBe(401);
    // a user's login token is not a worker token
    expect((await request(app).post('/api/ion-worker/claim').set(admin.auth).send({ workerId: 'x', env: 'training' })).status).toBe(401);
    env.ION_WORKER_TOKEN = undefined;
    expect((await request(app).post('/api/ion-worker/claim').set(bearer).send({ workerId: 'x', env: 'training' })).status).toBe(503);
  });

  it('nothing is created or handed out while ION_PUSH_ENABLED is off', async () => {
    env.ION_PUSH_ENABLED = false;
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('ION_PUSH_ENABLED');
    env.ION_PUSH_ENABLED = true;
    expect((await create()).status).toBe(201);
    env.ION_PUSH_ENABLED = false;
    expect((await claimAs('pc-1')).status).toBe(204);
  });
});

// ---------------------------------------------------------------- creating

describe('creating the job', () => {
  it('returns at once with a queued job, the payload fixed, and an audit row', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.push).toMatchObject({ status: 'QUEUED', env: 'TRAINING', runMode: 'FULL', ionDnNo: null, active: false, canReset: true, canRetry: false });
    const saved = await row(res.body.push.id);
    expect(saved.payload).toMatchObject({ amount: '1000.00', supplierCode: 'CRRM_140290', itemCode: 'RM-13001' });
    expect(saved.requestedById).toBe((await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } })).id);
    expect(await prisma.auditLog.count({ where: { reportId, action: 'ION_PUSH_CREATE' } })).toBe(1);
  });

  it('without a run mode every job is draft-only, on training too: it stops before Submit', async () => {
    const res = await createDefault();
    expect(res.status).toBe(201);
    expect(res.body.push).toMatchObject({ env: 'TRAINING', runMode: 'DRAFT_ONLY' });
    expect(res.body.runMode).toBe('DRAFT_ONLY');
    const job = (await claimAs('pc-1')).body;
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' });
    await editsDone(job.id, 'pc-1');
    expect((await milestone(job.id, 'pc-1', 'submit_click')).status).toBe(409);
  });

  it('refuses with the pre-flight list while something is missing', async () => {
    await prisma.supplier.update({ where: { code: 'ECO' }, data: { ionSupplierCode: null } });
    const res = await create();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('PREFLIGHT_FAILED');
    expect(res.body.details.issues.map((i: { code: string }) => i.code)).toEqual(['ION_SUPPLIER_CODE_MISSING']);
    await prisma.supplier.update({ where: { code: 'ECO' }, data: { ionSupplierCode: 'CRRM_140290' } });
    expect(await prisma.ionPush.count()).toBe(0);
  });

  it('one report, one debit note: a second push is refused, and the database itself refuses a second live row', async () => {
    expect((await create()).status).toBe(201);
    const again = await create();
    expect(again.status).toBe(409);
    expect(again.body.details.issues.map((i: { code: string }) => i.code)).toContain('PUSH_EXISTS');
    // even around the application: the partial unique index
    const first = await prisma.ionPush.findFirstOrThrow();
    await expect(prisma.ionPush.create({ data: { reportId, env: 'TRAINING', runMode: 'FULL', payload: {}, requestedById: first.requestedById } })).rejects.toMatchObject({ code: 'P2002' });
    // a dry-run row is not live, so it may coexist
    await prisma.ionPush.create({ data: { reportId, env: 'TRAINING', runMode: 'DRY_RUN', payload: {}, requestedById: first.requestedById } });
  });

  it('an imported report with a mismatch needs the explicit tick, which is audited', async () => {
    await prisma.report.update({ where: { id: reportId }, data: { hasMismatch: true } });
    const blocked = await create();
    expect(blocked.status).toBe(409);
    expect(blocked.body.details.issues.map((i: { code: string }) => i.code)).toContain('MISMATCH_UNCONFIRMED');
    expect((await create({ mismatchConfirmed: true })).status).toBe(201);
    expect(await prisma.auditLog.count({ where: { reportId, action: 'ION_MISMATCH_CONFIRMED' } })).toBe(1);
    expect((await row((await view()).push!.id)).mismatchConfirmedById).not.toBeNull();
    await prisma.report.update({ where: { id: reportId }, data: { hasMismatch: false } });
  });

  it('the per-report item code override wins and is kept', async () => {
    const res = await create({ itemCodeOverride: 'RM-13002' });
    expect(res.status).toBe(201);
    expect(res.body.push.itemCodeOverride).toBe('RM-13002');
    expect((await row(res.body.push.id)).payload).toMatchObject({ itemCode: 'RM-13002', itemCodeSource: 'override' });
  });

  it('a dry run is out of the way once a real push is created', async () => {
    const dry = await create({ runMode: 'dry_run' });
    expect(dry.body.push.runMode).toBe('DRY_RUN');
    expect(dry.body.preflight.issues.map((i: { code: string }) => i.code)).not.toContain('PUSH_EXISTS');
    const job = (await claimAs('pc-1')).body;
    expect((await finishAs(job.id, 'pc-1', { outcome: 'completed' })).body.status).toBe('DRY_RUN_OK');
    const real = await create({ runMode: 'full' });
    expect(real.status).toBe(201);
    expect(real.body.push.runMode).toBe('FULL');
    expect(real.body.history).toMatchObject([{ status: 'DRY_RUN_OK', resetNote: 'Superseded by a new push' }]);
  });

  it('on live the run mode is fixed by the server (draft_only unless ION_RUN_MODE says otherwise)', async () => {
    env.ION_ENV = 'live';
    const refused = await create({ runMode: 'full' });
    expect(refused.status).toBe(409);
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.push).toMatchObject({ env: 'LIVE', runMode: 'DRAFT_ONLY' });
    // the training worker cannot take a live job, and a live job cannot be continued to Submit
    expect((await claimAs('pc-1', 'training')).status).toBe(204);
    env.ION_ENV = 'live';
    const job = (await claimAs('pc-1', 'live')).body;
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/9001' });
    await editsDone(job.id, 'pc-1');
    expect((await finishAs(job.id, 'pc-1', { outcome: 'completed' })).status).toBe(200);
    const cont = await request(app).post(`/api/ion/reports/${reportId}/continue`).set(admin.auth);
    expect(cont.status).toBe(409);
    expect(cont.body.message).toContain('draft-only');
  });
});

// ---------------------------------------------------------------- the worker's run

describe('one job at a time', () => {
  it('hands out the job once, to one worker, and nothing else while it runs', async () => {
    await create();
    const job = await claimAs('pc-1');
    expect(job.status).toBe(200);
    expect(job.body).toMatchObject({ env: 'TRAINING', runMode: 'FULL', resume: null, payload: { amount: '1000.00', partyAddressLabel: 'CRRM_140290 (Bill to Address)' } });
    expect(job.body.config).toMatchObject({ deleteTdsLine: true, deleteZeroItemLines: false, grirLedger: 'CL-CFIL-GRIR100420' });
    expect((await claimAs('pc-2')).status).toBe(204);
    expect((await claimAs('pc-1')).status).toBe(204);
    // another worker cannot touch it
    expect((await w(job.body.id, 'heartbeat', { workerId: 'pc-2' })).status).toBe(409);
    expect((await w(job.body.id, 'heartbeat', { workerId: 'pc-1' })).status).toBe(204);
    expect((await view()).push).toMatchObject({ status: 'RUNNING', active: true, canReset: false, attempts: 1 });
  });

  it('two workers claiming at the same instant: exactly one gets the job', async () => {
    await create();
    const results = await Promise.all(['pc-1', 'pc-2', 'pc-3', 'pc-4'].map((id) => claimAs(id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 204)).toHaveLength(3);
    expect((await prisma.ionPush.findFirstOrThrow()).attempts).toBe(1);
  });

  it('a second job waits for the first to finish', async () => {
    await create({ runMode: 'dry_run' });
    const first = (await claimAs('pc-1')).body;
    // second report, same masters
    const report2 = await prisma.report.create({ data: { ...(await prisma.report.findUniqueOrThrow({ where: { id: reportId }, select: { reportDate: true, supplierId: true, plantId: true, createdById: true, status: true, grnNumber: true, invoiceNumber: true, invoiceDate: true, approvedTotal: true } })), reportNo: 'QC/26-27/0014' } });
    await prisma.ionPush.create({ data: { reportId: report2.id, env: 'TRAINING', runMode: 'DRY_RUN', payload: {}, requestedById: report2.createdById } });
    expect((await claimAs('pc-2')).status).toBe(204);
    await finishAs(first.id, 'pc-1', { outcome: 'completed' });
    const second = await claimAs('pc-2');
    expect(second.status).toBe(200);
    await finishAs(second.body.id, 'pc-2', { outcome: 'completed' });
    await prisma.ionPush.deleteMany();
    await prisma.report.delete({ where: { id: report2.id } });
  });
});

describe('a full run', () => {
  it('goes through the milestones in order, keeps the DN number, screenshots and step log, and audits the numbers', async () => {
    const job = await queueAndClaim();
    const id = job.id;

    // out of order is refused
    expect((await milestone(id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' })).status).toBe(409);
    expect((await milestone(id, 'pc-1', 'submit_click')).status).toBe(409);
    expect((await milestone(id, 'pc-1', 'draft_created')).status).toBe(409); // no number given

    const png = fakeJpeg(1280, 720, 64);
    const shot = await request(app).post(`/api/ion-worker/pushes/${id}/screenshots?workerId=pc-1&label=header-filled`).set(bearer).set('Content-Type', 'image/jpeg').send(png);
    expect(shot.status).toBe(201);
    expect((await w(id, 'steps', { workerId: 'pc-1', step: 'B1 organization', outcome: 'ok', message: 'DPNL', screenshotId: shot.body.id })).status).toBe(204);

    expect((await milestone(id, 'pc-1', 'draft_click')).status).toBe(204);
    expect((await row(id)).draftClickedAt).not.toBeNull();
    expect((await milestone(id, 'pc-1', 'draft_click')).status).toBe(409);
    expect((await milestone(id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621', ionStatus: 'Draft' })).status).toBe(204);
    expect((await milestone(id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4622' })).status).toBe(409);
    expect((await milestone(id, 'pc-1', 'submit_click')).status).toBe(409); // Item Expense not done yet
    await editsDone(id, 'pc-1');
    expect((await milestone(id, 'pc-1', 'submit_click')).status).toBe(204);
    expect((await milestone(id, 'pc-1', 'submitted', { ionStatus: 'Submitted' })).status).toBe(204);
    const done = await finishAs(id, 'pc-1', { outcome: 'completed' });
    expect(done.body).toEqual({ status: 'SUBMITTED', ionDnNo: 'NL/APDN/4621' });

    const v = await view();
    expect(v.push).toMatchObject({ status: 'SUBMITTED', ionDnNo: 'NL/APDN/4621', ionStatus: 'Submitted', checkpoint: 'expense_saved', active: false, canRetry: false, canReset: true });
    expect(v.push!.steps.map((s) => s.step)).toEqual(expect.arrayContaining(['requested', 'claimed', 'B1 organization', 'milestone: draft click', 'milestone: draft created', 'milestone: submitted', 'finished']));
    expect(v.push!.steps.map((s) => s.seq)).toEqual(v.push!.steps.map((_, i) => i + 1));
    expect(v.push!.screenshots).toHaveLength(1);
    const image = await request(app).get(`/api/ion/screenshots/${shot.body.id}`).set(admin.auth);
    expect(image.status).toBe(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(image.body).equals(png)).toBe(true);
    expect((await request(app).get(`/api/ion/screenshots/${shot.body.id}`).set(manager.auth)).status).toBe(403);

    const audits = await prisma.auditLog.findMany({ where: { reportId, action: { in: ['ION_WORKER_DRAFT_CREATED', 'ION_WORKER_SUBMITTED'] } }, orderBy: { at: 'asc' } });
    expect(audits.map((a) => [a.action, a.newValue])).toEqual([['ION_WORKER_DRAFT_CREATED', 'NL/APDN/4621 (by iON worker)'], ['ION_WORKER_SUBMITTED', 'NL/APDN/4621 (by iON worker)']]);
    // a submitted note cannot be loaded or retried again
    expect((await create()).status).toBe(409);
    expect((await request(app).post(`/api/ion/reports/${reportId}/retry`).set(admin.auth)).status).toBe(409);
  });

  it('screenshots must be JPEG, at most 1600 px wide and small; the claim tells the worker the spec', async () => {
    const job = await queueAndClaim();
    expect((await claimAs('pc-1')).status).toBe(204);
    const post = (type: string, body: Buffer) => request(app).post(`/api/ion-worker/pushes/${job.id}/screenshots?workerId=pc-1&label=x`).set(bearer).set('Content-Type', type).send(body);
    expect((await post('text/plain', Buffer.from('hi'))).status).toBe(415);
    const png = await post('image/png', Buffer.from('89504e470d0a1a0a', 'hex'));
    expect(png.status).toBe(409);
    expect(png.body.message).toContain('JPEG');
    const notReally = await post('image/jpeg', Buffer.from('definitely not a jpeg'));
    expect(notReally.status).toBe(409);
    expect(notReally.body.message).toContain('readable JPEG');
    const wide = await post('image/jpeg', fakeJpeg(1920, 1080));
    expect(wide.status).toBe(409);
    expect(wide.body.message).toContain('1920px');
    expect((await post('image/jpeg', fakeJpeg(1600, 900, 1.6 * 1024 * 1024))).status).toBe(409); // too large
    expect((await post('image/jpeg', fakeJpeg(1600, 900, 1024))).status).toBe(201);
  });

  it('the claim carries the screenshot spec', async () => {
    await create();
    const job = (await claimAs('pc-1')).body;
    expect(job.config.screenshot).toEqual({ type: 'jpeg', quality: 60, maxWidth: 1600 });
  });
});

describe('draft_only', () => {
  it('stops at the draft; a person reviews it in iON; Continue lets the worker resume that draft and Submit', async () => {
    const job = await queueAndClaim('pc-1', { runMode: 'draft_only' });
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' });
    expect((await finishAs(job.id, 'pc-1', { outcome: 'completed' })).status).toBe(409); // Item Expense not done
    expect((await milestone(job.id, 'pc-1', 'submit_click')).status).toBe(409);
    await editsDone(job.id, 'pc-1');
    expect((await finishAs(job.id, 'pc-1', { outcome: 'completed' })).body.status).toBe('DRAFT_CREATED');
    expect((await view()).push).toMatchObject({ status: 'DRAFT_CREATED', active: false, canContinue: true, canRetry: false });

    const cont = await request(app).post(`/api/ion/reports/${reportId}/continue`).set(admin.auth);
    expect(cont.status).toBe(200);
    expect(cont.body.push).toMatchObject({ status: 'QUEUED', runMode: 'FULL', ionDnNo: 'NL/APDN/4621' });
    const resumed = (await claimAs('pc-1')).body;
    expect(resumed.resume).toEqual({ dnNo: 'NL/APDN/4621', checkpoint: 'expense_saved' });
    expect((await milestone(resumed.id, 'pc-1', 'draft_click')).status).toBe(409);
    await milestone(resumed.id, 'pc-1', 'submit_click');
    await milestone(resumed.id, 'pc-1', 'submitted');
    expect((await finishAs(resumed.id, 'pc-1', { outcome: 'completed' })).body.status).toBe('SUBMITTED');
  });
});

// ---------------------------------------------------------------- failures

describe('failures before anything exists in iON', () => {
  it('a transient failure re-queues by itself, up to the limit, then waits for Retry; Retry refreshes the voucher date', async () => {
    const created = await create();
    await prisma.ionPush.update({ where: { id: created.body.push.id }, data: { payload: { ...(await row(created.body.push.id)).payload as object, voucherDate: '01/01/2020' } } });
    for (let attempt = 1; attempt <= env.ION_MAX_AUTO_RETRIES; attempt++) {
      const job = (await claimAs('pc-1')).body;
      expect((await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'transient', error: 'timeout on login', errorStep: 'A' })).body.status).toBe('QUEUED');
    }
    const last = (await claimAs('pc-1')).body;
    expect((await finishAs(last.id, 'pc-1', { outcome: 'failed', kind: 'transient', error: 'timeout on login' })).body.status).toBe('FAILED_RETRYABLE');
    expect((await view()).push).toMatchObject({ status: 'FAILED_RETRYABLE', lastError: 'timeout on login', canRetry: true, attempts: env.ION_MAX_AUTO_RETRIES + 1 });

    const retried = await request(app).post(`/api/ion/reports/${reportId}/retry`).set(admin.auth);
    expect(retried.status).toBe(200);
    expect(retried.body.push.status).toBe('QUEUED');
    const [dd, mm, yyyy] = ((await row(created.body.push.id)).payload as { voucherDate: string }).voucherDate.split('/');
    expect(`${yyyy}-${mm}-${dd}`).toBe(todayIst());
    expect((await claimAs('pc-1')).status).toBe(200);
  });

  it('invoice not in iON is a safe stop with a Retry button; no admin alert for it', async () => {
    const job = await queueAndClaim();
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'invoice_not_found', error: 'Invoice ECPL/26-27/0632 not found: book the purchase voucher in iON first', errorStep: 'B14' });
    expect((await view()).push).toMatchObject({ status: 'FAILED_RETRYABLE', lastErrorStep: 'B14', canRetry: true });
    expect(await adminNotifications()).toBe(0);
    expect((await request(app).post(`/api/ion/reports/${reportId}/retry`).set(admin.auth)).status).toBe(200);
  });

  it('an expired session alerts every admin through the bell, and keeps nothing half done', async () => {
    const job = await queueAndClaim();
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'session_expired', error: 'iON session expired', errorStep: 'A' });
    expect((await view()).push?.status).toBe('FAILED_RETRYABLE');
    const notes = await prisma.notification.findMany({ where: { user: { role: 'ADMIN' } } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: 'iON session expired', reportId });
  });

  it('a verification mismatch is a plain failure, retry allowed since nothing was created', async () => {
    const job = await queueAndClaim();
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'verification', error: 'Supplier Description is empty', errorStep: 'B2' });
    expect((await view()).push).toMatchObject({ status: 'FAILED', canRetry: true, ionDnNo: null });
  });

  it('a possible duplicate in iON is check_manually with the DN numbers listed; never retried', async () => {
    const job = await queueAndClaim();
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'duplicate_found', error: 'A debit note for this invoice and amount already exists', dnNumbersFound: ['NL/APDN/4600', 'NL/APDN/4605'] });
    const v = await view();
    expect(v.push).toMatchObject({ status: 'CHECK_MANUALLY', canRetry: false });
    expect(v.push!.lastError).toContain('NL/APDN/4600, NL/APDN/4605');
    expect(await adminNotifications()).toBe(1);
    expect((await request(app).post(`/api/ion/reports/${reportId}/retry`).set(admin.auth)).status).toBe(409);
    expect((await claimAs('pc-1')).status).toBe(204);
  });
});

describe('failures around the draft', () => {
  it('after the draft exists, a failure stops as FAILED; Retry resumes that very draft and can never create another', async () => {
    const job = await queueAndClaim();
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' });
    await milestone(job.id, 'pc-1', 'checkpoint', { checkpoint: 'item_saved' });
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'verification', error: 'Tax line mismatch', errorStep: 'D' });
    expect((await view()).push).toMatchObject({ status: 'FAILED', ionDnNo: 'NL/APDN/4621', canRetry: true });
    expect(await adminNotifications()).toBe(0);

    expect((await request(app).post(`/api/ion/reports/${reportId}/retry`).set(admin.auth)).status).toBe(200);
    const resumed = (await claimAs('pc-1')).body;
    expect(resumed.resume).toEqual({ dnNo: 'NL/APDN/4621', checkpoint: 'item_saved' });
    expect((await view()).push?.status).toBe('DRAFT_CREATED');
    expect((await milestone(resumed.id, 'pc-1', 'draft_click')).status).toBe(409);
    expect((await milestone(resumed.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4700' })).status).toBe(409);
    expect((await row(resumed.id)).ionDnNo).toBe('NL/APDN/4621');
    expect(await prisma.ionPush.count()).toBe(1);
  });

  it('a worker that dies after clicking Save As Draft, before reading the number, leaves check_manually and alerts admins', async () => {
    const job = await queueAndClaim();
    await milestone(job.id, 'pc-1', 'draft_click');
    await prisma.ionPush.update({ where: { id: job.id }, data: { heartbeatAt: new Date(Date.now() - 3600_000) } });
    expect((await claimAs('pc-2')).status).toBe(204); // recovery runs, finds nothing to hand out
    const v = await view();
    expect(v.push).toMatchObject({ status: 'CHECK_MANUALLY', active: false, canRetry: false, ionDnNo: null });
    expect(v.push!.lastError).toContain('stopped responding');
    expect(await adminNotifications()).toBe(1);
    // the late worker cannot carry on
    expect((await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' })).status).toBe(409);
    expect((await claimAs('pc-2')).status).toBe(204);

    // reset needs the typed report number and a note, warns about the possible draft, and is audited
    const reset = (body: object) => request(app).post(`/api/ion/reports/${reportId}/reset`).set(admin.auth).send(body);
    expect((await reset({ confirm: 'yes', note: 'checked in iON, nothing there' })).status).toBe(409);
    expect((await reset({ confirm: 'QC/26-27/0013', note: 'ok' })).status).toBe(409);
    const done = await reset({ confirm: 'QC/26-27/0013', note: 'Checked in iON: nothing was saved' });
    expect(done.status).toBe(200);
    expect(done.body.warning).toContain('Save As Draft');
    expect(done.body.view.push).toBeNull();
    expect(done.body.view.history).toMatchObject([{ status: 'CHECK_MANUALLY', resetNote: 'Checked in iON: nothing was saved' }]);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { reportId, action: 'ION_PUSH_RESET' } });
    expect(audit.newValue).toBe('Checked in iON: nothing was saved');
    expect((await create()).status).toBe(201);
  });

  it('a worker that dies before clicking anything is re-queued by recovery, and a worker that dies after the draft leaves a resumable FAILED', async () => {
    const early = await queueAndClaim();
    await prisma.ionPush.update({ where: { id: early.id }, data: { heartbeatAt: new Date(Date.now() - 3600_000) } });
    const again = await claimAs('pc-2');
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(early.id);
    expect((await row(early.id)).attempts).toBe(2);

    await milestone(early.id, 'pc-2', 'draft_click');
    await milestone(early.id, 'pc-2', 'draft_created', { dnNo: 'NL/APDN/4621' });
    await prisma.ionPush.update({ where: { id: early.id }, data: { heartbeatAt: new Date(Date.now() - 3600_000) } });
    expect((await claimAs('pc-3')).status).toBe(204);
    expect((await view()).push).toMatchObject({ status: 'FAILED', ionDnNo: 'NL/APDN/4621', canRetry: true });
  });

  it('a failure after Submit was clicked is check_manually, never retried', async () => {
    const job = await queueAndClaim();
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' });
    await editsDone(job.id, 'pc-1');
    await milestone(job.id, 'pc-1', 'submit_click');
    await finishAs(job.id, 'pc-1', { outcome: 'failed', kind: 'transient', error: 'page closed after clicking Submit' });
    expect((await view()).push).toMatchObject({ status: 'CHECK_MANUALLY', ionDnNo: 'NL/APDN/4621', canRetry: false });
  });
});

describe('reset', () => {
  it('after a submit it archives the push, warns that the iON note still exists, and allows a fresh push', async () => {
    const job = await queueAndClaim();
    await milestone(job.id, 'pc-1', 'draft_click');
    await milestone(job.id, 'pc-1', 'draft_created', { dnNo: 'NL/APDN/4621' });
    await editsDone(job.id, 'pc-1');
    await milestone(job.id, 'pc-1', 'submit_click');
    await milestone(job.id, 'pc-1', 'submitted');
    await finishAs(job.id, 'pc-1', { outcome: 'completed' });

    const done = await request(app).post(`/api/ion/reports/${reportId}/reset`).set(admin.auth).send({ confirm: 'QC/26-27/0013', note: 'Voucher cancelled in iON, redo' });
    expect(done.status).toBe(200);
    expect(done.body.warning).toContain('NL/APDN/4621');
    expect(await prisma.ionPush.count()).toBe(1); // kept, not deleted
    expect((await create()).status).toBe(201);
  });

  it('cannot reset a job a worker is running, and 404s when there is nothing to reset', async () => {
    const reset = () => request(app).post(`/api/ion/reports/${reportId}/reset`).set(admin.auth).send({ confirm: 'QC/26-27/0013', note: 'trying anyway' });
    expect((await reset()).status).toBe(404);
    await queueAndClaim();
    expect((await reset()).status).toBe(409);
  });
});
