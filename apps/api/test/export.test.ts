import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleReportInput } from '@dalmia/calc';
import type { ReportDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
const sample = sampleReportInput();
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tmp');
let gate: Session, store: Session, analyst: Session, stores: Session, manager: Session, admin: Session;

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Drives a report through the API. `reportDate` decides which seasonal rows the export must use. */
async function createReport(reportDate: string, options: { approve: boolean; dirtyBottle?: boolean }): Promise<ReportDto> {
  const created = await request(app)
    .post('/api/reports')
    .set(gate.auth)
    .send({ reportDate, partyNameRaw: 'ABC', truckNumber: 'MH 15 XY 1234', poNumber: 'PO-1', invoiceNumber: 'INV-1', invoiceDate: reportDate });
  const id: string = created.body.id;
  const desk = (prefix: string) => ({
    materials: sample.materials.map(({ name: _n, ...m }) => Object.fromEntries(Object.entries(m).filter(([k]) => k === 'code' || (prefix === 'invoice' ? k.startsWith('invoice') || k === 'dalmiaRate' : k === 'dalmiaWeightKg' || k === 'dalmiaBales')))),
  });
  await request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(desk('invoice'));
  await request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth);
  await request(app).patch(`/api/reports/${id}/weights`).set(store.auth).send(desk('dalmia'));
  await request(app).post(`/api/reports/${id}/submit-weights`).set(store.auth);

  const readings = sample.readings.map((r) => ({ parameterCode: r.parameterCode, perBale: r.perBale, affectedBales: undefined as number | undefined }));
  if (options.dirtyBottle) {
    const dirty = readings.find((r) => r.parameterCode === 'DIRTY_BOTTLE')!;
    dirty.perBale = [4.95, 4.8, null]; // 5%
    dirty.affectedBales = 10;
  }
  await request(app).patch(`/api/reports/${id}/qc`).set(analyst.auth).send({ baleWeightsKg: sample.baleWeightsKg, readings });
  await request(app).post(`/api/reports/${id}/submit-qc`).set(analyst.auth);
  await request(app).patch(`/api/reports/${id}/grn`).set(stores.auth).send({ grnNumber: `GRN/${reportDate}` });
  await request(app).post(`/api/reports/${id}/submit-grn`).set(stores.auth);
  // Moisture's excess differs by season, so only concessions that fit are applied.
  const adjustments = sample.readings
    .filter((r) => (r.purchaseAdjustment ?? 0) > 0)
    .map((r) => ({ parameterCode: r.parameterCode, purchaseAdjustment: r.purchaseAdjustment! }));
  const patched = await request(app).patch(`/api/reports/${id}/approval`).set(manager.auth).send({ adjustments, remarks: 'Export test', weightTolerancePercent: 0.5 });
  expect(patched.status).toBe(200);
  if (options.approve) expect((await request(app).post(`/api/reports/${id}/approve`).set(manager.auth)).status).toBe(200);
  return (await request(app).get(`/api/reports/${id}`).set(gate.auth)).body;
}

async function downloadWorkbook(id: string, saveAs: string): Promise<ExcelJS.Worksheet> {
  const res = await request(app).get(`/api/reports/${id}/export.xlsx`).set(admin.auth).buffer(true).parse(binary);
  expect(res.status).toBe(200);
  expect(res.headers['content-type']).toContain('spreadsheetml');
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, saveAs), res.body as Buffer); // kept for scripts/verify-excel-export.ps1
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
  return wb.getWorksheet('Format')!;
}

