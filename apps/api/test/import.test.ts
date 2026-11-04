import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sampleReportInput } from '@dalmia/calc';
import type { ImportBatchDto, ImportCommitResult, ImportPreviewDto, ReportDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

/**
 * Excel import (admin only). Every workbook is built here from the client's real file
 * ("Debit Note Format 1.xlsx", sheet "Format"), so the importer is always tested against the real layout.
 */
const app = createApp();
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/debit-note-format.xlsx');
const BASE = '/api/admin/import';
let gate: Session, store: Session, analyst: Session, stores: Session, manager: Session, admin: Session;

type Edit = (ws: ExcelJS.Worksheet) => void;

/** The fixture's sheet once per entry (renamed and edited), plus optional sheets that are not the template. */
async function buildWorkbook(sheets: { name: string; edit?: Edit }[], plainSheets: string[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE);
  const source = wb.getWorksheet('Format')!;
  source.name = '__source__'; // frees the name "Format" for a copy
  for (const { name, edit } of sheets) {
    const ws = wb.addWorksheet(name);
    // exceljs has no "duplicate sheet"; assigning the model copies cells, merges and cached results.
    ws.model = { ...structuredClone(source.model), name, id: ws.id } as ExcelJS.WorksheetModel;
    edit?.(ws);
  }
  wb.removeWorksheet(source.id);
  for (const name of plainSheets) wb.addWorksheet(name).getCell('A1').value = 'Rates agreed with suppliers';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Gives a copy of the sheet its own truck, GRN and invoice number so it is not a duplicate of another. */
const consignment = (n: number): Edit => (ws) => {
  ws.getCell('B13').value = `MH 15 AB ${1000 + n}`;
  ws.getCell('I13').value = `DPNL/GRN_RM/2627/${5000 + n}`;
  ws.getCell('L12').value = `INV/${n}`;
};

/** Replaces a formula cell's cached result, as if Excel had calculated something else. */
const setCached = (ws: ExcelJS.Worksheet, address: string, result: number) => {
  const cell = ws.getCell(address);
  cell.value = { formula: cell.formula, result };
};

/** Formulas → their cached values. exceljs cannot move shared formulas, and the importer reads cached values anyway. */
const flatten = (ws: ExcelJS.Worksheet) =>
  ws.eachRow((row) =>
    row.eachCell((cell) => {
      const v = cell.value;
      if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v)) cell.value = (v.result ?? null) as ExcelJS.CellValue;
    }),
  );

const preview = (file: Buffer, name = 'history.xlsx', session: Session = admin) =>
  request(app).post(`${BASE}/preview`).set(session.auth).attach('file', file, name);

