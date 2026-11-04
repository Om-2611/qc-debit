import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleReportInput, type EngineOutput } from '@dalmia/calc';
import type { AdminMaterialDto, AdminParameterDto, AdminSupplierDto, SettingsDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
let gate: Session, store: Session, analyst: Session, manager: Session, admin: Session;

const { config: _config, ...sampleInput } = sampleReportInput();

/** The workbook sample through the live engine, with whatever norms, rates and settings the database holds now. */
async function previewCalc(reportDate: string = sampleInput.reportDate as string): Promise<EngineOutput> {
  const res = await request(app).post('/api/reports/preview-calc').set(gate.auth).send({ ...sampleInput, reportDate });
  expect(res.status).toBe(200);
  return res.body.output;
}
const parameterOf = (output: EngineOutput, code: string) => output.parameters.find((p) => p.parameterCode === code)!;

async function parameter(code: string): Promise<AdminParameterDto> {
  const res = await request(app).get('/api/admin/parameters').set(admin.auth);
  expect(res.status).toBe(200);
  return (res.body as AdminParameterDto[]).find((p) => p.code === code)!;
}

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [gate, store, analyst, manager, admin] = await Promise.all([login(app, 'GATE'), login(app, 'RM_STORE'), login(app, 'QC_ANALYST'), login(app, 'QC_MANAGER'), login(app, 'ADMIN')]);
});
afterAll(async () => {
  // These tests rewrite norms, rates and settings; leave the shared test database on the seeded defaults.
  await resetDatabase();
  await seedEngineConfig();
  await prisma.$disconnect();
});

describe('admin endpoints are ADMIN only', () => {
  const ENDPOINTS: [method: 'get' | 'post' | 'patch' | 'put', url: string][] = [
    ['get', '/api/admin/users'],
    ['post', '/api/admin/users'],
    ['patch', '/api/admin/users/x'],
    ['post', '/api/admin/users/x/reset-password'],
    ['get', '/api/admin/suppliers'],
    ['post', '/api/admin/suppliers'],
    ['patch', '/api/admin/suppliers/x'],
    ['get', '/api/admin/materials'],
    ['patch', '/api/admin/materials/x'],
    ['get', '/api/admin/plants'],
    ['post', '/api/admin/plants'],
    ['patch', '/api/admin/plants/x'],
    ['get', '/api/admin/parameters'],
    ['patch', '/api/admin/parameters/x'],
    ['put', '/api/admin/parameters/x/norms'],
    ['put', '/api/admin/parameters/x/rate'],
    ['get', '/api/admin/settings'],
    ['put', '/api/admin/settings'],
  ];

  it('returns 401 without a token', async () => {
    for (const [method, url] of ENDPOINTS) {
      expect((await request(app)[method](url).send({})).status, `${method} ${url}`).toBe(401);
    }
  });

  it('returns 403 to Gate, RM Store, QC Analyst and QC Manager', async () => {
    for (const session of [gate, store, analyst, manager]) {
      for (const [method, url] of ENDPOINTS) {
        const res = await request(app)[method](url).set(session.auth).send({});
        expect(res.status, `${method} ${url}`).toBe(403);
        expect(res.body.message).toContain('ADMIN');
      }
    }
  });
});