const cached = (ws: ExcelJS.Worksheet, address: string): unknown => {
  const v = ws.getCell(address).value;
  return v && typeof v === 'object' && 'formula' in v ? (v as ExcelJS.CellFormulaValue).result : v;
};
const formula = (ws: ExcelJS.Worksheet, address: string): string | undefined => {
  const v = ws.getCell(address).value;
  return v && typeof v === 'object' && 'formula' in v ? (v as ExcelJS.CellFormulaValue).formula : undefined;
};

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [gate, store, analyst, stores, manager, admin] = await Promise.all([login(app, 'GATE'), login(app, 'RM_STORE'), login(app, 'QC_ANALYST'), login(app, 'STORES'), login(app, 'QC_MANAGER'), login(app, 'ADMIN')]);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('GET /api/reports/:id/export.xlsx', () => {
  let report: ReportDto;
  let ws: ExcelJS.Worksheet;

  beforeAll(async () => {
    report = await createReport('2026-08-26', { approve: true, dirtyBottle: true });
    ws = await downloadWorkbook(report.id, 'export-monsoon.xlsx');
  });

  it('requires authentication and names the file after the report', async () => {
    expect((await request(app).get(`/api/reports/${report.id}/export.xlsx`)).status).toBe(401);
    const res = await request(app).get(`/api/reports/${report.id}/export.xlsx`).set(admin.auth).buffer(true).parse(binary);
    expect(res.headers['content-disposition']).toContain('QC-26-27-0001 MH 15 XY 1234.xlsx');
  });

  it('fills the header cells where the real sheet keeps them', () => {
    expect(cached(ws, 'B11')).toBe('ABC');
    expect(cached(ws, 'B13')).toBe('MH 15 XY 1234');
    expect(cached(ws, 'I13')).toBe('GRN/2026-08-26');
    expect((cached(ws, 'L10') as Date).toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(cached(ws, 'B51')).toBe('Export test');
    expect(cached(ws, 'D50')).toBe(0.5);
    expect(cached(ws, 'B54')).toBe('QC_ANALYST user');
    expect(cached(ws, 'L54')).toBe('QC_MANAGER user');
  });

  it('writes inputs as values and keeps the sheet’s formulas', () => {
    expect(cached(ws, 'E15')).toBe(10000);
    expect(cached(ws, 'E19')).toBe(90);
    expect(cached(ws, 'E24')).toBe(99);
    expect(ws.getCell('H26').value).toBe(5.38); // the template had "=5.38" here
    expect(cached(ws, 'E34')).toBe(0.4);
    expect(cached(ws, 'N26')).toBe(5.45); // "purchase allowed": the total % accepted
    expect(formula(ws, 'R26')).toBe('MAX(MIN(N26,MAX(L26,D26))-D26,0)%*$M$18');
    expect(formula(ws, 'R36')).toBe('MAX(MIN(N36,MAX(L36,D36))-D36,0)%*$M$18'); // approved always uses M18, even for Clear-weight parameters
    expect(cached(ws, 'M28')).toBe(10);
    expect(formula(ws, 'M18')).toBe('E18+G18+I18+K18+L18'); // was a shared formula in the template
    expect(formula(ws, 'Q26')).toBe('IF(L26>D26,((L26-D26)%*$M$18*$O$26),)');
    expect(formula(ws, 'Q43')).toBe('IF(M18/M15<0.995,((M15-M18)*P43),0)');
    expect(formula(ws, 'Q49')).toBe('Q41+Q48');
    expect(formula(ws, 'O47')).toBe('-L21'); // template typo (=-L20) corrected
  });

  it('caches the app’s figures in the formula cells, not the template’s sample results', () => {
    const out = report.output;
    const dirty = out.parameters.find((p) => p.parameterCode === 'DIRTY_BOTTLE')!;
    expect(dirty.standardAmount).toBeGreaterThan(0);
    expect(cached(ws, 'Q28')).toBeCloseTo(dirty.standardAmount, 6);
    expect(cached(ws, 'S28')).toBeCloseTo(dirty.approvedAmount, 6); // no formula in the sheet: written as a value
    expect(cached(ws, 'Q49')).toBeCloseTo(out.grandTotal.standardAmount, 6);
    expect(cached(ws, 'S49')).toBeCloseTo(out.grandTotal.approvedAmount, 6);
    expect(cached(ws, 'M18')).toBe(11410);
    expect(cached(ws, 'V10')).toBeCloseTo(out.grandTotal.approvedAmount, 2);
    // Cells the app has no figure for carry no stale result.
    expect(cached(ws, 'E31')).toBeUndefined();
  });

  it('records the export in the audit log', async () => {
    const rows = await prisma.auditLog.findMany({ where: { reportId: report.id, action: 'EXPORT_EXCEL' } });
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('rest-of-year report (Oct–Jun)', () => {
  it('uses rows 27 and 29 and gives them the formulas the template lacks', async () => {
    const report = await createReport('2026-11-10', { approve: true, dirtyBottle: true });
    const ws = await downloadWorkbook(report.id, 'export-offseason.xlsx');
    const moisture = report.output.parameters.find((p) => p.parameterCode === 'MOISTURE')!;
    expect(moisture.normPercent).toBe(3);

    expect(cached(ws, 'F27')).toBe(9.52);
    expect(ws.getCell('F26').value).toBeNull();
    expect(cached(ws, 'D27')).toBe(3);
    expect(formula(ws, 'Q27')).toBe('IF(L27>D27,((L27-D27)%*$M$18*$O$27),)');
    expect(cached(ws, 'Q27')).toBeCloseTo(moisture.standardAmount, 6);
    expect(cached(ws, 'E29')).toBe(4.95);
    expect(cached(ws, 'M29')).toBe(10);
    expect(formula(ws, 'Q29')).toContain('$M$18/$M$19');
    expect(cached(ws, 'S49')).toBeCloseTo(report.output.grandTotal.approvedAmount, 6);
  });
});

describe('exports are ADMIN only', () => {
  it('returns 403 to every other role, for both formats and the template', async () => {
    const report = await createReport('2026-08-29', { approve: true });
    for (const session of [gate, store, analyst, stores, manager]) {
      for (const url of [`/api/reports/${report.id}/export.pdf`, `/api/reports/${report.id}/export.xlsx`, '/api/reports/template.xlsx']) {
        const res = await request(app).get(url).set(session.auth);
        expect(res.status, url).toBe(403);
        expect(res.body.message).toContain('ADMIN');
      }
    }
  });
});

describe('GET /api/reports/template.xlsx', () => {
  it('returns the blank sheet: no sample data, formulas intact', async () => {
    const res = await request(app).get('/api/reports/template.xlsx').set(admin.auth).buffer(true).parse(binary);
    expect(res.status).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet('Format')!;
    for (const address of ['B11', 'B13', 'E15', 'E18', 'E24', 'F26', 'H26', 'E34', 'N26', 'L10']) {
      expect(ws.getCell(address).value, address).toBeNull();
    }
    expect(String(cached(ws, 'A10')).trim()).toBe('QC Report');
    expect(formula(ws, 'Q49')).toBe('Q41+Q48');
    expect(cached(ws, 'Q49')).toBeUndefined();
  });
});

describe('GET /api/reports/:id/export.pdf', () => {
  it('returns a PDF for an approved report and for one still in progress', async () => {
    const approved = await createReport('2026-08-27', { approve: true });
    const pending = await createReport('2026-08-28', { approve: false });
    for (const [report, name] of [[approved, 'export-approved.pdf'], [pending, 'export-pending.pdf']] as const) {
      const res = await request(app).get(`/api/reports/${report.id}/export.pdf`).set(admin.auth).buffer(true).parse(binary);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      const body = res.body as Buffer;
      expect(body.subarray(0, 5).toString()).toBe('%PDF-');
      expect(body.length).toBeGreaterThan(10_000);
      // A debit note is a single sheet: the whole report, narration and sign-off must fit on one page.
      expect(body.toString('latin1').match(/\/Type \/Page(?!s)/g)).toHaveLength(1);
      fs.writeFileSync(path.join(OUT_DIR, name), body);
    }
    expect((await request(app).get(`/api/reports/${approved.id}/export.pdf`)).status).toBe(401);
  });
});
