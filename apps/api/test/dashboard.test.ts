import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleReportInput, toYMD } from '@dalmia/calc';
import type {
  DashboardMonthRow,
  DashboardParameterRow,
  DashboardSummaryDto,
  DashboardSupplierRow,
  ExcelViewResponse,
  ReportDto,
} from '@dalmia/types';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
const sample = sampleReportInput();
let gate: Session, store: Session, analyst: Session, stores: Session, manager: Session, admin: Session;

// The workbook's worked example: every approved report below carries exactly these totals.
const STANDARD = 51818.86;
const APPROVED = 19160.84;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

interface Fixture {
  reportDate: string;
  supplierId?: string;
  partyNameRaw?: string;
  /** How far to drive the workflow. */
  upTo: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED';
}

/** The workbook sample driven through the API (same pattern as export.test.ts). All dates used are monsoon dates, so the totals match the sheet. */
async function createReport(f: Fixture, n: number): Promise<ReportDto> {
  const created = await request(app)
    .post('/api/reports')
    .set(gate.auth)
    .send({ reportDate: f.reportDate, supplierId: f.supplierId ?? null, partyNameRaw: f.partyNameRaw ?? null, truckNumber: `MH 15 XY ${1000 + n}`, invoiceNumber: `INV-${n}` });
  expect(created.status).toBe(201);
  const id: string = created.body.id;
  if (f.upTo === 'DRAFT') return created.body;

  const desk = (prefix: string) => ({
    materials: sample.materials.map(({ name: _n, ...m }) => Object.fromEntries(Object.entries(m).filter(([k]) => k === 'code' || (prefix === 'invoice' ? k.startsWith('invoice') || k === 'dalmiaRate' : k === 'dalmiaWeightKg' || k === 'dalmiaBales')))),
  });
  await request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(desk('invoice'));
  await request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth);
  await request(app).patch(`/api/reports/${id}/weights`).set(store.auth).send(desk('dalmia'));
  await request(app).post(`/api/reports/${id}/submit-weights`).set(store.auth);
  const readings = sample.readings.map((r) => ({ parameterCode: r.parameterCode, perBale: r.perBale }));
  await request(app).patch(`/api/reports/${id}/qc`).set(analyst.auth).send({ baleWeightsKg: sample.baleWeightsKg, readings });
  await request(app).post(`/api/reports/${id}/submit-qc`).set(analyst.auth);
  await request(app).patch(`/api/reports/${id}/grn`).set(stores.auth).send({ grnNumber: `GRN/${n}` });
  await request(app).post(`/api/reports/${id}/submit-grn`).set(stores.auth);
  const adjustments = sample.readings
    .filter((r) => (r.purchaseAdjustment ?? 0) > 0)
    .map((r) => ({ parameterCode: r.parameterCode, purchaseAdjustment: r.purchaseAdjustment! }));
  expect((await request(app).patch(`/api/reports/${id}/approval`).set(manager.auth).send({ adjustments })).status).toBe(200);
  if (f.upTo === 'APPROVED') expect((await request(app).post(`/api/reports/${id}/approve`).set(manager.auth)).status).toBe(200);
  return (await request(app).get(`/api/reports/${id}`).set(gate.auth)).body;
}

const today = toYMD(new Date());
const todayIso = `${today.year}-${String(today.month).padStart(2, '0')}-${String(today.day).padStart(2, '0')}`;
let alpha: string, beta: string;
let fixtures: Fixture[];
let reports: ReportDto[];

const get = <T>(url: string) => request(app).get(url).set(admin.auth).then((res) => (expect(res.status, url).toBe(200), res.body as T));

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [gate, store, analyst, stores, manager, admin] = await Promise.all([login(app, 'GATE'), login(app, 'RM_STORE'), login(app, 'QC_ANALYST'), login(app, 'STORES'), login(app, 'QC_MANAGER'), login(app, 'ADMIN')]);
  alpha = (await prisma.supplier.create({ data: { name: 'Alpha Polymers', code: 'ALP' } })).id;
  beta = (await prisma.supplier.create({ data: { name: 'Beta Recyclers', code: 'BET' } })).id;

  fixtures = [
    { reportDate: '2026-08-26', supplierId: alpha, upTo: 'APPROVED' },
    { reportDate: '2026-09-05', supplierId: alpha, upTo: 'APPROVED' },
    { reportDate: '2026-08-27', supplierId: beta, upTo: 'APPROVED' },
    { reportDate: '2026-08-29', partyNameRaw: 'Loose Party', upTo: 'APPROVED' }, // party typed freely, not in the master
    { reportDate: '2026-08-28', supplierId: alpha, upTo: 'PENDING_APPROVAL' },
    { reportDate: todayIso, supplierId: beta, upTo: 'DRAFT' },
  ];
  reports = [];
  for (const [i, f] of fixtures.entries()) reports.push(await createReport(f, i + 1));
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('dashboard is ADMIN only', () => {
  const URLS = ['summary', 'by-supplier', 'by-parameter', 'monthly', 'excel-view', 'excel-view.xlsx'].map((p) => `/api/dashboard/${p}`);

  it('returns 401 without a token and 403 to every other role', async () => {
    for (const url of URLS) {
      expect((await request(app).get(url)).status, url).toBe(401);
      for (const session of [gate, store, analyst, stores, manager]) {
        const res = await request(app).get(url).set(session.auth);
        expect(res.status, url).toBe(403);
        expect(res.body.message).toContain('ADMIN');
      }
    }
  });

  it('rejects malformed filters', async () => {
    expect((await request(app).get('/api/dashboard/summary?from=26-08-2026').set(admin.auth)).status).toBe(400);
    expect((await request(app).get('/api/dashboard/summary?from=2026-09-01&to=2026-08-01').set(admin.auth)).status).toBe(400);
    expect((await request(app).get('/api/dashboard/excel-view?status=DONE').set(admin.auth)).status).toBe(400);
  });
});