async function previewOk(file: Buffer, name?: string): Promise<ImportPreviewDto> {
  const res = await preview(file, name);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function commit(p: ImportPreviewDto, overrides: Record<string, { action?: string; supplierId?: string | null }> = {}, fallbackReportDate?: string): Promise<ImportCommitResult> {
  const res = await request(app)
    .post(`${BASE}/commit`)
    .set(admin.auth)
    .send({
      previewId: p.previewId,
      fallbackReportDate,
      sheets: p.sheets.filter((s) => s.isTemplate).map((s) => ({ sheetName: s.sheetName, action: s.action, ...overrides[s.sheetName] })),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

const getReport = async (id: string): Promise<ReportDto> => (await request(app).get(`/api/reports/${id}`).set(admin.auth)).body;
const resultFor = (r: ImportCommitResult, sheetName: string) => r.results.find((x) => x.sheetName === sheetName)!;

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [gate, store, analyst, stores, manager, admin] = await Promise.all([login(app, 'GATE'), login(app, 'RM_STORE'), login(app, 'QC_ANALYST'), login(app, 'STORES'), login(app, 'QC_MANAGER'), login(app, 'ADMIN')]);
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('import is ADMIN only', () => {
  it('returns 401 without a session and 403 to every other role, on every endpoint', async () => {
    const calls = [
      (r: ReturnType<typeof request>) => r.post(`${BASE}/preview`),
      (r: ReturnType<typeof request>) => r.post(`${BASE}/commit`),
      (r: ReturnType<typeof request>) => r.get(`${BASE}/batches`),
      (r: ReturnType<typeof request>) => r.delete(`${BASE}/batches/anything`),
    ];
    for (const call of calls) {
      expect((await call(request(app))).status).toBe(401);
      for (const session of [gate, store, analyst, stores, manager]) {
        const res = await call(request(app)).set(session.auth);
        expect(res.status).toBe(403);
        expect(res.body.message).toContain('ADMIN');
      }
    }
  });

  it('accepts only .xlsx files and only UUID preview ids', async () => {
    expect((await request(app).post(`${BASE}/preview`).set(admin.auth)).status).toBe(400);
    expect((await preview(Buffer.from('truck,grn\n1,2'), 'history.csv')).status).toBe(400);
    expect((await preview(Buffer.from('not a zip'), 'history.xlsx')).status).toBe(400);
    const sheets = [{ sheetName: 'Format', action: 'import' }];
    expect((await request(app).post(`${BASE}/commit`).set(admin.auth).send({ previewId: '../../.env', sheets })).status).toBe(400);
    expect((await request(app).post(`${BASE}/commit`).set(admin.auth).send({ previewId: '3f0e8a52-6f0e-4d0a-9d5e-0a1b2c3d4e5f', sheets })).status).toBe(404);
  });
});

describe('the client’s real workbook', () => {
  let batchId: string;
  let reportId: string;

  it('is previewed with its truck, GRN, date and totals, and the engine agrees with it', async () => {
    const p = await previewOk(await buildWorkbook([{ name: 'Format' }]), 'Debit Note Format 1.xlsx');
    expect(p.previewId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.fileName).toBe('Debit Note Format 1.xlsx');
    expect(p.sheets).toHaveLength(1);
    const s = p.sheets[0]!;
    expect(s).toMatchObject({
      sheetName: 'Format',
      isTemplate: true,
      truckNumber: 'MH 15 XY 1234',
      grnNumber: 'DPNL/GRN_RM/2627/1234',
      invoiceNumber: 'ABC/26-27-1',
      reportDate: '2026-08-26',
      partyName: 'ABC',
      supplierMatch: null, // will be created
      hasMismatch: true, // the sheet uses the old approved rule
      errors: [],
      duplicates: [],
      action: 'import',
    });
    expect(s.sheetTotals!.standardAmount).toBeCloseTo(51818.86, 2);
    expect(s.sheetTotals!.approvedAmount).toBeCloseTo(43791.62, 2);
    expect(s.engineTotals!.standardAmount).toBeCloseTo(51818.86, 2);
    expect(s.engineTotals!.approvedAmount).toBeCloseTo(19160.84, 2);
    // Nothing is saved by a preview.
    expect(await prisma.report.count()).toBe(0);

    const done = await commit(p);
    expect(done).toMatchObject({ importedCount: 1, skippedCount: 0, errorCount: 0, fileName: 'Debit Note Format 1.xlsx' });
    batchId = done.batchId;
    reportId = done.results[0]!.reportId!;
    expect(done.results[0]).toMatchObject({ outcome: 'imported', reportNo: 'QC/26-27/0001', hasMismatch: true });
  });

  it('becomes an APPROVED, IMPORTED report that shows the sheet’s own figures', async () => {
    const dto = await getReport(reportId);
    expect(dto).toMatchObject({
      status: 'APPROVED',
      source: 'IMPORTED',
      reportNo: 'QC/26-27/0001',
      reportDate: '2026-08-26',
      supplierName: 'ABC',
      partyNameRaw: 'ABC',
      poNumber: 'DPNL/PO_RM/2627/1234',
      tokenNumber: '1',
      tokenDate: '2026-08-26',
      invoiceDate: '2026-08-26',
      hasMismatch: true,
      outputIsSnapshot: true,
      baleWeightsKg: [99, 96, null],
    });
    expect(dto.approvedAt).not.toBeNull();
    expect(dto.recomputedTotal).toBeCloseTo(19160.84, 2);
    expect(dto.materials.find((m) => m.code === 'CLEAR')).toMatchObject({ invoiceWeightKg: 10000, dalmiaWeightKg: 9950, dalmiaBales: 90, dalmiaRate: 120 });
    expect(dto.readings.find((r) => r.parameterCode === 'MOISTURE')).toMatchObject({ perBale: [9.52, 5.38, null], purchaseAdjustment: 5.45 }); // H26 is "=5.38"; N26's 0.45 above the 5 norm → "purchase allowed" 5.45
    expect(dto.readings.find((r) => r.parameterCode === 'IRON_PATTI')!.perBale).toEqual([0.4, 0.7, null]);

    const moisture = dto.output.parameters.find((x) => x.parameterCode === 'MOISTURE')!;
    expect(moisture.normPercent).toBe(5);
    expect(moisture.standardAmount).toBeCloseTo(33545.4, 4); // Q26
    expect(moisture.approvedAmount).toBeCloseTo(27384, 4); // S26
    const clear = dto.output.shortage.lines.find((l) => l.materialCode === 'CLEAR')!;
    expect(clear).toMatchObject({ shortageQty: 50, rate: 120, standardAmount: 10800, approvedAmount: 10800 });
    expect(dto.output.grandTotal.standardAmount).toBeCloseTo(51818.8615, 4);
    expect(dto.output.grandTotal.approvedAmount).toBeCloseTo(43791.6215, 4);

    const row = await prisma.report.findUniqueOrThrow({ where: { id: reportId } });
    expect(row).toMatchObject({ importBatchId: batchId, importSheetName: 'Format' });
    expect(await prisma.supplier.findUnique({ where: { code: 'ABC' } })).toMatchObject({ name: 'ABC' });
    const audit = await prisma.auditLog.findMany({ where: { action: { in: ['IMPORT_COMMIT', 'REPORT_IMPORT'] } } });
    expect(audit.map((a) => a.action).sort()).toEqual(['IMPORT_COMMIT', 'REPORT_IMPORT']);
  });

  it('cannot be reopened, because saving it again would replace the sheet’s figures', async () => {
    const res = await request(app).post(`/api/reports/${reportId}/reopen`).set(admin.auth).send({ reason: 'Wrong rate typed' });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('imported from Excel');
    expect((await getReport(reportId)).status).toBe('APPROVED');
  });

  it('is a duplicate the second time: skipped by default, replaced with “overwrite”', async () => {
    const file = await buildWorkbook([{ name: 'Format' }]);
    const first = await previewOk(file);
    expect(first.sheets[0]).toMatchObject({ action: 'skip', supplierMatch: { name: 'ABC' } });
    expect(first.sheets[0]!.duplicates).toEqual([{ reportId, reportNo: 'QC/26-27/0001', status: 'APPROVED', matchedOn: 'GRN' }]);

    // Insisting on "import" still does not create a second copy.
    const skipped = await commit(first, { Format: { action: 'import' } });
    expect(skipped).toMatchObject({ importedCount: 0, skippedCount: 1 });
    expect(skipped.results[0]!.reason).toContain('QC/26-27/0001');
    expect(await prisma.report.count()).toBe(1);

    const replaced = await commit(await previewOk(file), { Format: { action: 'overwrite' } });
    expect(replaced.results[0]).toMatchObject({ outcome: 'imported', overwritten: ['QC/26-27/0001'] });
    expect(await prisma.report.count()).toBe(1);
    expect(await prisma.report.findUnique({ where: { id: reportId } })).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: 'IMPORT_OVERWRITE', field: 'QC/26-27/0001' } })).toBe(1);

    // A committed preview cannot be committed again.
    const again = await request(app).post(`${BASE}/commit`).set(admin.auth).send({ previewId: first.previewId, sheets: [{ sheetName: 'Format', action: 'import' }] });
    expect(again.status).toBe(404);
  });
});

