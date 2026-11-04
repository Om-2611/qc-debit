import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sampleReportInput } from '@dalmia/calc';
import type { NotificationListResponse, ReportDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { configurePush } from '../src/notifications/push';
import { prisma } from '../src/prisma';
import { emailFor, login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const sendNotification = vi.hoisted(() => vi.fn());
vi.mock('web-push', () => ({ default: { setVapidDetails: vi.fn(), sendNotification } }));

const app = createApp();
const sample = sampleReportInput();
let gate: Session, store: Session, analyst: Session, stores: Session, manager: Session, admin: Session;
let supplierId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  supplierId = (await prisma.supplier.create({ data: { name: 'ABC', code: 'ABC' } })).id;
  [gate, store, analyst, stores, manager, admin] = await Promise.all([
    login(app, 'GATE'),
    login(app, 'RM_STORE'),
    login(app, 'QC_ANALYST'),
    login(app, 'STORES'),
    login(app, 'QC_MANAGER'),
    login(app, 'ADMIN'),
  ]);
});
beforeEach(async () => {
  configurePush(null);
  sendNotification.mockReset();
  await prisma.pushSubscription.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
});
afterAll(async () => {
  configurePush(null);
  await prisma.$disconnect();
});

const materials = sample.materials.map(({ name: _n, ...m }) => m);
const pick = (keep: (k: string) => boolean) => ({
  materials: materials.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k === 'code' || keep(k)))),
});
const invoiceBody = pick((k) => k.startsWith('invoice') || k === 'dalmiaRate');
const dalmiaBody = pick((k) => k === 'dalmiaWeightKg' || k === 'dalmiaBales');

const inbox = async (s: Session): Promise<NotificationListResponse> => {
  const res = await request(app).get('/api/notifications').set(s.auth);
  expect(res.status).toBe(200);
  return res.body;
};
const ok = async (req: request.Test) => expect((await req).status).toBe(200);

async function createDraft(): Promise<ReportDto> {
  const res = await request(app)
    .post('/api/reports')
    .set(gate.auth)
    .send({ reportDate: '2025-08-12', supplierId, truckNumber: 'MH 15 XY 1234', invoiceNumber: 'INV-9' });
  expect(res.status).toBe(201);
  return res.body;
}

/** Waits for the fire-and-forget push that follows the commit. */
const flushPush = () => new Promise((r) => setTimeout(r, 50));

describe('hand-off notifications', () => {
  it('each forward hand-off notifies every user of the next desk, and only them', async () => {
    const { id, reportNo } = await createDraft();
    await ok(request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(invoiceBody));
    await ok(request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth));

    const storeInbox = await inbox(store);
    expect(storeInbox.unreadCount).toBe(1);
    expect(storeInbox.items[0]).toMatchObject({
      reportId: id,
      title: `${reportNo} is waiting for you`,
      body: 'MH 15 XY 1234 · ABC: please enter the Dalmia weights. Sent by GATE user (Gate).',
      url: `/reports/${id}`,
      read: false,
    });
    for (const s of [gate, analyst, stores, manager, admin]) expect((await inbox(s)).unreadCount).toBe(0);

    await ok(request(app).patch(`/api/reports/${id}/weights`).set(store.auth).send(dalmiaBody));
    await ok(request(app).post(`/api/reports/${id}/submit-weights`).set(store.auth));
    expect((await inbox(analyst)).items[0]!.body).toContain('please enter the QC readings');

    const qc = { baleWeightsKg: sample.baleWeightsKg, readings: sample.readings.map((r) => ({ parameterCode: r.parameterCode, perBale: r.perBale })) };
    await ok(request(app).patch(`/api/reports/${id}/qc`).set(analyst.auth).send(qc));
    await ok(request(app).post(`/api/reports/${id}/submit-qc`).set(analyst.auth));
    expect((await inbox(stores)).items[0]!.body).toContain('please enter the GRN');

    await ok(request(app).patch(`/api/reports/${id}/grn`).set(stores.auth).send({ grnNumber: 'GRN-77' }));
    await ok(request(app).post(`/api/reports/${id}/submit-grn`).set(stores.auth));
    const managerInbox = await inbox(manager);
    expect(managerInbox.items[0]!.body).toContain('please approve');
    expect(managerInbox.items[0]!.body).not.toMatch(/₹|\d{3,},/); // no money in the text

    // Send-back and approval do not notify (hand-offs only).
    await ok(request(app).post(`/api/reports/${id}/send-back`).set(manager.auth).send({ note: 'Recheck moisture' }));
    expect((await inbox(analyst)).unreadCount).toBe(1);
    expect(await prisma.notification.count()).toBe(4);
  });

  it('inactive users and the person handing over are not notified', async () => {
    await prisma.user.create({
      data: { name: 'Old store', email: 'old-store@test.local', role: 'RM_STORE', passwordHash: 'x', isActive: false },
    });
    const { id } = await createDraft();
    await ok(request(app).patch(`/api/reports/${id}/weights`).set(admin.auth).send(invoiceBody));
    await ok(request(app).post(`/api/reports/${id}/submit-invoice`).set(admin.auth));
    const recipients = await prisma.notification.findMany({ select: { user: { select: { email: true } } } });
    expect(recipients.map((r) => r.user.email)).toEqual([emailFor('RM_STORE')]);
    expect((await inbox(store)).items[0]!.body).toContain('Sent by ADMIN user (Admin)');
  });

  it('a hand-off that fails validation creates no notification', async () => {
    const { id } = await createDraft();
    expect((await request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth)).status).toBe(400);
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('the bell', () => {
  it('marks one or all as read, and only the owner can', async () => {
    const a = await createDraft();
    const b = await createDraft();
    for (const { id } of [a, b]) {
      await ok(request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(invoiceBody));
      await ok(request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth));
    }
    const { items } = await inbox(store);
    expect(items.map((n) => n.reportId)).toEqual([b.id, a.id]); // newest first

    expect((await request(app).post(`/api/notifications/${items[0]!.id}/read`).set(manager.auth)).status).toBe(404);
    expect((await request(app).post(`/api/notifications/${items[0]!.id}/read`).set(store.auth)).status).toBe(204);
    expect((await request(app).post(`/api/notifications/${items[0]!.id}/read`).set(store.auth)).status).toBe(204); // idempotent
    expect((await inbox(store)).unreadCount).toBe(1);

    expect((await request(app).post('/api/notifications/read-all').set(store.auth)).status).toBe(204);
    const after = await inbox(store);
    expect(after.unreadCount).toBe(0);
    expect(after.items.every((n) => n.read)).toBe(true);
  });

  it('needs a signed-in user', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });
});

