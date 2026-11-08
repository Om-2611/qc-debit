import { Prisma } from '@prisma/client';
import { round, type EngineOutput } from '@dalmia/calc';
import {
  BALE_COUNT,
  IMPORT_MISMATCH_TOLERANCE,
  IMPORT_UNDO_WINDOW_HOURS,
  type AuthUser,
  type ImportBatchDto,
  type ImportCommitResult,
  type ImportDuplicateDto,
  type ImportPreviewDto,
  type ImportSheetPreview,
  type ImportSheetResult,
  type MismatchRow,
} from '@dalmia/types';
import type { z } from 'zod';
import type { importCommitSchema } from '@dalmia/types';
import { isMonsoon } from '../export/excel';
import { writeAudit } from '../lib/audit';
import { defaultPlantId } from '../lib/plant';
import { HttpError, badRequest, conflict, notFound } from '../lib/errors';
import { prisma } from '../prisma';
import { loadMasters, nextReportNo } from '../reports/report.service';
import { computeOutput, toDate, type Masters, type ReportState } from '../reports/report.state';
import { parseWorkbook, type ParsedParameterRow, type ParsedSheet } from './parse';
import { deletePreview, newPreviewId, readPreview, writePreview } from './preview-store';

type Tx = Prisma.TransactionClient;
type CommitInput = z.infer<typeof importCommitSchema>;

/** Money and quantities are stored at 4 dp, like every other snapshot. */
const dp4 = (v: number | null | undefined): number => round(v ?? 0, 4);

interface MaterialRef {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
}

// ---------------------------------------------------------------- sheet → report inputs + the sheet's own figures

interface ResolvedSheet {
  state: ReportState;
  /** The row each parameter was read from (one of the two for seasonal parameters). */
  rowByCode: Map<string, ParsedParameterRow>;
  engine: EngineOutput;
  sheetTotals: { standardAmount: number; approvedAmount: number };
  hasMismatch: boolean;
  mismatchDetail: MismatchRow[];
  warnings: string[];
}

const hasReadings = (row: ParsedParameterRow | undefined): boolean => !!row && row.perBale.some((v) => v != null);

/** Seasonal parameters have two rows: whichever holds readings wins; the report date only breaks a tie. */
function chooseRows(parsed: ParsedSheet, reportDate: string, names: Map<string, string>): { rowByCode: Map<string, ParsedParameterRow>; warnings: string[] } {
  const rowByCode = new Map<string, ParsedParameterRow>();
  const warnings: string[] = [];
  const inSeason = isMonsoon(reportDate) ? 'MONSOON' : 'OTHER';
  for (const [code, rows] of Object.entries(parsed.parameters)) {
    if (rows.length <= 1) {
      if (rows[0]) rowByCode.set(code, rows[0]);
      continue;
    }
    const name = names.get(code) ?? code;
    const filled = rows.filter(hasReadings);
    const seasonRow = rows.find((r) => r.season === inSeason) ?? rows[0]!;
    if (filled.length > 1) {
      warnings.push(`${name}: both the Jul–Sep row and the rest-of-year row have readings; row ${seasonRow.row} was used because the report is dated ${reportDate}.`);
      rowByCode.set(code, seasonRow);
    } else if (filled.length === 1) {
      const used = filled[0]!;
      if (used.season !== inSeason) {
        warnings.push(`${name}: the readings are in the ${used.season === 'MONSOON' ? 'Jul–Sep' : 'rest-of-year'} row (row ${used.row}) although the report is dated ${reportDate}; the sheet's figures were kept.`);
      }
      rowByCode.set(code, used);
    } else {
      rowByCode.set(code, seasonRow);
    }
  }
  return { rowByCode, warnings };
}