describe('a workbook with a tab per truck', () => {
  const sheets = [
    { name: 'MH15AB1001', edit: consignment(1) },
    {
      name: 'No date',
      edit: (ws: ExcelJS.Worksheet) => {
        consignment(2)(ws);
        ws.getCell('L10').value = null;
        ws.getCell('B11').value = 'Mapped Traders Pvt Ltd';
      },
    },
    {
      // A row inserted above the parameters: every label below row 24 sits one row lower than in the template.
      name: 'Shifted',
      edit: (ws: ExcelJS.Worksheet) => {
        consignment(3)(ws);
        ws.getCell('B11').value = 'abc'; // same supplier, different case
        ws.getCell('B54').value = 'R. Patil';
        ws.getCell('L54').value = 'S. Kulkarni';
        ws.getCell('B51').value = 'Bales wet on arrival';
        ws.getCell('A47').value = 'Other (Please Specify): PP caps';
        flatten(ws);
        ws.spliceRows(24, 0, []);
      },
    },
    {
      name: 'Text date',
      edit: (ws: ExcelJS.Worksheet) => {
        consignment(4)(ws);
        ws.getCell('L10').value = '05-11-2025';
        ws.getCell('I11').value = 45966; // Excel serial number for 2025-11-05
      },
    },
    {
      name: 'Empty',
      edit: (ws: ExcelJS.Worksheet) => {
        for (const a of ['B13', 'I13']) ws.getCell(a).value = null;
      },
    },
  ];
  let file: Buffer;
  let mappedSupplierId: string;

  beforeAll(async () => {
    file = await buildWorkbook(sheets, ['Rates']);
    mappedSupplierId = (await prisma.supplier.create({ data: { name: 'Mapped Traders', code: 'MAPPED' } })).id;
  });

  it('previews every sheet: template sheets parsed, others listed as not a QC sheet', async () => {
    const p = await previewOk(file);
    expect(p.sheets.map((s) => [s.sheetName, s.isTemplate, s.action])).toEqual([
      ['MH15AB1001', true, 'import'],
      ['No date', true, 'import'],
      ['Shifted', true, 'import'],
      ['Text date', true, 'import'],
      ['Empty', true, 'skip'],
      ['Rates', false, 'skip'],
    ]);
    const byName = Object.fromEntries(p.sheets.map((s) => [s.sheetName, s]));
    expect(byName['MH15AB1001']).toMatchObject({ truckNumber: 'MH 15 AB 1001', grnNumber: 'DPNL/GRN_RM/2627/5001', invoiceNumber: 'INV/1', supplierMatch: { name: 'ABC' } });
    expect(byName['No date']).toMatchObject({ reportDate: null, supplierMatch: null, engineTotals: null });
    expect(byName['No date']!.warnings.join(' ')).toContain('fallback report date');
    expect(byName['No date']!.sheetTotals!.approvedAmount).toBeCloseTo(43791.62, 2);
    expect(byName['Empty']!.errors.join(' ')).toContain('truck number');
    expect(byName['Text date']).toMatchObject({ reportDate: '2025-11-05' });

    // The shifted sheet is still read by its labels, and still agrees with the engine.
    const shifted = byName['Shifted']!;
    expect(shifted).toMatchObject({ reportDate: '2026-08-26', supplierMatch: { name: 'ABC' }, hasMismatch: true, errors: [] });
    expect(shifted.sheetTotals!.standardAmount).toBeCloseTo(51818.86, 2);
    expect(shifted.engineTotals!.approvedAmount).toBeCloseTo(19160.84, 2);
  });

  it('imports sheet by sheet: one bad sheet does not stop the others', async () => {
    const p = await previewOk(file, 'trucks-2026.xlsx');
    const done = await commit(p, { 'No date': { supplierId: mappedSupplierId }, Empty: { action: 'import' } });
    expect(done).toMatchObject({ importedCount: 3, skippedCount: 0, errorCount: 2 });
    expect(resultFor(done, 'No date')).toMatchObject({ outcome: 'failed', reportId: null });
    expect(resultFor(done, 'No date').reason).toContain('no report date');
    expect(resultFor(done, 'Empty').reason).toContain('truck number');

    const shifted = await getReport(resultFor(done, 'Shifted').reportId!);
    expect(shifted).toMatchObject({ checkedByName: 'R. Patil', approvedByName: 'S. Kulkarni', remarks: 'Bales wet on arrival', supplierName: 'ABC', hasMismatch: true });
    expect(shifted.otherDescriptions.find((d) => d.materialCode === 'OTHERS')!.description).toBe('PP caps');
    expect(shifted.readings.find((r) => r.parameterCode === 'ALUMINIUM_PET')).toMatchObject({ perBale: [0.9, 1.4, null], purchaseAdjustment: 1.1 }); // 0.1 above the 1% norm → allowed 1.1
    expect(shifted.output.parameters.find((x) => x.parameterCode === 'NON_PET')!.approvedAmount).toBeCloseTo(663.3333, 4);
    expect(shifted.output.grandTotal.approvedAmount).toBeCloseTo(43791.6215, 4);

    // 05-11-2025 is financial year 25-26; its readings sit in the Jul–Sep row, so the engine (3% norm) disagrees.
    const textDate = await getReport(resultFor(done, 'Text date').reportId!);
    expect(textDate).toMatchObject({ reportNo: 'QC/25-26/0001', reportDate: '2025-11-05', tokenDate: '2025-11-05', hasMismatch: true });
    expect(textDate.output.grandTotal.approvedAmount).toBeCloseTo(43791.6215, 4);

    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: done.batchId } });
    expect(batch).toMatchObject({ fileName: 'trucks-2026.xlsx', sheetCount: 5, importedCount: 3, skippedCount: 0, errorCount: 2, undoneAt: null });
    expect(batch.log).toHaveLength(5);
  });

  it('uses the fallback report date for a sheet without one, and the supplier the admin mapped', async () => {
    const p = await previewOk(file);
    expect(p.sheets.find((s) => s.sheetName === 'Shifted')).toMatchObject({ action: 'skip' }); // now a duplicate
    const done = await commit(p, { 'No date': { supplierId: mappedSupplierId } }, '2026-09-01');
    expect(done).toMatchObject({ importedCount: 1, skippedCount: 4, errorCount: 0 });
    const dto = await getReport(resultFor(done, 'No date').reportId!);
    expect(dto).toMatchObject({ reportDate: '2026-09-01', supplierId: mappedSupplierId, supplierName: 'Mapped Traders', partyNameRaw: 'Mapped Traders Pvt Ltd' });
    expect(await prisma.supplier.count({ where: { name: 'Mapped Traders Pvt Ltd' } })).toBe(0);
  });
});