describe('the fixtures reproduce the workbook', () => {
  it('each approved report is standard 51,818.86 and approved 43,791.62', () => {
    for (const r of reports.filter((x) => x.status === 'APPROVED')) {
      expect(r.output.grandTotal.standardAmount).toBeCloseTo(STANDARD, 2);
      expect(r.output.grandTotal.approvedAmount).toBeCloseTo(APPROVED, 2);
    }
  });
});

describe('GET /api/dashboard/summary', () => {
  it('counts money on approved reports only', async () => {
    const s = await get<DashboardSummaryDto>('/api/dashboard/summary');
    expect(s.reportsInRange).toBe(6);
    expect(s.approvedReports).toBe(4);
    expect(s.standardTotal).toBeCloseTo(4 * STANDARD, 1);
    expect(s.approvedTotal).toBeCloseTo(4 * APPROVED, 1);
    expect(s.waivedTotal).toBeCloseTo(4 * (STANDARD - APPROVED), 1);
    expect(s.pendingApprovals).toBe(1);
    // Calendar month in Asia/Kolkata, by report date — whatever month the tests run in.
    const thisMonth = todayIso.slice(0, 7);
    expect(s.reportsThisMonth).toBe(fixtures.filter((f) => f.reportDate.startsWith(thisMonth)).length);
  });

  it('applies the date range to the figures but not to pending approvals', async () => {
    const s = await get<DashboardSummaryDto>('/api/dashboard/summary?from=2026-09-01&to=2026-09-30');
    expect(s.reportsInRange).toBe(fixtures.filter((f) => f.reportDate >= '2026-09-01' && f.reportDate <= '2026-09-30').length);
    expect(s.approvedReports).toBe(1);
    expect(s.approvedTotal).toBeCloseTo(APPROVED, 2);
    expect(s.pendingApprovals).toBe(1);

    // Both ends are inclusive.
    const oneDay = await get<DashboardSummaryDto>('/api/dashboard/summary?from=2026-08-26&to=2026-08-27');
    expect(oneDay.approvedReports).toBe(2);
  });

  it('applies the supplier filter', async () => {
    const a = await get<DashboardSummaryDto>(`/api/dashboard/summary?supplierId=${alpha}`);
    expect(a).toMatchObject({ approvedReports: 2, pendingApprovals: 1 });
    expect(a.standardTotal).toBeCloseTo(2 * STANDARD, 2);
    const b = await get<DashboardSummaryDto>(`/api/dashboard/summary?supplierId=${beta}&to=2026-08-31`);
    expect(b).toMatchObject({ reportsInRange: 1, approvedReports: 1, pendingApprovals: 0 });
  });
});

describe('GET /api/dashboard/by-supplier', () => {
  it('ranks suppliers by approved deduction and groups unlisted parties by the typed name', async () => {
    const rows = await get<DashboardSupplierRow[]>('/api/dashboard/by-supplier');
    expect(rows.map((r) => [r.supplierId, r.supplierName, r.reportCount])).toEqual([
      [alpha, 'Alpha Polymers', 2],
      [beta, 'Beta Recyclers', 1],
      [null, 'Loose Party', 1],
    ]);
    expect(rows[0]!.approvedTotal).toBeCloseTo(2 * APPROVED, 2);
    expect(rows[0]!.standardTotal).toBeCloseTo(2 * STANDARD, 2);
    expect(rows[1]!.approvedTotal).toBeCloseTo(APPROVED, 2);
  });

  it('honours the filters', async () => {
    const august = await get<DashboardSupplierRow[]>('/api/dashboard/by-supplier?from=2026-08-01&to=2026-08-31');
    expect(august.find((r) => r.supplierId === alpha)).toMatchObject({ reportCount: 1 });
    const onlyBeta = await get<DashboardSupplierRow[]>(`/api/dashboard/by-supplier?supplierId=${beta}`);
    expect(onlyBeta.map((r) => r.supplierName)).toEqual(['Beta Recyclers']);
  });
});