function resolveSheet(parsed: ParsedSheet, reportDate: string, supplierId: string | null, masters: Masters, allMaterials: MaterialRef[]): ResolvedSheet {
  const names = new Map(masters.config.parameters.map((p) => [p.code, p.name]));
  const { rowByCode, warnings } = chooseRows(parsed, reportDate, names);

  for (const code of rowByCode.keys()) {
    if (!names.has(code) && hasReadings(rowByCode.get(code))) warnings.push(`${code} is not a parameter in this app's settings; its readings were not imported.`);
  }

  // Active materials in sheet order, plus any deactivated one the sheet still has weights for.
  const sheetLine = new Map(parsed.materials.map((m) => [m.code, m]));
  const used = (code: string) => Object.entries(sheetLine.get(code) ?? {}).some(([k, v]) => k !== 'code' && typeof v === 'number' && v !== 0);
  const materials = allMaterials.filter((m) => m.isActive || used(m.code));
  const blank = { invoiceWeightKg: null, invoiceBales: null, invoiceRate: null, dalmiaWeightKg: null, dalmiaBales: null, dalmiaRate: null };

  const state: ReportState = {
    header: {
      reportDate,
      supplierId,
      partyNameRaw: parsed.header.partyName,
      poNumber: parsed.header.poNumber,
      truckNumber: parsed.header.truckNumber,
      grnNumber: parsed.header.grnNumber,
      tokenDate: parsed.header.tokenDate,
      tokenNumber: parsed.header.tokenNumber,
      invoiceNumber: parsed.header.invoiceNumber,
      invoiceDate: parsed.header.invoiceDate,
    },
    materials: materials.map((m) => ({ ...blank, ...sheetLine.get(m.code), code: m.code, name: m.name })),
    baleWeightsKg: Array.from({ length: BALE_COUNT }, (_, i) => parsed.baleWeightsKg[i] ?? null),
    readings: masters.config.parameters.map((p) => {
      const row = rowByCode.get(p.code);
      return {
        parameterCode: p.code,
        perBale: Array.from({ length: BALE_COUNT }, (_, i) => row?.perBale[i] ?? null),
        purchaseAdjustment: row?.purchaseAdjustment || null,
        affectedBales: row?.affectedBales ?? null,
      };
    }),
    shortageAdjustments: Object.fromEntries(materials.map((m) => [m.code, parsed.shortage.find((s) => s.materialCode === m.code)?.adjustment || null])),
    otherDescriptions: Object.fromEntries(materials.map((m) => [m.code, m.code === 'OTHERS' ? parsed.otherDescription : null])),
    weightTolerancePercent: parsed.weightTolerancePercent,
    remarks: parsed.remarks,
  };
  const engine = computeOutput(state, masters.config);

  // ---- the sheet's own Total (A+B+C); a file that was never calculated has none, so its rows are added up instead
  const rowSum = (key: 'standardAmount' | 'approvedAmount') =>
    [...rowByCode.values()].reduce((a, r) => a + (r[key] ?? 0), 0) + parsed.shortage.reduce((a, s) => a + (s[key] ?? 0), 0);
  if (parsed.totals.standardAmount == null || parsed.totals.approvedAmount == null) {
    warnings.push('The sheet has no calculated Total (A+B+C) — it may never have been recalculated in Excel. The total of its rows was used.');
  }
  const sheetTotals = {
    standardAmount: parsed.totals.standardAmount ?? rowSum('standardAmount'),
    approvedAmount: parsed.totals.approvedAmount ?? rowSum('approvedAmount'),
  };

  // ---- engine vs. sheet, row by row. The sheet's figures are the ones kept; this only explains a difference.
  const detail: MismatchRow[] = [];
  const differs = (a: number, b: number) => Math.abs(a - b) > 0.005;
  const push = (kind: MismatchRow['kind'], code: string, name: string, sheet: [number, number], eng: [number, number], always = false) => {
    if (!always && !differs(sheet[0], eng[0]) && !differs(sheet[1], eng[1])) return;
    detail.push({
      kind,
      code,
      name,
      sheetStandardAmount: dp4(sheet[0]),
      sheetApprovedAmount: dp4(sheet[1]),
      engineStandardAmount: dp4(eng[0]),
      engineApprovedAmount: dp4(eng[1]),
    });
  };
  for (const p of engine.parameters) {
    const row = rowByCode.get(p.parameterCode);
    push('PARAMETER', p.parameterCode, p.name, [row?.standardAmount ?? 0, row?.approvedAmount ?? 0], [p.standardAmount, p.approvedAmount]);
  }
  for (const l of engine.shortage.lines) {
    const row = parsed.shortage.find((s) => s.materialCode === l.materialCode);
    push('SHORTAGE', l.materialCode, `${l.materialName} Shortage/Excess`, [row?.standardAmount ?? 0, row?.approvedAmount ?? 0], [l.standardAmount, l.approvedAmount]);
  }
  push('TOTAL', 'TOTAL', 'Total (A+B+C)', [sheetTotals.standardAmount, sheetTotals.approvedAmount], [engine.grandTotal.standardAmount, engine.grandTotal.approvedAmount], true);
  // Either total disagreeing is a mismatch: a sheet on the wrong seasonal norm can still land on the same
  // approved figure once purchase has allowed its way past it, while its standard figure is off.
  const hasMismatch =
    Math.abs(sheetTotals.approvedAmount - engine.grandTotal.approvedAmount) > IMPORT_MISMATCH_TOLERANCE ||
    Math.abs(sheetTotals.standardAmount - engine.grandTotal.standardAmount) > IMPORT_MISMATCH_TOLERANCE;

  return { state, rowByCode, engine, sheetTotals, hasMismatch, mismatchDetail: hasMismatch ? detail : [], warnings };
}