describe('a sheet whose own totals disagree with the engine', () => {
  it('is flagged with per-row detail, while the stored totals remain the sheet’s', async () => {
    const file = await buildWorkbook([
      {
        name: 'Tampered',
        edit: (ws) => {
          consignment(9)(ws);
          setCached(ws, 'S26', 20000); // approved Moisture: the sheet says 20,000, its formula gives 27,384
          setCached(ws, 'Q49', 50000);
          setCached(ws, 'S49', 40000);
        },
      },
    ]);
    const p = await previewOk(file);
    expect(p.sheets[0]).toMatchObject({ hasMismatch: true, action: 'import', sheetTotals: { standardAmount: 50000, approvedAmount: 40000 } });
    expect(p.sheets[0]!.engineTotals!.approvedAmount).toBeCloseTo(19160.84, 2);

    const done = await commit(p);
    expect(done.results[0]).toMatchObject({ outcome: 'imported', hasMismatch: true });
    const dto = await getReport(done.results[0]!.reportId!);
    expect(dto.hasMismatch).toBe(true);
    expect(dto.recomputedTotal).toBeCloseTo(19160.84, 4);
    expect(dto.output.grandTotal).toMatchObject({ standardAmount: 50000, approvedAmount: 40000 });
    expect(dto.output.parameters.find((x) => x.parameterCode === 'MOISTURE')!.approvedAmount).toBe(20000);

    // The sheet's approved column follows the old rule, so every parameter with an allowance differs too.
    expect(dto.mismatchDetail!.map((r) => r.code)).toEqual(['MOISTURE', 'IRON_PATTI', 'RAFFIA', 'COLOUR_BOTTLE_PET', 'NON_PET', 'ALUMINIUM_PET', 'TOTAL']);
    const moisture = dto.mismatchDetail![0];
    const total = dto.mismatchDetail!.at(-1);
    expect(moisture).toMatchObject({ kind: 'PARAMETER', name: 'Moisture', sheetApprovedAmount: 20000 });
    expect(moisture!.engineApprovedAmount).toBeCloseTo(6161.4, 4);
    expect(moisture!.sheetStandardAmount).toBeCloseTo(moisture!.engineStandardAmount, 4);
    expect(total).toMatchObject({ kind: 'TOTAL', sheetStandardAmount: 50000, sheetApprovedAmount: 40000 });
    expect(total!.engineApprovedAmount).toBeCloseTo(19160.84, 4);

    const list = await request(app).get('/api/reports?source=IMPORTED&q=5009').set(admin.auth);
    expect(list.body.items[0]).toMatchObject({ hasMismatch: true, approvedTotal: 40000 });
  });
});