describe('suppliers', () => {
  let supplier: AdminSupplierDto;

  it('creates a supplier, upper-cases the code and writes an audit row', async () => {
    const res = await request(app)
      .post('/api/admin/suppliers')
      .set(admin.auth)
      .send({ name: '  Shree Polymers ', code: 'shp', gstin: '27ABCDE1234F1Z5', address: '' });
    expect(res.status).toBe(201);
    supplier = res.body;
    expect(supplier).toMatchObject({ name: 'Shree Polymers', code: 'SHP', gstin: '27ABCDE1234F1Z5', address: null, isActive: true, reportCount: 0 });

    const audit = await prisma.auditLog.findFirst({ where: { action: 'SUPPLIER_CREATE', field: 'SHP' } });
    expect(audit?.newValue).toBe('Shree Polymers');
  });

  it('rejects a duplicate name or code with 409, and an invalid body with 400', async () => {
    const sameName = await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'shree polymers', code: 'OTHER' });
    expect(sameName.status).toBe(409);
    expect(sameName.body.message).toContain('Shree Polymers');
    const sameCode = await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'Another', code: 'SHP' });
    expect(sameCode.status).toBe(409);
    expect((await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: '', code: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'X', code: 'X', nonsense: 1 })).status).toBe(400);
  });

  it('updates and deactivates; an inactive supplier leaves the lookups but is never deleted', async () => {
    const renamed = await request(app).patch(`/api/admin/suppliers/${supplier.id}`).set(admin.auth).send({ name: 'Shree Polymers Pvt Ltd', address: 'Nashik' });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: 'Shree Polymers Pvt Ltd', address: 'Nashik', code: 'SHP' });

    const other = await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'Second Supplier', code: 'SEC' });
    expect((await request(app).patch(`/api/admin/suppliers/${other.body.id}`).set(admin.auth).send({ code: 'shp' })).status).toBe(409);
    expect((await request(app).patch('/api/admin/suppliers/missing').set(admin.auth).send({ name: 'Y' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/suppliers/${supplier.id}`).set(admin.auth).send({})).status).toBe(400);

    // A report keeps pointing at the supplier after it is deactivated.
    const report = await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2026-08-26', supplierId: supplier.id, truckNumber: 'MH 01' });
    expect(report.status).toBe(201);
    const off = await request(app).patch(`/api/admin/suppliers/${supplier.id}`).set(admin.auth).send({ isActive: false });
    expect(off.body).toMatchObject({ isActive: false, reportCount: 1 });

    const lookups = await request(app).get('/api/lookups').set(gate.auth);
    expect(lookups.body.suppliers.map((s: { code: string }) => s.code)).toEqual(['SEC']);
    const list = await request(app).get('/api/admin/suppliers').set(admin.auth);
    expect(list.body.map((s: AdminSupplierDto) => [s.code, s.isActive, s.reportCount])).toEqual([['SEC', true, 0], ['SHP', false, 1]]);
    expect((await request(app).delete(`/api/admin/suppliers/${supplier.id}`).set(admin.auth)).status).toBe(404);

    // One row per changed field. (Rows of one save share a timestamp, so the order is not asserted.)
    const audits = await prisma.auditLog.findMany({ where: { action: 'SUPPLIER_UPDATE' } });
    expect(audits).toHaveLength(3);
    expect(audits.map((a) => [a.field, a.oldValue, a.newValue])).toEqual(
      expect.arrayContaining([
        ['SHP.name', 'Shree Polymers', 'Shree Polymers Pvt Ltd'],
        ['SHP.address', null, 'Nashik'],
        ['SHP.isActive', 'true', 'false'],
      ]),
    );
  });
});

describe('suppliers: TCS iON mapping', () => {
  it('stores the iON supplier code, state and registration flag, audits changes and keeps the iON code unique', async () => {
    const created = await request(app)
      .post('/api/admin/suppliers')
      .set(admin.auth)
      .send({ name: 'Ecoloom', code: 'ECO', gstin: '09AAAAA0000A1Z5', ionSupplierCode: 'CRRM_140290', ionStateCode: '09' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ionSupplierCode: 'CRRM_140290', ionStateCode: '09', ionAddressCode: null, gstRegistered: true });

    const clash = await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'Other', code: 'OTH', ionSupplierCode: 'crrm_140290' });
    expect(clash.status).toBe(409);
    expect((await request(app).post('/api/admin/suppliers').set(admin.auth).send({ name: 'Bad', code: 'BAD', ionStateCode: 'UP' })).status).toBe(400);

    const patched = await request(app).patch(`/api/admin/suppliers/${created.body.id}`).set(admin.auth).send({ gstRegistered: false, ionStateCode: '' });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({ gstRegistered: false, ionStateCode: null });
    const audit = await prisma.auditLog.findFirst({ where: { action: 'SUPPLIER_UPDATE', field: 'ECO.gstRegistered' } });
    expect(audit?.newValue).toBe('false');
  });
});

describe('plants', () => {
  it('lists the seeded DPNL plant and attaches it to new reports', async () => {
    const list = await request(app).get('/api/admin/plants').set(admin.auth);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject([{ code: 'DPNL', ionSiteCode: 'DPNL', ionSiteAddressLabel: 'DPNL (Bill to Address)', stateCode: '27', isActive: true }]);

    const report = await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2026-11-04' });
    expect(report.status).toBe(201);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: report.body.id }, include: { plant: true } });
    expect(row.plant?.code).toBe('DPNL');
  });

  it('creates, updates and audits plants; rejects duplicates and bad state codes; a second active plant stops the default', async () => {
    const created = await request(app)
      .post('/api/admin/plants')
      .set(admin.auth)
      .send({ code: 'dpvp', name: 'Dalmia Polypro VP', ionSiteCode: 'DPVP', ionSiteAddressLabel: 'DPVP (Bill to Address)', stateCode: '09' });
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('DPVP');
    expect((await request(app).post('/api/admin/plants').set(admin.auth).send({ code: 'DPVP', name: 'x', ionSiteCode: 'x', ionSiteAddressLabel: 'x', stateCode: '09' })).status).toBe(409);
    expect((await request(app).patch(`/api/admin/plants/${created.body.id}`).set(admin.auth).send({ stateCode: 'MH' })).status).toBe(400);

    const report = await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2026-11-04' });
    expect((await prisma.report.findUniqueOrThrow({ where: { id: report.body.id } })).plantId).toBeNull();

    const off = await request(app).patch(`/api/admin/plants/${created.body.id}`).set(admin.auth).send({ isActive: false });
    expect(off.status).toBe(200);
    expect((await prisma.auditLog.findFirst({ where: { action: 'PLANT_UPDATE', field: 'DPVP.isActive' } }))?.newValue).toBe('false');
  });
});

describe('materials', () => {
  it('lists the five sheet columns in order', async () => {
    const res = await request(app).get('/api/admin/materials').set(admin.auth);
    expect(res.body.map((m: AdminMaterialDto) => m.code)).toEqual(['CLEAR', 'GREEN', 'BARWASTE', 'BARWASTE_WITH_RING', 'OTHERS']);
  });

  it('renames a material but never changes its code, and offers no create or delete', async () => {
    const list = await request(app).get('/api/admin/materials').set(admin.auth);
    const green: AdminMaterialDto = list.body.find((m: AdminMaterialDto) => m.code === 'GREEN');

    const changeCode = await request(app).patch(`/api/admin/materials/${green.id}`).set(admin.auth).send({ code: 'LIME', name: 'Lime' });
    expect(changeCode.status).toBe(400);
    expect(await prisma.material.findUnique({ where: { id: green.id } })).toMatchObject({ code: 'GREEN', name: 'Green' });

    const ion = await request(app).patch(`/api/admin/materials/${green.id}`).set(admin.auth).send({ ionItemCode: 'RM-13025' });
    expect(ion.body.ionItemCode).toBe('RM-13025');
    const renamed = await request(app).patch(`/api/admin/materials/${green.id}`).set(admin.auth).send({ name: 'Green PET', sortOrder: 25 });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ code: 'GREEN', name: 'Green PET', sortOrder: 25 });
    expect((await request(app).patch(`/api/admin/materials/${green.id}`).set(admin.auth).send({ name: 'clear' })).status).toBe(409);

    expect((await request(app).post('/api/admin/materials').set(admin.auth).send({ code: 'NEW', name: 'New' })).status).toBe(404);
    expect((await request(app).delete(`/api/admin/materials/${green.id}`).set(admin.auth)).status).toBe(404);
    expect(await prisma.auditLog.count({ where: { action: 'MATERIAL_UPDATE', field: 'GREEN.name' } })).toBe(1);
  });
});

describe('parameters', () => {
  it('lists every parameter with its norms and rate rules', async () => {
    const res = await request(app).get('/api/admin/parameters').set(admin.auth);
    expect(res.body).toHaveLength(10);
    const dirty = (res.body as AdminParameterDto[]).find((p) => p.code === 'DIRTY_BOTTLE')!;
    expect(dirty.norms.map((n) => [n.seasonStartMonth, n.seasonEndMonth, n.normPercent])).toEqual([[7, 9, 4], [10, 6, 3]]);
    expect(dirty.rates[0]).toMatchObject({ rateMode: 'FIXED', fixedRate: 10, weightBase: 'AFFECTED_BALES_TRUCK_AVG', maxActualPercent: 6, effectiveFrom: '2000-01-01' });
  });

  it('isDeductible decides whether the next calculation charges the parameter', async () => {
    const iron = await parameter('IRON_PATTI');
    const before = parameterOf(await previewCalc(), 'IRON_PATTI');
    expect(before.standardAmount).toBeGreaterThan(0);

    const off = await request(app).patch(`/api/admin/parameters/${iron.id}`).set(admin.auth).send({ isDeductible: false });
    expect(off.status).toBe(200);
    expect(off.body.isDeductible).toBe(false);
    const after = await previewCalc();
    expect(parameterOf(after, 'IRON_PATTI')).toMatchObject({ overNorm: true, standardAmount: 0, approvedAmount: 0 });
    expect(after.grandTotal.standardAmount).toBeCloseTo(51818.86 - before.standardAmount, 2);

    await request(app).patch(`/api/admin/parameters/${iron.id}`).set(admin.auth).send({ isDeductible: true });
    expect((await previewCalc()).grandTotal.standardAmount).toBeCloseTo(51818.86, 2);

    const audits = await prisma.auditLog.findMany({ where: { action: 'PARAMETER_UPDATE', field: 'IRON_PATTI.isDeductible' }, orderBy: { at: 'asc' } });
    expect(audits.map((a) => [a.oldValue, a.newValue])).toEqual([['true', 'false'], ['false', 'true']]);
  });

  it('does not let the code, category or input mode be changed', async () => {
    const iron = await parameter('IRON_PATTI');
    for (const body of [{ code: 'IRON' }, { category: 'DISCRETIONARY' }, { inputMode: 'PERCENT_PER_BALE' }, {}]) {
      expect((await request(app).patch(`/api/admin/parameters/${iron.id}`).set(admin.auth).send(body)).status).toBe(400);
    }
    expect((await request(app).patch('/api/admin/parameters/missing').set(admin.auth).send({ name: 'X' })).status).toBe(404);
  });

  describe('norms', () => {
    const seeded = [
      { seasonStartMonth: 7, seasonEndMonth: 9, normPercent: 5, effectiveFrom: '2000-01-01' },
      { seasonStartMonth: 10, seasonEndMonth: 6, normPercent: 3, effectiveFrom: '2000-01-01' },
    ];
    const putNorms = async (norms: unknown) => request(app).put(`/api/admin/parameters/${(await parameter('MOISTURE')).id}/norms`).set(admin.auth).send({ norms });

    it('rejects seasons that leave a month uncovered', async () => {
      const res = await putNorms([...seeded, { seasonStartMonth: 7, seasonEndMonth: 9, normPercent: 6, effectiveFrom: '2026-01-01' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('2026-01-01');
      expect(res.body.message).toContain('uncovered: Jan, Feb, Mar, Apr, May, Jun, Oct, Nov, Dec');
    });

    it('rejects seasons that cover a month twice', async () => {
      const res = await putNorms([{ seasonStartMonth: 7, seasonEndMonth: 9, normPercent: 5, effectiveFrom: '2000-01-01' }, { seasonStartMonth: 9, seasonEndMonth: 6, normPercent: 3, effectiveFrom: '2000-01-01' }]);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('more than once: Sep');
    });

    it('rejects out-of-range months and percentages, and an empty list', async () => {
      expect((await putNorms([{ seasonStartMonth: 0, seasonEndMonth: 12, normPercent: 5, effectiveFrom: '2000-01-01' }])).status).toBe(400);
      expect((await putNorms([{ seasonStartMonth: 1, seasonEndMonth: 12, normPercent: 101, effectiveFrom: '2000-01-01' }])).status).toBe(400);
      expect((await putNorms([{ seasonStartMonth: 1, seasonEndMonth: 12, normPercent: 5, effectiveFrom: '01-01-2000' }])).status).toBe(400);
      expect((await putNorms([])).status).toBe(400);
      // Nothing was saved by the failed attempts.
      expect(parameterOf(await previewCalc(), 'MOISTURE').normPercent).toBe(5);
    });

    it('accepts a seasonal pair from a new date; the engine uses it from that date only', async () => {
      const res = await putNorms([
        ...seeded,
        { seasonStartMonth: 7, seasonEndMonth: 9, normPercent: 6, effectiveFrom: '2026-01-01' },
        { seasonStartMonth: 10, seasonEndMonth: 6, normPercent: 3.5, effectiveFrom: '2026-01-01' },
      ]);
      expect(res.status).toBe(200);
      expect(res.body.norms).toHaveLength(4);
      expect(res.body.norms[0]).toMatchObject({ effectiveFrom: '2026-01-01', seasonStartMonth: 7, normPercent: 6 });

      expect(parameterOf(await previewCalc('2026-08-26'), 'MOISTURE').normPercent).toBe(6);
      expect(parameterOf(await previewCalc('2026-11-10'), 'MOISTURE').normPercent).toBe(3.5);
      expect(parameterOf(await previewCalc('2025-08-26'), 'MOISTURE').normPercent).toBe(5);

      const audit = await prisma.auditLog.findFirst({ where: { action: 'NORM_UPDATE', field: 'MOISTURE.norms' } });
      expect(audit?.oldValue).toBe('2000-01-01 Jul–Sep 5%; 2000-01-01 Oct–Jun 3%');
      expect(audit?.newValue).toContain('2026-01-01 Jul–Sep 6%');

      // Back to the sheet's norms for the tests below.
      expect((await putNorms(seeded)).status).toBe(200);
      expect((await previewCalc()).grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    });
  });

  describe('rate rule', () => {
    const putRate = async (body: object) => request(app).put(`/api/admin/parameters/${(await parameter('ALUMINIUM_PET')).id}/rate`).set(admin.auth).send(body);

    it('FIXED needs a fixed rate; other modes must not carry one', async () => {
      const missing = await putRate({ rateMode: 'FIXED', weightBase: 'CLEAR_WEIGHT', effectiveFrom: '2026-01-01' });
      expect(missing.status).toBe(400);
      expect(JSON.stringify(missing.body.details)).toContain('fixed rate is required');
      expect((await putRate({ rateMode: 'DOMINANT_MATERIAL_RATE', fixedRate: 10, weightBase: 'CLEAR_WEIGHT', effectiveFrom: '2026-01-01' })).status).toBe(400);
      expect((await putRate({ rateMode: 'HALF_PRICE', weightBase: 'CLEAR_WEIGHT', effectiveFrom: '2026-01-01' })).status).toBe(400);
      expect((await putRate({ rateMode: 'FIXED', fixedRate: 10, weightBase: 'PER_TRUCK', effectiveFrom: '2026-01-01' })).status).toBe(400);
      expect((await putRate({ rateMode: 'FIXED', fixedRate: 10, weightBase: 'CLEAR_WEIGHT', maxActualPercent: 120, effectiveFrom: '2026-01-01' })).status).toBe(400);
      expect((await parameter('ALUMINIUM_PET')).rates).toHaveLength(1);
    });

    it('adds a rule from a new date, and updates in place when the date already has one', async () => {
      const added = await putRate({ rateMode: 'FIXED', fixedRate: 12, weightBase: 'CLEAR_WEIGHT', effectiveFrom: '2026-01-01' });
      expect(added.status).toBe(200);
      expect(added.body.rates.map((r: { effectiveFrom: string; fixedRate: number }) => [r.effectiveFrom, r.fixedRate])).toEqual([['2026-01-01', 12], ['2000-01-01', 10]]);
      expect(parameterOf(await previewCalc('2026-08-26'), 'ALUMINIUM_PET').rate).toBe(12);
      expect(parameterOf(await previewCalc('2025-08-26'), 'ALUMINIUM_PET').rate).toBe(10);

      const updated = await putRate({ rateMode: 'CLEAR_RATE_MINUS_20', weightBase: 'CLEAR_WEIGHT', effectiveFrom: '2026-01-01' });
      expect(updated.body.rates).toHaveLength(2);
      expect(updated.body.rates[0]).toMatchObject({ rateMode: 'CLEAR_RATE_MINUS_20', fixedRate: null });
      expect(parameterOf(await previewCalc('2026-08-26'), 'ALUMINIUM_PET').rate).toBe(100);

      const audits = await prisma.auditLog.findMany({ where: { action: 'RATE_UPDATE', field: 'ALUMINIUM_PET.rate' }, orderBy: { at: 'asc' } });
      expect(audits.map((a) => [a.oldValue, a.newValue])).toEqual([
        [null, '2026-01-01 FIXED 12 CLEAR_WEIGHT'],
        ['2026-01-01 FIXED 12 CLEAR_WEIGHT', '2026-01-01 CLEAR_RATE_MINUS_20 CLEAR_WEIGHT'],
      ]);
    });

    it('removes a rule added by mistake, but never the last one', async () => {
      const aluminium = await parameter('ALUMINIUM_PET');
      const [added, original] = aluminium.rates;
      const url = (rateId: string) => `/api/admin/parameters/${aluminium.id}/rate/${rateId}`;
      expect((await request(app).delete(url(added!.id)).set(manager.auth)).status).toBe(403);
      expect((await request(app).delete(url('missing')).set(admin.auth)).status).toBe(404);

      const removed = await request(app).delete(url(added!.id)).set(admin.auth);
      expect(removed.status).toBe(200);
      expect(removed.body.rates.map((r: { id: string }) => r.id)).toEqual([original!.id]);
      expect((await request(app).delete(url(original!.id)).set(admin.auth)).status).toBe(400);

      // Back on the sheet's rules.
      expect((await previewCalc()).grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    });
  });
});

describe('global settings', () => {
  const put = (body: object) => request(app).put('/api/admin/settings').set(admin.auth).send(body);

  it('returns the values the engine uses, defaults included', async () => {
    const res = await request(app).get('/api/admin/settings').set(admin.auth);
    expect(res.body).toEqual({ toleranceFraction: 0.005, useWeightToleranceRow: false, allowNegativeOtherShortage: false, defaultWeightTolerancePercent: null } satisfies SettingsDto);
  });

  it('rejects unknown keys and out-of-range values', async () => {
    expect((await put({ toleranceFraction: 0.005, currency: 'USD' })).status).toBe(400);
    expect((await put({ toleranceFraction: 0.21 })).status).toBe(400);
    expect((await put({ toleranceFraction: -0.001 })).status).toBe(400);
    expect((await put({ toleranceFraction: '0.01' })).status).toBe(400);
    expect((await put({ useWeightToleranceRow: 'yes' })).status).toBe(400);
    expect((await put({ defaultWeightTolerancePercent: 101 })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    expect(await prisma.setting.count()).toBe(1);
  });

  it('toleranceFraction decides whether the weight shortage is charged', async () => {
    // The sample truck is 90 kg short on 11,500 kg (0.78%): charged at the sheet's 0.5%, not at 1%.
    const before = await previewCalc();
    expect(before.shortage.beyondTolerance).toBe(true);
    const weightShort = before.shortage.lines.find((l) => l.kind === 'WEIGHT_SHORT')!.standardAmount;
    expect(weightShort).toBeCloseTo(90 * 120, 2);

    const res = await put({ toleranceFraction: 0.01 });
    expect(res.status).toBe(200);
    expect(res.body.toleranceFraction).toBe(0.01);
    const after = await previewCalc();
    expect(after.shortage.beyondTolerance).toBe(false);
    expect(after.grandTotal.standardAmount).toBeCloseTo(before.grandTotal.standardAmount - weightShort, 2);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'SETTING_UPDATE', field: 'toleranceFraction' } });
    expect([audit?.oldValue, audit?.newValue]).toEqual(['0.005', '0.01']);

    await put({ toleranceFraction: 0.005 });
    expect((await previewCalc()).grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
  });

  it('saves the switches and the default tolerance, which the lookups then serve; blank clears it', async () => {
    const res = await put({ useWeightToleranceRow: true, allowNegativeOtherShortage: true, defaultWeightTolerancePercent: 0.5 });
    expect(res.body).toEqual({ toleranceFraction: 0.005, useWeightToleranceRow: true, allowNegativeOtherShortage: true, defaultWeightTolerancePercent: 0.5 });
    const lookups = await request(app).get('/api/lookups').set(gate.auth);
    expect(lookups.body.defaultWeightTolerancePercent).toBe(0.5);
    expect(lookups.body.engineConfig).toMatchObject({ useWeightToleranceRow: true, allowNegativeOtherShortage: true });

    // Saving the same values again is not a change.
    const auditsBefore = await prisma.auditLog.count({ where: { action: 'SETTING_UPDATE' } });
    await put({ useWeightToleranceRow: true });
    expect(await prisma.auditLog.count({ where: { action: 'SETTING_UPDATE' } })).toBe(auditsBefore);

    const cleared = await put({ useWeightToleranceRow: false, allowNegativeOtherShortage: false, defaultWeightTolerancePercent: null });
    expect(cleared.body).toMatchObject({ useWeightToleranceRow: false, defaultWeightTolerancePercent: null });
    expect((await request(app).get('/api/lookups').set(gate.auth)).body.defaultWeightTolerancePercent).toBeNull();
  });
});
