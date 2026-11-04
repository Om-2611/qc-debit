import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleReportInput } from '@dalmia/calc';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { PASSWORD, emailFor, login, resetDatabase, seedEngineConfig, seedUsers, toSession } from './helpers';

const app = createApp();

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
});
beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await seedUsers();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /api/auth/login', () => {
  it('returns an access token, the user, and an httpOnly refresh cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: emailFor('GATE'), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: emailFor('GATE'), role: 'GATE' });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(typeof res.body.accessToken).toBe('string');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookie).toMatch(/dqc_refresh=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/auth/);
  });

  it('is case-insensitive on email', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: emailFor('GATE').toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: emailFor('GATE'), password: 'nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.local', password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('rejects a deactivated user', async () => {
    await prisma.user.update({ where: { email: emailFor('GATE') }, data: { isActive: false } });
    const res = await request(app).post('/api/auth/login').send({ email: emailFor('GATE'), password: PASSWORD });
    expect(res.status).toBe(401);
  });

  it('validates the body with zod', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/me', () => {
  it('requires a bearer token', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });

  it('returns the current user', async () => {
    const s = await login(app, 'QC_MANAGER');
    const res = await request(app).get('/api/me').set(s.auth);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: emailFor('QC_MANAGER'), role: 'QC_MANAGER' });
  });

  it('stops working the moment the user is deactivated, even with a valid token', async () => {
    const s = await login(app, 'GATE');
    await prisma.user.update({ where: { email: emailFor('GATE') }, data: { isActive: false } });
    expect((await request(app).get('/api/me').set(s.auth)).status).toBe(401);
  });
});