/** Problems that stop a sheet from being imported at all. The report date is checked separately (a fallback may supply it). */
function sheetErrors(parsed: ParsedSheet): string[] {
  const errors: string[] = [];
  if (!parsed.header.truckNumber && !parsed.header.grnNumber) errors.push('Neither a truck number nor a GRN number was found.');
  if (!parsed.materials.some((m) => (m.invoiceWeightKg ?? 0) > 0 || (m.dalmiaWeightKg ?? 0) > 0)) errors.push('No weight was found in the “As per Supplier Invoice” or “As per Dalmia” rows.');
  return errors;
}

// ---------------------------------------------------------------- suppliers and duplicates

const sameText = (value: string): Prisma.StringFilter => ({ equals: value, mode: 'insensitive' });

async function matchSupplier(client: Tx, partyName: string | null): Promise<{ id: string; name: string } | null> {
  if (!partyName) return null;
  return client.supplier.findFirst({
    where: { OR: [{ name: sameText(partyName) }, { code: sameText(partyName) }] },
    select: { id: true, name: true },
  });
}

/** "Shree Ganesh Traders Pvt. Ltd." → SHREEGANESHT, then SHREEGANESHT-2 … until it is free. */
async function freeSupplierCode(client: Tx, name: string): Promise<string> {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'SUPPLIER';
  for (let n = 1; ; n++) {
    const code = n === 1 ? base : `${base}-${n}`;
    if (!(await client.supplier.findFirst({ where: { code: sameText(code) }, select: { id: true } }))) return code;
  }
}

async function findDuplicates(client: Tx, header: ParsedSheet['header']): Promise<ImportDuplicateDto[]> {
  const or: Prisma.ReportWhereInput[] = [];
  if (header.grnNumber) or.push({ grnNumber: sameText(header.grnNumber) });
  if (header.truckNumber && header.invoiceNumber) or.push({ truckNumber: sameText(header.truckNumber), invoiceNumber: sameText(header.invoiceNumber) });
  if (or.length === 0) return [];
  const rows = await client.report.findMany({
    where: { OR: or },
    select: { id: true, reportNo: true, status: true, grnNumber: true },
    orderBy: { createdAt: 'asc' },
  });
  const grn = header.grnNumber?.toLowerCase();
  return rows.map((r) => ({
    reportId: r.id,
    reportNo: r.reportNo,
    status: r.status,
    matchedOn: grn && r.grnNumber?.toLowerCase() === grn ? 'GRN' : 'TRUCK_INVOICE',
  }));
}

const allMaterials = (client: Tx = prisma): Promise<MaterialRef[]> =>
  client.material.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true, isActive: true } });

// ---------------------------------------------------------------- preview

interface StoredPreview {
  previewId: string;
  fileName: string;
  uploadedById: string;
  createdAt: string;
  sheets: ParsedSheet[];
}