describe('GET /api/dashboard/by-parameter', () => {
  it('sums the deduction snapshots per parameter, plus one weight-shortage bucket', async () => {
    const rows = await get<DashboardParameterRow[]>('/api/dashboard/by-parameter');
    expect(rows.map((r) => r.key)).toEqual([...sample.config.parameters.map((p) => p.code), 'WEIGHT_SHORTAGE']);

    const one = reports[0]!.output;
    for (const p of one.parameters) {
      const row = rows.find((r) => r.key === p.parameterCode)!;
      expect(row.standardAmount, p.name).toBeCloseTo(4 * p.standardAmount, 2);
      expect(row.approvedAmount, p.name).toBeCloseTo(4 * p.approvedAmount, 2);
    }
    const moisture = rows.find((r) => r.key === 'MOISTURE')!;
    expect(moisture).toMatchObject({ name: 'Moisture', category: 'DISCRETIONARY' });
    expect(moisture.standardAmount).toBeGreaterThan(moisture.approvedAmount);

    const shortage = rows.at(-1)!;
    expect(shortage).toMatchObject({ name: 'Weight shortage', category: 'SHORTAGE' });
    expect(shortage.standardAmount).toBeCloseTo(4 * one.shortage.subtotal.standardAmount, 2);
    // The buckets add up to the report totals.
    expect(rows.reduce((a, r) => a + r.standardAmount, 0)).toBeCloseTo(4 * STANDARD, 1);
    expect(rows.reduce((a, r) => a + r.approvedAmount, 0)).toBeCloseTo(4 * APPROVED, 1);
  });

  it('honours the filters', async () => {
    const rows = await get<DashboardParameterRow[]>(`/api/dashboard/by-parameter?supplierId=${alpha}&from=2026-09-01`);
    expect(rows.reduce((a, r) => a + r.approvedAmount, 0)).toBeCloseTo(APPROVED, 2);
    const none = await get<DashboardParameterRow[]>('/api/dashboard/by-parameter?to=2020-01-01');
    expect(none.every((r) => r.standardAmount === 0 && r.approvedAmount === 0)).toBe(true);
  });
});

describe('GET /api/dashboard/monthly', () => {
  it('groups approved reports by month with the average moisture', async () => {
    const rows = await get<DashboardMonthRow[]>('/api/dashboard/monthly');
    expect(rows.map((r) => [r.month, r.reportCount])).toEqual([['2026-08', 3], ['2026-09', 1]]);
    expect(rows[0]!.standardTotal).toBeCloseTo(3 * STANDARD, 2);
    expect(rows[0]!.approvedTotal).toBeCloseTo(3 * APPROVED, 2);
    expect(rows[0]!.averageMoisturePercent).toBeCloseTo(7.45, 4); // (9.52 + 5.38) / 2
    expect(rows[1]!.averageMoisturePercent).toBeCloseTo(7.45, 4);
  });

  it('leaves reports without a moisture reading out of the average', async () => {
    // Blank the moisture snapshot of one August report directly: the average must not be pulled towards zero.
    const moisture = await prisma.parameter.findUniqueOrThrow({ where: { code: 'MOISTURE' } });
    const key = { reportId_parameterId: { reportId: reports[2]!.id, parameterId: moisture.id } };
    const original = await prisma.deduction.findUniqueOrThrow({ where: key });
    await prisma.deduction.update({ where: key, data: { actualPercent: 0 } });
    try {
      const rows = await get<DashboardMonthRow[]>('/api/dashboard/monthly');
      expect(rows[0]).toMatchObject({ month: '2026-08', reportCount: 3 });
      expect(rows[0]!.averageMoisturePercent).toBeCloseTo(7.45, 4);
      const onlyBeta = await get<DashboardMonthRow[]>(`/api/dashboard/monthly?supplierId=${beta}`);
      expect(onlyBeta).toHaveLength(1);
      expect(onlyBeta[0]!.averageMoisturePercent).toBeNull();
    } finally {
      await prisma.deduction.update({ where: key, data: { actualPercent: original.actualPercent } });
    }
  });

  it('honours the date filter', async () => {
    const rows = await get<DashboardMonthRow[]>('/api/dashboard/monthly?from=2026-09-01');
    expect(rows.map((r) => r.month)).toEqual(['2026-09']);
  });
});