describe('browser push', () => {
  const subscription = (n: number) => ({
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
  });
  const subscribe = (s: Session, n: number) =>
    request(app).post('/api/notifications/push-subscriptions').set(s.auth).send(subscription(n));

  async function handOverToStore(): Promise<string> {
    const { id } = await createDraft();
    await ok(request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(invoiceBody));
    await ok(request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth));
    await flushPush();
    return id;
  }

  it('push-config says whether the server has VAPID keys', async () => {
    expect((await request(app).get('/api/notifications/push-config').set(store.auth)).body).toEqual({ enabled: false, publicKey: null });
    configurePush({ publicKey: 'PUBLIC', privateKey: 'PRIVATE', subject: 'mailto:test@test.local' });
    expect((await request(app).get('/api/notifications/push-config').set(store.auth)).body).toEqual({ enabled: true, publicKey: 'PUBLIC' });
  });

  it('pushes the hand-off to every browser the next desk has enabled', async () => {
    configurePush({ publicKey: 'PUBLIC', privateKey: 'PRIVATE', subject: 'mailto:test@test.local' });
    expect((await subscribe(store, 1)).status).toBe(204);
    expect((await subscribe(store, 2)).status).toBe(204);
    expect((await subscribe(analyst, 3)).status).toBe(204);
    const id = await handOverToStore();

    expect(sendNotification).toHaveBeenCalledTimes(2);
    const endpoints = sendNotification.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint).sort();
    expect(endpoints).toEqual([subscription(1).endpoint, subscription(2).endpoint]);
    const [sub, payload, options] = sendNotification.mock.calls[0]!;
    expect(sub).toMatchObject({ keys: { p256dh: expect.any(String), auth: expect.any(String) } });
    expect(JSON.parse(payload as string)).toMatchObject({ url: `/reports/${id}`, tag: `report-${id}` });
    expect(options).toMatchObject({ urgency: 'high' });
  });

  it('does nothing when push is off; the bell still gets the notification', async () => {
    expect((await subscribe(store, 1)).status).toBe(204);
    await handOverToStore();
    expect(sendNotification).not.toHaveBeenCalled();
    expect((await inbox(store)).unreadCount).toBe(1);
  });

  it('drops subscriptions the push service reports as gone, and survives other failures', async () => {
    configurePush({ publicKey: 'PUBLIC', privateKey: 'PRIVATE', subject: 'mailto:test@test.local' });
    await subscribe(store, 1);
    await subscribe(store, 2);
    sendNotification.mockImplementation(async (s: { endpoint: string }) => {
      throw Object.assign(new Error('push failed'), { statusCode: s.endpoint.endsWith('-1') ? 410 : 500 });
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await handOverToStore();
    warn.mockRestore();
    expect((await prisma.pushSubscription.findMany()).map((s) => s.endpoint)).toEqual([subscription(2).endpoint]);
    expect((await inbox(store)).unreadCount).toBe(1);
  });

  it('a browser follows whoever signs in on it, and sign-out unlinks it', async () => {
    await subscribe(store, 1);
    await subscribe(analyst, 1); // same browser, next person signs in
    const rows = await prisma.pushSubscription.findMany({ include: { user: { select: { email: true } } } });
    expect(rows.map((r) => r.user.email)).toEqual([emailFor('QC_ANALYST')]);

    // Someone else cannot remove it.
    await request(app).delete('/api/notifications/push-subscriptions').set(store.auth).send({ endpoint: subscription(1).endpoint });
    expect(await prisma.pushSubscription.count()).toBe(1);
    const res = await request(app).delete('/api/notifications/push-subscriptions').set(analyst.auth).send({ endpoint: subscription(1).endpoint });
    expect(res.status).toBe(204);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it('rejects a malformed subscription', async () => {
    const res = await request(app).post('/api/notifications/push-subscriptions').set(store.auth).send({ endpoint: 'nope', keys: {} });
    expect(res.status).toBe(400);
  });
});