describe('previous imports and undo', () => {
  it('lists batches newest first and undoes one exactly once', async () => {
    const done = await commit(await previewOk(await buildWorkbook([{ name: 'A', edit: consignment(21) }, { name: 'B', edit: consignment(22) }]), 'to-undo.xlsx'));
    expect(done.importedCount).toBe(2);
    const ids = done.results.map((r) => r.reportId!);

    const list = await request(app).get(`${BASE}/batches`).set(admin.auth);
    expect(list.status).toBe(200);
    const batches: ImportBatchDto[] = list.body;
    expect(batches[0]).toMatchObject({ id: done.batchId, fileName: 'to-undo.xlsx', sheetCount: 2, importedCount: 2, reportCount: 2, canUndo: true, undoneAt: null, uploadedBy: { name: 'ADMIN user' } });
    expect(batches[0]!.results.map((r) => r.outcome)).toEqual(['imported', 'imported']);
    expect(batches.length).toBeGreaterThan(3);

    const before = await prisma.report.count();
    const undo = await request(app).delete(`${BASE}/batches/${done.batchId}`).set(admin.auth);
    expect(undo.status).toBe(200);
    expect(undo.body).toEqual({ batchId: done.batchId, deletedReports: 2 });
    expect(await prisma.report.count()).toBe(before - 2);
    expect(await prisma.report.count({ where: { id: { in: ids } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'IMPORT_UNDO' } })).toBe(1);

    const second = await request(app).delete(`${BASE}/batches/${done.batchId}`).set(admin.auth);
    expect(second.status).toBe(409);
    expect(second.body.message).toContain('already been undone');
    const after: ImportBatchDto[] = (await request(app).get(`${BASE}/batches`).set(admin.auth)).body;
    expect(after.find((b) => b.id === done.batchId)).toMatchObject({ canUndo: false, reportCount: 0 });
    expect(after.find((b) => b.id === done.batchId)!.undoneAt).not.toBeNull();
    expect((await request(app).delete(`${BASE}/batches/nope`).set(admin.auth)).status).toBe(404);
  });

  it('refuses to undo an import older than 24 hours', async () => {
    const done = await commit(await previewOk(await buildWorkbook([{ name: 'Old', edit: consignment(31) }])));
    await prisma.importBatch.update({ where: { id: done.batchId }, data: { uploadedAt: new Date(Date.now() - 25 * 3_600_000) } });
    const res = await request(app).delete(`${BASE}/batches/${done.batchId}`).set(admin.auth);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('24 hours');
    expect(await prisma.report.count({ where: { importBatchId: done.batchId } })).toBe(1);
    const batches: ImportBatchDto[] = (await request(app).get(`${BASE}/batches`).set(admin.auth)).body;
    expect(batches.find((b) => b.id === done.batchId)!.canUndo).toBe(false);
  });
});