describe('GET /api/dashboard/excel-view', () => {
  it('lists every status, newest report date first, with the sheet’s key outputs', async () => {
    const view = await get<ExcelViewResponse>('/api/dashboard/excel-view');
    expect(view.total).toBe(6);
    expect(view.rows).toHaveLength(6);
    expect(new Set(view.rows.map((r) => r.status))).toEqual(new Set(['APPROVED', 'PENDING_APPROVAL', 'DRAFT']));
    const dates = view.rows.map((r) => r.reportDate);
    expect(dates).toEqual([...dates].sort().reverse());

    const first = reports[0]!;
    const row = view.rows.find((r) => r.id === first.id)!;
    expect(row).toMatchObject({
      reportNo: first.reportNo,
      reportDate: '2026-08-26',
      supplierName: 'Alpha Polymers',
      truckNumber: 'MH 15 XY 1001',
      grnNumber: 'GRN/1',
      invoiceNumber: 'INV-1',
      status: 'APPROVED',
      source: 'MANUAL',
      totalInvoiceWeightKg: 11500,
      totalDalmiaWeightKg: 11410,
      shortfallKg: 90,
    });
    expect(row.moistureActualPercent).toBeCloseTo(7.45, 4);
    expect(row.discretionaryApproved).toBeCloseTo(first.output.subtotals.discretionary.approvedAmount, 2);
    expect(row.nonDiscretionaryApproved).toBeCloseTo(first.output.subtotals.nonDiscretionary.approvedAmount, 2);
    expect(row.shortageApproved).toBeCloseTo(first.output.shortage.subtotal.approvedAmount, 2);
    expect(row.discretionaryApproved + row.nonDiscretionaryApproved + row.shortageApproved).toBeCloseTo(APPROVED, 2);
    expect(row.standardTotal).toBeCloseTo(STANDARD, 2);
    expect(row.waived).toBeCloseTo(STANDARD - APPROVED, 2);

    expect(view.rows.find((r) => r.supplierName === 'Loose Party')).toBeDefined();
    expect(view.rows.find((r) => r.status === 'DRAFT')).toMatchObject({ totalInvoiceWeightKg: 0, moistureActualPercent: null, approvedTotal: 0 });
  });

  it('filters by status, supplier and date', async () => {
    expect((await get<ExcelViewResponse>('/api/dashboard/excel-view?status=APPROVED')).rows).toHaveLength(4);
    expect((await get<ExcelViewResponse>('/api/dashboard/excel-view?status=PENDING_APPROVAL')).rows.map((r) => r.id)).toEqual([reports[4]!.id]);
    expect((await get<ExcelViewResponse>(`/api/dashboard/excel-view?supplierId=${alpha}&to=2026-08-31`)).rows).toHaveLength(2);
  });
});

describe('GET /api/dashboard/excel-view.xlsx', () => {
  it('returns the same filtered rows as a workbook with a bold, frozen header and Indian number formats', async () => {
    const res = await request(app).get('/api/dashboard/excel-view.xlsx?status=APPROVED&from=2026-08-01&to=2026-08-31').set(admin.auth).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    expect(res.headers['content-disposition']).toContain('QC reports 2026-08-01 to 2026-08-31.xlsx');

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Reports')!;
    const header = (ws.getRow(1).values as unknown[]).slice(1);
    expect(header).toEqual([
      'Report No.', 'Date', 'Supplier', 'Truck No.', 'GRN No.', 'Invoice No.', 'Status', 'Source',
      'Invoice weight (kg)', 'Dalmia weight (kg)', 'Shortfall (kg)', 'Moisture actual %',
      'A) Discretionary approved', 'B) Non-discretionary approved', 'C) Shortage approved',
      'Total standard', 'Total approved', 'Waived',
    ]);
    expect(ws.getCell('A1').font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.rowCount).toBe(1 + 3);

    // Newest first: 29 Aug (Loose Party), 27 Aug (Beta), 26 Aug (Alpha).
    expect(ws.getCell('C2').value).toBe('Loose Party');
    expect(ws.getCell('A4').value).toBe(reports[0]!.reportNo);
    expect((ws.getCell('B4').value as Date).toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(ws.getCell('B4').numFmt).toBe('dd-mm-yyyy');
    expect(ws.getCell('G4').value).toBe('Approved');
    expect(ws.getCell('I4').value).toBe(11500);
    expect(ws.getCell('Q4').value as number).toBeCloseTo(APPROVED, 2);
    expect(ws.getCell('Q4').numFmt).toBe('#,##,##0.00');
    expect(ws.getCell('R4').value as number).toBeCloseTo(STANDARD - APPROVED, 2);

    expect(await prisma.auditLog.count({ where: { action: 'EXPORT_DASHBOARD_EXCEL' } })).toBe(1);
  });
});