describe('refresh token rotation', () => {
  it('rotates: the new token works, the old one does not', async () => {
    const s1 = await login(app, 'GATE');
    const r1 = await request(app).post('/api/auth/refresh').set('Cookie', s1.cookie);
    expect(r1.status).toBe(200);
    const s2 = toSession(r1);
    expect(s2.cookie).not.toBe(s1.cookie);
    expect((await request(app).get('/api/me').set(s2.auth)).status).toBe(200);
  });

  it('replaying a rotated token revokes the whole session family', async () => {
    const s1 = await login(app, 'GATE');
    const s2 = toSession(await request(app).post('/api/auth/refresh').set('Cookie', s1.cookie));

    const replay = await request(app).post('/api/auth/refresh').set('Cookie', s1.cookie);
    expect(replay.status).toBe(401);

    // The legitimate holder of the newest token is signed out too.
    const next = await request(app).post('/api/auth/refresh').set('Cookie', s2.cookie);
    expect(next.status).toBe(401);
  });

  it('rejects a missing or forged cookie', async () => {
    expect((await request(app).post('/api/auth/refresh')).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', 'dqc_refresh=forged')).status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const s = await login(app, 'GATE');
    expect((await request(app).post('/api/auth/logout').set('Cookie', s.cookie)).status).toBe(204);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', s.cookie)).status).toBe(401);
  });

  it('stores only a hash of the refresh token', async () => {
    const s = await login(app, 'GATE');
    const raw = s.cookie.split('=')[1]!;
    const rows = await prisma.refreshToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toBe(raw);
    expect(rows[0]!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('role guards', () => {
  it('only ADMIN reaches /api/admin/*', async () => {
    for (const role of ['GATE', 'RM_STORE', 'QC_ANALYST', 'STORES', 'QC_MANAGER'] as const) {
      const s = await login(app, role);
      const res = await request(app).get('/api/admin/users').set(s.auth);
      expect(res.status).toBe(403);
      expect(res.body.message).toContain(role);
    }
    const admin = await login(app, 'ADMIN');
    const res = await request(app).get('/api/admin/users').set(admin.auth);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(6);
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('unauthenticated requests get 401, not 403 or 404', async () => {
    expect((await request(app).get('/api/admin/users')).status).toBe(401);
    expect((await request(app).get('/api/does-not-exist')).status).toBe(401);
  });

  it('a role change takes effect immediately and ends the old session', async () => {
    const admin = await login(app, 'ADMIN');
    const gate = await login(app, 'GATE');
    const gateUser = await prisma.user.findUniqueOrThrow({ where: { email: emailFor('GATE') } });

    const patch = await request(app).patch(`/api/admin/users/${gateUser.id}`).set(admin.auth).send({ role: 'ADMIN' });
    expect(patch.status).toBe(200);

    // Same access token, new role read from the database.
    expect((await request(app).get('/api/admin/users').set(gate.auth)).status).toBe(200);
    // …but the refresh token was revoked, so the session cannot be extended.
    expect((await request(app).post('/api/auth/refresh').set('Cookie', gate.cookie)).status).toBe(401);
  });
});

describe('admin user management', () => {
  it('creates a user who can then sign in; duplicate email is a 409', async () => {
    const admin = await login(app, 'ADMIN');
    const body = { name: 'New Analyst', email: 'New.Analyst@Test.Local', role: 'QC_ANALYST', password: 'Welcome123' };
    const created = await request(app).post('/api/admin/users').set(admin.auth).send(body);
    expect(created.status).toBe(201);
    expect(created.body.email).toBe('new.analyst@test.local');

    const signIn = await request(app).post('/api/auth/login').send({ email: body.email, password: body.password });
    expect(signIn.status).toBe(200);

    expect((await request(app).post('/api/admin/users').set(admin.auth).send(body)).status).toBe(409);
  });

  it('rejects weak passwords and unknown roles', async () => {
    const admin = await login(app, 'ADMIN');
    const base = { name: 'X', email: 'x@test.local', role: 'GATE', password: 'Welcome123' };
    expect((await request(app).post('/api/admin/users').set(admin.auth).send({ ...base, password: 'short' })).status).toBe(400);
    expect((await request(app).post('/api/admin/users').set(admin.auth).send({ ...base, role: 'SUPERUSER' })).status).toBe(400);
  });

  it('an admin cannot demote or deactivate themself', async () => {
    const admin = await login(app, 'ADMIN');
    const me = await prisma.user.findUniqueOrThrow({ where: { email: emailFor('ADMIN') } });
    expect((await request(app).patch(`/api/admin/users/${me.id}`).set(admin.auth).send({ role: 'GATE' })).status).toBe(400);
    expect((await request(app).patch(`/api/admin/users/${me.id}`).set(admin.auth).send({ isActive: false })).status).toBe(400);
  });

  it('password reset signs the user out and the new password works', async () => {
    const admin = await login(app, 'ADMIN');
    const gate = await login(app, 'GATE');
    const gateUser = await prisma.user.findUniqueOrThrow({ where: { email: emailFor('GATE') } });

    const reset = await request(app)
      .post(`/api/admin/users/${gateUser.id}/reset-password`)
      .set(admin.auth)
      .send({ password: 'Fresh12345' });
    expect(reset.status).toBe(204);
    expect((await request(app).post('/api/auth/refresh').set('Cookie', gate.cookie)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: emailFor('GATE'), password: PASSWORD })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: emailFor('GATE'), password: 'Fresh12345' })).status).toBe(200);
  });

  it('writes audit rows for user changes', async () => {
    const admin = await login(app, 'ADMIN');
    const gateUser = await prisma.user.findUniqueOrThrow({ where: { email: emailFor('GATE') } });
    await request(app).patch(`/api/admin/users/${gateUser.id}`).set(admin.auth).send({ isActive: false });
    const rows = await prisma.auditLog.findMany({ where: { action: 'USER_UPDATE' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: `${emailFor('GATE')}.isActive`, oldValue: 'true', newValue: 'false' });
  });
});

describe('POST /api/reports/preview-calc', () => {
  const { config: _config, ...sample } = sampleReportInput();

  it('requires authentication', async () => {
    expect((await request(app).post('/api/reports/preview-calc').send(sample)).status).toBe(401);
  });

  it('computes the workbook sample with the server-side configuration', async () => {
    const s = await login(app, 'QC_ANALYST');
    const res = await request(app).post('/api/reports/preview-calc').set(s.auth).send(sample);
    expect(res.status).toBe(200);
    expect(res.body.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    expect(res.body.output.grandTotal.approvedAmount).toBeCloseTo(19160.84, 2);
    expect(res.body.config.toleranceFraction).toBe(0.005);
  });

  it('ignores any config sent by the client and rejects bad input', async () => {
    const s = await login(app, 'GATE');
    const tampered = { ...sample, config: { parameters: [], toleranceFraction: 1 } };
    const ok = await request(app).post('/api/reports/preview-calc').set(s.auth).send(tampered);
    expect(ok.body.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);

    const bad = await request(app)
      .post('/api/reports/preview-calc')
      .set(s.auth)
      .send({ ...sample, reportDate: '12/08/2025' });
    expect(bad.status).toBe(400);
  });
});
