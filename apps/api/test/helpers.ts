import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import type { Role } from '@dalmia/types';
import { DEFAULT_MATERIALS, DEFAULT_PARAMETERS } from '@dalmia/calc';
import { prisma } from '../src/prisma';

export const PASSWORD = 'Test@12345';
const passwordHash = bcrypt.hashSync(PASSWORD, 4); // low cost: tests only

/** A minimal valid JPEG header (start of frame carries the size); enough for the server's checks. */
export function fakeJpeg(width = 1280, height = 720, padding = 0): Buffer {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x01, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(padding), Buffer.from([0xff, 0xd9])]);
}

export const emailFor = (role: Role): string => `${role.toLowerCase()}@test.local`;

export async function resetDatabase(): Promise<void> {
  // Order matters only for tables without ON DELETE CASCADE.
  await prisma.auditLog.deleteMany();
  await prisma.ionPush.deleteMany();
  await prisma.report.deleteMany();
  await prisma.importBatch.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.parameter.deleteMany();
  await prisma.material.deleteMany();
  await prisma.supplier.deleteMany();
  await prisma.plant.deleteMany();
  await prisma.setting.deleteMany();
}

export async function seedUsers(): Promise<void> {
  const roles: Role[] = ['ADMIN', 'GATE', 'RM_STORE', 'QC_ANALYST', 'STORES', 'QC_MANAGER'];
  await prisma.user.createMany({
    data: roles.map((role) => ({ name: `${role} user`, email: emailFor(role), role, passwordHash, canSeeRates: !(['QC_ANALYST', 'RM_STORE', 'STORES'] as Role[]).includes(role) })),
  });
}

export async function seedEngineConfig(): Promise<void> {
  // Mirrors the plant the ion_masters migration inserts.
  await prisma.plant.create({ data: { code: 'DPNL', name: 'Dalmia Polypro (DPNL)', ionSiteCode: 'DPNL', ionSiteAddressLabel: 'DPNL (Bill to Address)', stateCode: '27' } });
  const effectiveFrom = new Date('2000-01-01');
  await prisma.material.createMany({ data: DEFAULT_MATERIALS });
  for (const p of DEFAULT_PARAMETERS) {
    await prisma.parameter.create({
      data: {
        code: p.code,
        name: p.name,
        category: p.category,
        inputMode: p.inputMode,
        sortOrder: p.sortOrder,
        isDeductible: p.isDeductible,
        norms: { create: p.norms.map(({ effectiveFrom: _e, ...n }) => ({ ...n, effectiveFrom })) },
        rates: {
          create: p.rates.map((r) => ({
            rateMode: r.rateMode,
            fixedRate: r.fixedRate ?? null,
            weightBase: r.weightBase,
            maxActualPercent: r.maxActualPercent ?? null,
            effectiveFrom,
          })),
        },
      },
    });
  }
  await prisma.setting.create({ data: { key: 'toleranceFraction', value: '0.005' } });
}

export interface Session {
  accessToken: string;
  /** Raw `name=value` refresh cookie to replay. */
  cookie: string;
  auth: { Authorization: string };
}

export async function login(app: Express, role: Role): Promise<Session> {
  const res = await request(app).post('/api/auth/login').send({ email: emailFor(role), password: PASSWORD });
  if (res.status !== 200) throw new Error(`login as ${role} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return toSession(res);
}

export function toSession(res: request.Response): Session {
  const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (setCookie ?? []).map((c) => c.split(';')[0]!).find((c) => c.startsWith('dqc_refresh=')) ?? '';
  const accessToken = String(res.body.accessToken);
  return { accessToken, cookie, auth: { Authorization: `Bearer ${accessToken}` } };
}