describe('a file exported by this app', () => {
  const sample = sampleReportInput();
  const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  };

  /** A report taken through the whole workflow in the app, as export.test.ts does. */
  async function approvedReport(reportDate: string): Promise<ReportDto> {
    const created = await request(app).post('/api/reports').set(gate.auth).send({ reportDate, partyNameRaw: 'ABC', truckNumber: 'MH 04 EX 7777', invoiceNumber: `EXP/${reportDate}` });
    const id: string = created.body.id;
    const desk = (prefix: string) => ({
      materials: sample.materials.map(({ name: _n, ...m }) => Object.fromEntries(Object.entries(m).filter(([k]) => k === 'code' || (prefix === 'invoice' ? k.startsWith('invoice') || k === 'dalmiaRate' : k === 'dalmiaWeightKg' || k === 'dalmiaBales')))),
    });
    await request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(desk('invoice'));
    await request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth);
    await request(app).patch(`/api/reports/${id}/weights`).set(store.auth).send(desk('dalmia'));
    await request(app).post(`/api/reports/${id}/submit-weights`).set(store.auth);
    const readings = sample.readings.map((r) => ({ parameterCode: r.parameterCode, perBale: r.perBale, affectedBales: undefined as number | undefined }));
    const dirty = readings.find((r) => r.parameterCode === 'DIRTY_BOTTLE')!;
    dirty.perBale = [4.95, 4.8, null]; // 5%: over both seasons' norms
    dirty.affectedBales = 10;
    await request(app).patch(`/api/reports/${id}/qc`).set(analyst.auth).send({ baleWeightsKg: sample.baleWeightsKg, readings });
    await request(app).post(`/api/reports/${id}/submit-qc`).set(analyst.auth);
  await request(app).patch(`/api/reports/${id}/grn`).set(stores.auth).send({ grnNumber: `GRN/EXPORT/${reportDate}` });
  await request(app).post(`/api/reports/${id}/submit-grn`).set(stores.auth);
    const adjustments = sample.readings.filter((r) => (r.purchaseAdjustment ?? 0) > 0).map((r) => ({ parameterCode: r.parameterCode, purchaseAdjustment: r.purchaseAdjustment! }));
    await request(app).patch(`/api/reports/${id}/approval`).set(manager.auth).send({ adjustments, remarks: 'Round trip', weightTolerancePercent: 0.5 });
    expect((await request(app).post(`/api/reports/${id}/approve`).set(manager.auth)).status).toBe(200);
    return getReport(id);
  }

  it.each([['2026-08-20'], ['2026-12-03']])('dated %s can be imported back and matches the original', async (reportDate) => {
    const original = await approvedReport(reportDate);
    const exported = await request(app).get(`/api/reports/${original.id}/export.xlsx`).set(admin.auth).buffer(true).parse(binary);
    expect(exported.status).toBe(200);

    const p = await previewOk(exported.body as Buffer, 'exported.xlsx');
    const s = p.sheets[0]!;
    expect(s).toMatchObject({ isTemplate: true, truckNumber: 'MH 04 EX 7777', reportDate, hasMismatch: false, action: 'skip', errors: [] });
    expect(s.duplicates.map((d) => d.reportId)).toEqual([original.id]);
    expect(s.sheetTotals!.approvedAmount).toBeCloseTo(original.output.grandTotal.approvedAmount, 2);
    expect(s.engineTotals!.approvedAmount).toBeCloseTo(original.output.grandTotal.approvedAmount, 2);

    const done = await commit(p, { Format: { action: 'overwrite' } });
    expect(done.results[0]).toMatchObject({ outcome: 'imported', hasMismatch: false, overwritten: [original.reportNo] });
    const back = await getReport(done.results[0]!.reportId!);
    expect(back).toMatchObject({ source: 'IMPORTED', status: 'APPROVED', remarks: 'Round trip', weightTolerancePercent: 0.5, checkedByName: 'QC_ANALYST user', approvedByName: 'QC_MANAGER user' });
    expect(back.materials).toEqual(original.materials);
    expect(back.baleWeightsKg).toEqual(original.baleWeightsKg);
    expect(back.readings).toEqual(original.readings);
    for (const p0 of original.output.parameters) {
      const p1 = back.output.parameters.find((x) => x.parameterCode === p0.parameterCode)!;
      expect(p1.normPercent, p0.name).toBe(p0.normPercent);
      expect(p1.standardAmount, p0.name).toBeCloseTo(p0.standardAmount, 3);
      expect(p1.approvedAmount, p0.name).toBeCloseTo(p0.approvedAmount, 3);
    }
    expect(back.output.shortage.subtotal.approvedAmount).toBeCloseTo(original.output.shortage.subtotal.approvedAmount, 3);
    expect(back.output.grandTotal.standardAmount).toBeCloseTo(original.output.grandTotal.standardAmount, 3);
    expect(back.output.grandTotal.approvedAmount).toBeCloseTo(original.output.grandTotal.approvedAmount, 3);
  });
});