export async function createPreview(user: AuthUser, fileName: string, buffer: Buffer): Promise<ImportPreviewDto> {
  let sheets: ParsedSheet[];
  try {
    sheets = await parseWorkbook(buffer);
  } catch {
    throw badRequest('The file could not be read as an Excel workbook (.xlsx).');
  }
  if (sheets.length === 0) throw badRequest('The workbook has no sheets.');

  const [masters, materials] = await Promise.all([loadMasters(), allMaterials()]);
  const seen = new Map<string, string>();
  const previews: ImportSheetPreview[] = [];
  for (const parsed of sheets) {
    const h = parsed.header;
    const preview: ImportSheetPreview = {
      sheetName: parsed.sheetName,
      isTemplate: parsed.isTemplate,
      truckNumber: h.truckNumber,
      grnNumber: h.grnNumber,
      invoiceNumber: h.invoiceNumber,
      reportDate: h.reportDate,
      partyName: h.partyName,
      supplierMatch: null,
      sheetTotals: null,
      engineTotals: null,
      hasMismatch: false,
      warnings: [...parsed.warnings],
      errors: [],
      duplicates: [],
      action: 'skip',
    };
    previews.push(preview);
    if (!parsed.isTemplate) continue;

    preview.errors = sheetErrors(parsed);
    preview.supplierMatch = await matchSupplier(prisma, h.partyName);
    preview.duplicates = await findDuplicates(prisma, h);
    if (!h.partyName) preview.warnings.push('No party name: the report will have no supplier.');

    // The same consignment twice in one file: only the first can be imported.
    for (const key of [h.grnNumber && `grn:${h.grnNumber}`, h.truckNumber && h.invoiceNumber && `truck:${h.truckNumber}|${h.invoiceNumber}`]) {
      if (!key) continue;
      const first = seen.get(key.toLowerCase());
      if (first && !preview.warnings.some((w) => w.includes(`“${first}”`))) preview.warnings.push(`Same GRN or truck + invoice number as sheet “${first}” in this file; only the first of them will be imported.`);
      if (!first) seen.set(key.toLowerCase(), parsed.sheetName);
    }

    if (h.reportDate) {
      const resolved = resolveSheet(parsed, h.reportDate, null, masters, materials);
      preview.warnings.push(...resolved.warnings);
      preview.sheetTotals = resolved.sheetTotals;
      preview.engineTotals = { standardAmount: resolved.engine.grandTotal.standardAmount, approvedAmount: resolved.engine.grandTotal.approvedAmount };
      preview.hasMismatch = resolved.hasMismatch;
    } else {
      preview.warnings.push('No report date on the sheet: the fallback report date will be used.');
      if (parsed.totals.standardAmount != null && parsed.totals.approvedAmount != null) {
        preview.sheetTotals = { standardAmount: parsed.totals.standardAmount, approvedAmount: parsed.totals.approvedAmount };
      }
    }
    preview.action = preview.errors.length || preview.duplicates.length ? 'skip' : 'import';
  }

  const stored: StoredPreview = { previewId: newPreviewId(), fileName, uploadedById: user.id, createdAt: new Date().toISOString(), sheets };
  await writePreview(stored.previewId, stored);
  return { previewId: stored.previewId, fileName, sheets: previews };
}

// ---------------------------------------------------------------- commit

class SheetSkipped extends Error {}

const isUniqueClash = (err: unknown): boolean => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/** One sheet, one transaction: a sheet that fails leaves nothing behind and does not stop the others. */
async function importSheet(
  tx: Tx,
  ctx: { user: AuthUser; batchId: string; masters: Masters; materials: MaterialRef[]; fallbackReportDate: string | null },
  parsed: ParsedSheet,
  choice: CommitInput['sheets'][number],
): Promise<ImportSheetResult> {
  const { user, batchId, masters, materials } = ctx;
  const errors = sheetErrors(parsed);
  const reportDate = parsed.header.reportDate ?? ctx.fallbackReportDate;
  if (!reportDate) errors.push('The sheet has no report date and no fallback report date was given.');
  if (errors.length) throw badRequest(errors.join(' '));

  // ---- duplicates: skipped unless the admin chose to overwrite; never another sheet of this same upload
  const overwritten: string[] = [];
  const duplicates = await findDuplicates(tx, parsed.header);
  if (duplicates.length) {
    const sameBatch = await tx.report.findMany({ where: { id: { in: duplicates.map((d) => d.reportId) }, importBatchId: batchId }, select: { importSheetName: true } });
    if (sameBatch.length) throw new SheetSkipped(`Same consignment as sheet “${sameBatch[0]!.importSheetName}” of this file, which was imported first.`);
    if (choice.action !== 'overwrite') throw new SheetSkipped(`Already exists as ${duplicates.map((d) => d.reportNo).join(', ')}. Choose “Overwrite” to replace it.`);
    await tx.report.deleteMany({ where: { id: { in: duplicates.map((d) => d.reportId) } } });
    overwritten.push(...duplicates.map((d) => d.reportNo));
  }

  // ---- supplier: the admin's mapping, else a match by name or code, else a new supplier
  let supplierId: string | null = null;
  if (choice.supplierId) {
    const mapped = await tx.supplier.findUnique({ where: { id: choice.supplierId }, select: { id: true } });
    if (!mapped) throw badRequest('The supplier chosen for this sheet no longer exists.');
    supplierId = mapped.id;
  } else if (parsed.header.partyName) {
    const match = await matchSupplier(tx, parsed.header.partyName);
    if (match) supplierId = match.id;
    else {
      const created = await tx.supplier.create({ data: { name: parsed.header.partyName, code: await freeSupplierCode(tx, parsed.header.partyName) } });
      await writeAudit({ userId: user.id, action: 'SUPPLIER_CREATE', field: created.code, newValue: `${created.name} (Excel import)` }, tx);
      supplierId = created.id;
    }
  }

  const resolved = resolveSheet(parsed, reportDate!, supplierId, masters, materials);
  const { state, rowByCode, engine } = resolved;
  const materialId = new Map(materials.map((m) => [m.code, m.id]));
  const parameterId = new Map(masters.parameters.map((p) => [p.code, p.id]));

  // ---- the snapshot is the SHEET's own figures (columns P–U, shortage O–S), not the engine's
  const deductions: Prisma.DeductionCreateManyReportInput[] = engine.parameters.flatMap((p) => {
    const id = parameterId.get(p.parameterCode);
    const row = rowByCode.get(p.parameterCode);
    if (!id || !row) return [];
    const standardQty = dp4(row.standardQty);
    const standardAmount = dp4(row.standardAmount);
    const approvedQty = dp4(row.approvedQty);
    const approvedAmount = dp4(row.approvedAmount);
    return [
      {
        parameterId: id,
        normPercent: dp4(row.normPercent ?? p.normPercent),
        totalKg: p.totalKg === null ? null : dp4(row.totalKg ?? p.totalKg),
        actualPercent: dp4(row.actualPercent ?? p.actualPercent),
        purchaseAdjustment: dp4(row.purchaseAdjustment),
        affectedBales: row.affectedBales,
        rate: dp4(row.rate ?? p.rate),
        weightBase: p.weightBase,
        isDeductible: p.isDeductible,
        standardQty,
        standardAmount,
        approvedQty,
        approvedAmount,
        differenceQty: row.differenceQty == null ? dp4(approvedQty - standardQty) : dp4(row.differenceQty),
        differenceAmount: row.differenceAmount == null ? dp4(approvedAmount - standardAmount) : dp4(row.differenceAmount),
      },
    ];
  });
  const shortageLines: Prisma.ShortageLineCreateManyReportInput[] = state.materials.flatMap((m) => {
    const id = materialId.get(m.code);
    const row = parsed.shortage.find((s) => s.materialCode === m.code);
    if (!id) return [];
    return [
      {
        materialId: id,
        shortageQty: dp4(row?.shortageQty),
        rate: dp4(row?.rate),
        standardAmount: dp4(row?.standardAmount),
        approvedQty: dp4(row?.approvedQty),
        approvedAmount: dp4(row?.approvedAmount),
        adjustment: row?.adjustment ? dp4(row.adjustment) : null,
        otherDescription: state.otherDescriptions[m.code]?.trim() || null,
      },
    ];
  });

  const created = await tx.report.create({
    data: {
      reportNo: await nextReportNo(tx, reportDate!),
      status: 'APPROVED',
      source: 'IMPORTED',
      reportDate: toDate(reportDate)!,
      supplierId,
      plantId: await defaultPlantId(tx),
      partyNameRaw: state.header.partyNameRaw,
      poNumber: state.header.poNumber,
      truckNumber: state.header.truckNumber,
      grnNumber: state.header.grnNumber,
      tokenDate: toDate(state.header.tokenDate),
      tokenNumber: state.header.tokenNumber,
      invoiceNumber: state.header.invoiceNumber,
      invoiceDate: toDate(state.header.invoiceDate),
      weightTolerancePercent: state.weightTolerancePercent,
      remarks: state.remarks,
      checkedByName: parsed.checkedByName,
      approvedByName: parsed.approvedByName,
      approvedAt: new Date(),
      standardTotal: dp4(resolved.sheetTotals.standardAmount),
      approvedTotal: dp4(resolved.sheetTotals.approvedAmount),
      importBatchId: batchId,
      importSheetName: parsed.sheetName,
      recomputedTotal: dp4(engine.grandTotal.approvedAmount),
      hasMismatch: resolved.hasMismatch,
      mismatchDetail: resolved.hasMismatch ? (resolved.mismatchDetail as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      createdById: user.id,
      materialLines: {
        createMany: {
          data: state.materials.flatMap(({ code, name: _n, ...fields }) => {
            const id = materialId.get(code);
            return id ? [{ materialId: id, ...fields }] : [];
          }),
        },
      },
      bales: { createMany: { data: state.baleWeightsKg.map((w, i) => ({ baleIndex: i + 1, baleWeightKg: w })) } },
      readings: {
        createMany: {
          data: state.readings.flatMap((r) => {
            const id = parameterId.get(r.parameterCode);
            return id ? r.perBale.map((value, i) => ({ parameterId: id, baleIndex: i + 1, value })) : [];
          }),
        },
      },
      deductions: { createMany: { data: deductions } },
      shortageLines: { createMany: { data: shortageLines } },
    },
    select: { id: true, reportNo: true },
  });

  await writeAudit(
    [
      ...overwritten.map((reportNo) => ({ userId: user.id, action: 'IMPORT_OVERWRITE', field: reportNo, oldValue: reportNo, newValue: created.reportNo })),
      { userId: user.id, reportId: created.id, action: 'REPORT_IMPORT', field: parsed.sheetName, newValue: created.reportNo },
    ],
    tx,
  );
  return { sheetName: parsed.sheetName, outcome: 'imported', reason: null, reportId: created.id, reportNo: created.reportNo, hasMismatch: resolved.hasMismatch, overwritten };
}

export async function commitImport(user: AuthUser, input: CommitInput): Promise<ImportCommitResult> {
  const stored = await readPreview<StoredPreview>(input.previewId);
  if (!stored) throw notFound('This import preview has expired or was already committed. Upload the file again.');

  const [masters, materials] = await Promise.all([loadMasters(), allMaterials()]);
  const templateSheets = stored.sheets.filter((s) => s.isTemplate);
  const batch = await prisma.importBatch.create({ data: { fileName: stored.fileName, uploadedById: user.id, sheetCount: templateSheets.length } });
  const ctx = { user, batchId: batch.id, masters, materials, fallbackReportDate: input.fallbackReportDate ?? null };

  const choiceByName = new Map(input.sheets.map((s) => [s.sheetName, s]));
  const results: ImportSheetResult[] = [];
  const none = { reportId: null, reportNo: null, hasMismatch: false, overwritten: [] };
  // Sheets are taken in workbook order, one at a time, so report numbers follow the tabs.
  for (const parsed of templateSheets) {
    const choice = choiceByName.get(parsed.sheetName);
    if (!choice || choice.action === 'skip') {
      results.push({ sheetName: parsed.sheetName, outcome: 'skipped', reason: 'Not selected for import.', ...none });
      continue;
    }
    for (let attempt = 0; ; attempt++) {
      try {
        results.push(await prisma.$transaction((tx) => importSheet(tx, ctx, parsed, choice), { timeout: 20_000 }));
        break;
      } catch (err) {
        // Someone creating a report at the same moment can take the same number; the unique index rejects one and it retries.
        if (isUniqueClash(err) && attempt < 4) continue;
        if (err instanceof SheetSkipped) results.push({ sheetName: parsed.sheetName, outcome: 'skipped', reason: err.message, ...none });
        else {
          const reason = err instanceof HttpError ? err.message : `Could not be saved: ${err instanceof Error ? err.message.split('\n').pop() : String(err)}`;
          results.push({ sheetName: parsed.sheetName, outcome: 'failed', reason, ...none });
        }
        break;
      }
    }
  }

  const count = (outcome: ImportSheetResult['outcome']) => results.filter((r) => r.outcome === outcome).length;
  const summary = { importedCount: count('imported'), skippedCount: count('skipped'), errorCount: count('failed') };
  await prisma.importBatch.update({ where: { id: batch.id }, data: { ...summary, log: results as unknown as Prisma.InputJsonValue } });
  await writeAudit({ userId: user.id, action: 'IMPORT_COMMIT', field: stored.fileName, newValue: { batchId: batch.id, ...summary } });
  await deletePreview(input.previewId);
  return { batchId: batch.id, fileName: stored.fileName, ...summary, results };
}

// ---------------------------------------------------------------- batches and undo

const undoDeadline = (uploadedAt: Date): Date => new Date(uploadedAt.getTime() + IMPORT_UNDO_WINDOW_HOURS * 3_600_000);

export async function listBatches(): Promise<ImportBatchDto[]> {
  const rows = await prisma.importBatch.findMany({
    orderBy: { uploadedAt: 'desc' },
    take: 200,
    include: { uploadedBy: { select: { id: true, name: true } }, _count: { select: { reports: true } } },
  });
  const now = Date.now();
  return rows.map((b) => ({
    id: b.id,
    fileName: b.fileName,
    uploadedAt: b.uploadedAt.toISOString(),
    uploadedBy: b.uploadedBy,
    sheetCount: b.sheetCount,
    importedCount: b.importedCount,
    skippedCount: b.skippedCount,
    errorCount: b.errorCount,
    reportCount: b._count.reports,
    undoneAt: b.undoneAt?.toISOString() ?? null,
    canUndo: !b.undoneAt && b._count.reports > 0 && now <= undoDeadline(b.uploadedAt).getTime(),
    undoUntil: undoDeadline(b.uploadedAt).toISOString(),
    results: Array.isArray(b.log) ? (b.log as unknown as ImportSheetResult[]) : [],
  }));
}

/** "Undo this import": removes every report the batch created. Allowed once, within 24 hours of the upload. */
export async function undoBatch(user: AuthUser, batchId: string): Promise<{ batchId: string; deletedReports: number }> {
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw notFound('Import not found');
    if (batch.undoneAt) throw conflict('This import has already been undone.');
    if (Date.now() > undoDeadline(batch.uploadedAt).getTime()) {
      throw badRequest(`An import can only be undone within ${IMPORT_UNDO_WINDOW_HOURS} hours of the upload.`);
    }
    // A report that has a live debit note in iON must not disappear from under it.
    const loaded = await tx.ionPush.findMany({
      where: { report: { importBatchId: batchId }, resetAt: null, runMode: { not: 'DRY_RUN' } },
      select: { ionDnNo: true, status: true, report: { select: { reportNo: true } } },
      orderBy: { report: { reportNo: 'asc' } },
    });
    if (loaded.length > 0) {
      const list = loaded.map((p) => `${p.report.reportNo} (${p.ionDnNo ? `iON ${p.ionDnNo}` : `iON push ${p.status.toLowerCase().replace(/_/g, ' ')}, no DN number`})`).join(', ');
      throw conflict(`This import cannot be undone: ${loaded.length === 1 ? 'a report has' : 'these reports have'} been loaded on TCS iON: ${list}. Reset the iON push of each first (and cancel the debit note in iON).`);
    }
    // Guard on undoneAt, so two simultaneous undos cannot both succeed.
    const marked = await tx.importBatch.updateMany({ where: { id: batchId, undoneAt: null }, data: { undoneAt: new Date() } });
    if (marked.count !== 1) throw conflict('This import has already been undone.');
    const reports = await tx.report.findMany({ where: { importBatchId: batchId }, select: { reportNo: true } });
    // Reset and dry-run pushes saved nothing live; they only reference the reports, so they go with them.
    await tx.ionPush.deleteMany({ where: { report: { importBatchId: batchId } } });
    const deleted = await tx.report.deleteMany({ where: { importBatchId: batchId } });
    await writeAudit({ userId: user.id, action: 'IMPORT_UNDO', field: batch.fileName, oldValue: reports.map((r) => r.reportNo), newValue: { batchId, deletedReports: deleted.count } }, tx);
    return { batchId, deletedReports: deleted.count };
  });
}
