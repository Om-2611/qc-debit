import { Prisma } from '@prisma/client';
import { buildTallyNarration, round, toYMD, usesAffectedBales, type EngineOutput } from '@dalmia/calc';
import {
  ACTION_TARGET,
  HANDOFF_ACTIONS,
  canEditSection,
  canPerformAction,
  type AuthUser,
  type MismatchRow,
  type ReportAction,
  type ReportDto,
  type ReportSection,
} from '@dalmia/types';
import { SETTING_KEYS, loadEngineConfig } from '../config/engine-config';
import { writeAudit, type AuditEntry } from '../lib/audit';
import { notifyHandoff, sendPending, type PendingPush } from '../notifications/notification.service';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { prisma } from '../prisma';
import {
  computeOutput,
  diffStates,
  extractState,
  overlaySnapshot,
  reportInclude,
  toDate,
  type FullReport,
  type Masters,
  type ReportState,
} from './report.state';
import { buildSnapshot } from './snapshot';

type Tx = Prisma.TransactionClient;

export async function loadMasters(client: Tx = prisma): Promise<Masters> {
  const [materials, parameters, config] = await Promise.all([
    client.material.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
    client.parameter.findMany({ select: { id: true, code: true } }),
    loadEngineConfig(client),
  ]);
  return { materials, parameters, config };
}

async function findReport(id: string, client: Tx): Promise<FullReport> {
  const report = await client.report.findUnique({ where: { id }, include: reportInclude });
  if (!report) throw notFound('Report not found');
  return report;
}

// ---------------------------------------------------------------- DTO

export function toDto(report: FullReport, masters: Masters): ReportDto {
  const state = extractState(report, masters);
  const live = computeOutput(state, masters.config);
  const frozen = report.status === 'APPROVED';
  return {
    id: report.id,
    reportNo: report.reportNo,
    status: report.status,
    source: report.source,
    ...state.header,
    supplierName: report.supplier?.name ?? null,
    weightTolerancePercent: state.weightTolerancePercent,
    remarks: state.remarks,
    sentBackNote: report.sentBackNote,
    reopenReason: report.reopenReason,
    createdBy: report.createdBy,
    checkedBy: report.checkedBy,
    approvedBy: report.approvedBy,
    checkedByName: report.checkedByName,
    approvedByName: report.approvedByName,
    approvedAt: report.approvedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    narration: report.narration,
    hasMismatch: report.hasMismatch,
    mismatchDetail: Array.isArray(report.mismatchDetail) ? (report.mismatchDetail as unknown as MismatchRow[]) : null,
    recomputedTotal: report.recomputedTotal?.toNumber() ?? null,
    materials: state.materials,
    baleWeightsKg: state.baleWeightsKg,
    readings: state.readings,
    shortageAdjustments: Object.entries(state.shortageAdjustments).map(([materialCode, adjustmentQty]) => ({
      materialCode,
      adjustmentQty,
    })),
    otherDescriptions: Object.entries(state.otherDescriptions).map(([materialCode, description]) => ({
      materialCode,
      description,
    })),
    output: frozen ? overlaySnapshot(live, report) : live,
    outputIsSnapshot: frozen,
  };
}

export async function getReport(id: string): Promise<ReportDto> {
  const [report, masters] = await Promise.all([findReport(id, prisma), loadMasters()]);
  return toDto(report, masters);
}

// ---------------------------------------------------------------- persistence

/** Rewrites the report's child rows from `state` and refreshes the stored snapshot and totals. */
async function persistState(tx: Tx, reportId: string, state: ReportState, masters: Masters, extra: Prisma.ReportUncheckedUpdateInput = {}) {
  const output = computeOutput(state, masters.config);
  const materialIdByCode = new Map(masters.materials.map((m) => [m.code, m.id]));
  const parameterIdByCode = new Map(masters.parameters.map((p) => [p.code, p.id]));
  // Materials deactivated after the report started still need their ids.
  const missing = state.materials.filter((m) => !materialIdByCode.has(m.code)).map((m) => m.code);
  if (missing.length) {
    for (const m of await tx.material.findMany({ where: { code: { in: missing } } })) materialIdByCode.set(m.code, m.id);
  }
  const snapshot = buildSnapshot(output, { materialIdByCode, parameterIdByCode }, {
    otherDescriptions: state.otherDescriptions,
    affectedBales: Object.fromEntries(state.readings.map((r) => [r.parameterCode, r.affectedBales])),
  });

  await tx.reportMaterialLine.deleteMany({ where: { reportId } });
  await tx.reportBale.deleteMany({ where: { reportId } });
  await tx.qcReading.deleteMany({ where: { reportId } });
  await tx.deduction.deleteMany({ where: { reportId } });
  await tx.shortageLine.deleteMany({ where: { reportId } });

  await tx.report.update({
    where: { id: reportId },
    data: {
      reportDate: toDate(state.header.reportDate)!,
      supplierId: state.header.supplierId,
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
      standardTotal: snapshot.standardTotal,
      approvedTotal: snapshot.approvedTotal,
      ...extra,
      materialLines: {
        createMany: {
          data: state.materials.flatMap(({ code, name: _n, ...fields }) => {
            const materialId = materialIdByCode.get(code);
            return materialId ? [{ materialId, ...fields }] : [];
          }),
        },
      },
      bales: { createMany: { data: state.baleWeightsKg.map((w, i) => ({ baleIndex: i + 1, baleWeightKg: w })) } },
      readings: {
        createMany: {
          data: state.readings.flatMap((r) => {
            const parameterId = parameterIdByCode.get(r.parameterCode);
            return parameterId ? r.perBale.map((value, i) => ({ parameterId, baleIndex: i + 1, value })) : [];
          }),
        },
      },
      deductions: { createMany: { data: snapshot.deductions } },
      shortageLines: { createMany: { data: snapshot.shortageLines } },
    },
  });
  return output;
}

// ---------------------------------------------------------------- create

const pad = (n: number) => String(n).padStart(4, '0');

/** QC/26-27/0001 — numbered within the Indian financial year (Apr–Mar) of the report date. */
export async function nextReportNo(tx: Tx, reportDate: string): Promise<string> {
  const { year, month } = toYMD(reportDate);
  const start = month >= 4 ? year : year - 1;
  const prefix = `QC/${String(start).slice(2)}-${String(start + 1).slice(2)}/`;
  const last = await tx.report.findFirst({
    where: { reportNo: { startsWith: prefix } },
    orderBy: { reportNo: 'desc' },
    select: { reportNo: true },
  });
  const seq = last ? Number(last.reportNo.slice(prefix.length)) || 0 : 0;
  return prefix + pad(seq + 1);
}

async function assertSupplier(tx: Tx, supplierId: string | null | undefined): Promise<string | null> {
  if (!supplierId) return null;
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier) throw badRequest('Unknown supplier');
  return supplier.name;
}

export type HeaderValues = Partial<ReportState['header']> & { reportDate: string };

export async function createReport(user: AuthUser, header: HeaderValues): Promise<ReportDto> {
  // Two people creating at the same moment can pick the same number; the unique index rejects one and it retries.
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const masters = await loadMasters(tx);
        const supplierName = await assertSupplier(tx, header.supplierId);
        const tolerance = await tx.setting.findUnique({ where: { key: SETTING_KEYS.defaultWeightTolerancePercent } });
        const created = await tx.report.create({
          data: {
            reportNo: await nextReportNo(tx, header.reportDate),
            reportDate: toDate(header.reportDate)!,
            createdById: user.id,
            weightTolerancePercent: tolerance && Number.isFinite(Number(tolerance.value)) ? Number(tolerance.value) : null,
          },
          include: reportInclude,
        });
        const state = extractState(created, masters);
        state.header = { ...state.header, ...header, partyNameRaw: header.partyNameRaw ?? supplierName };
        await persistState(tx, created.id, state, masters);
        await writeAudit({ userId: user.id, reportId: created.id, action: 'REPORT_CREATE', newValue: created.reportNo }, tx);
        return toDto(await findReport(created.id, tx), masters);
      });
    } catch (err) {
      const duplicateNo = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!duplicateNo || attempt >= 4) throw err;
    }
  }
}

// ---------------------------------------------------------------- section edits

export async function updateSection(
  id: string,
  user: AuthUser,
  sections: ReportSection | ReportSection[],
  expectedUpdatedAt: string | undefined,
  apply: (state: ReportState, masters: Masters) => void,
): Promise<ReportDto> {
  return prisma.$transaction(async (tx) => {
    const [report, masters] = await Promise.all([findReport(id, tx), loadMasters(tx)]);

    const touched = Array.isArray(sections) ? sections : [sections];
    for (const section of touched) {
      const permission = canEditSection(user.role, report.status, section);
      if (!permission.allowed) throw forbidden(permission.reason!);
    }
    if (expectedUpdatedAt && new Date(expectedUpdatedAt).getTime() !== report.updatedAt.getTime()) {
      throw conflict('Someone else saved this report after you opened it. Reload to see their changes, then re-apply yours.');
    }

    const before = extractState(report, masters);
    const after = structuredClone(before);
    apply(after, masters);

    if (after.header.supplierId !== before.header.supplierId) {
      const supplierName = await assertSupplier(tx, after.header.supplierId);
      if (supplierName && !after.header.partyNameRaw) after.header.partyNameRaw = supplierName;
    }

    if (touched.includes('approval')) {
      const problems = adjustmentProblems(computeOutput(after, masters.config));
      if (problems.length) throw new HttpError(400, 'INVALID_ADJUSTMENT', 'A purchase-allowed figure is too large.', problems);
    }

    const changes = diffStates(before, after);
    await persistState(tx, id, after, masters);
    await writeAudit(
      changes.map((c): AuditEntry => ({ userId: user.id, reportId: id, action: 'FIELD_CHANGE', ...c })),
      tx,
    );
    return toDto(await findReport(id, tx), masters);
  });
}

// ---------------------------------------------------------------- workflow actions

/** Gate: consignment details and the "As per Supplier Invoice" rows. */
function invoiceProblems(state: ReportState): string[] {
  const problems: string[] = [];
  if (!state.header.supplierId && !state.header.partyNameRaw) problems.push('Party name is required.');
  if (!state.header.truckNumber) problems.push('Enter the truck number.');
  if (!state.materials.some((m) => (m.invoiceWeightKg ?? 0) > 0)) problems.push('Enter at least one supplier invoice weight.');
  for (const m of state.materials) {
    if ((m.invoiceWeightKg ?? 0) > 0 && !((m.dalmiaRate ?? 0) > 0)) problems.push(`${m.name}: enter the Dalmia rate (from the PO).`);
  }
  return problems;
}

/** Raw Material Store: the "As per Dalmia" rows. */
function weightProblems(state: ReportState): string[] {
  const problems: string[] = [];
  const used = state.materials.filter((m) => (m.invoiceWeightKg ?? 0) > 0 || (m.dalmiaWeightKg ?? 0) > 0);
  if (!state.materials.some((m) => (m.dalmiaWeightKg ?? 0) > 0)) problems.push('Enter at least one Dalmia weight.');
  for (const m of used) {
    if (!((m.dalmiaRate ?? 0) > 0)) problems.push(`${m.name}: has a weight but no Dalmia rate — ask the gate to enter it.`);
  }
  return problems;
}

/**
 * "Purchase allowed" is the total % purchase accepts, so it must lie between the norm (D) and the actual % (L).
 * Below the norm would read as a stricter norm (almost certainly a typo for the old "points above norm"
 * convention); above the actual % would approve more than was found.
 */
function adjustmentProblems(output: EngineOutput): string[] {
  const problems: string[] = [];
  for (const p of output.parameters) {
    const allowed = p.purchaseAdjustment;
    if (!(allowed > 0)) continue;
    const ceiling = Math.max(p.actualPercent, p.normPercent);
    const actual = round(p.actualPercent, 4);
    if (allowed < p.normPercent - 1e-9) {
      problems.push(`${p.name}: purchase allowed (${allowed}%) is below the norm (${p.normPercent}%). Enter the total % accepted, between ${p.normPercent} and ${round(ceiling, 4)}.`);
    } else if (allowed > ceiling + 1e-9) {
      problems.push(
        p.actualPercent > p.normPercent
          ? `${p.name}: purchase allowed (${allowed}%) is above the actual % (${actual}%). Enter a value between ${p.normPercent} and ${actual}.`
          : `${p.name}: purchase allowed (${allowed}%) is above the norm (${p.normPercent}%), but the actual % (${actual}%) is within the norm. Leave it blank.`,
      );
    }
  }
  return problems;
}

function qcProblems(state: ReportState, masters: Masters): string[] {
  // Moisture is read as a %, so only kg readings need a bale weight to divide by.
  const kgCodes = new Set(masters.config.parameters.filter((p) => p.inputMode === 'KG_PER_BALE').map((p) => p.code));
  const problems: string[] = [];
  if (!state.baleWeightsKg.some((w) => (w ?? 0) > 0)) problems.push('Enter at least one sample bale weight.');
  state.baleWeightsKg.forEach((w, i) => {
    const hasKgReading = state.readings.some((r) => kgCodes.has(r.parameterCode) && (r.perBale[i] ?? 0) > 0);
    if (hasKgReading && !((w ?? 0) > 0)) problems.push(`Bale ${i + 1} has readings but no bale weight.`);
  });
  // Sheet column M: these parameters are charged per affected bale, so an over-norm result needs the count.
  const output = computeOutput(state, masters.config);
  for (const p of output.parameters) {
    if (p.isDeductible && p.overNorm && usesAffectedBales(p.weightBase) && p.affectedBales == null) {
      problems.push(`${p.name} is above norm: enter the number of bales affected.`);
    }
  }
  if (output.parameters.some((p) => p.weightBase === 'AFFECTED_BALES_TRUCK_AVG' && (p.affectedBales ?? 0) > 0) && output.weights.totalDalmiaBales === 0) {
    problems.push('The Dalmia number of bales is needed to work out the average bale weight. Ask the gate to enter it.');
  }
  return problems;
}

/** Stores: the GRN, needed before the Purchase Manager sees the report (the Tally narration ends with it). */
function grnProblems(state: ReportState): string[] {
  return state.header.grnNumber ? [] : ['Enter the GRN number.'];
}

function approvalProblems(state: ReportState): string[] {
  const problems: string[] = [];
  const others = state.materials.find((m) => m.code === 'OTHERS');
  const othersUsed = others && ((others.invoiceWeightKg ?? 0) > 0 || (others.dalmiaWeightKg ?? 0) > 0);
  if (othersUsed && !state.otherDescriptions.OTHERS) {
    problems.push('“Other (Please Specify)” has a weight, so its description is required.');
  }
  return problems;
}

const invalid = (problems: string[]) =>
  new HttpError(400, 'INCOMPLETE', 'The report is not ready for this step.', problems);

export async function performAction(
  id: string,
  user: AuthUser,
  action: ReportAction,
  note?: string,
): Promise<ReportDto> {
  let pending: PendingPush | null = null;
  const dto = await prisma.$transaction(async (tx) => {
    const [report, masters] = await Promise.all([findReport(id, tx), loadMasters(tx)]);
    const permission = canPerformAction(user.role, report.status, action);
    if (!permission.allowed) throw forbidden(permission.reason!);
    // An imported report keeps the sheet's own figures; reopening and saving would replace them with a fresh calculation.
    if (action === 'reopen' && report.source === 'IMPORTED') {
      throw badRequest(
        'This report was imported from Excel and keeps the sheet’s own figures, so it cannot be reopened. Undo the import (Import → Previous imports) or correct the workbook and import it again with “Overwrite”.',
      );
    }

    const state = extractState(report, masters);
    const problems =
      action === 'submitInvoice'
        ? invoiceProblems(state)
        : action === 'submitWeights'
          ? [...invoiceProblems(state), ...weightProblems(state)]
          : action === 'submitQc'
            ? [...invoiceProblems(state), ...weightProblems(state), ...qcProblems(state, masters)]
            : action === 'submitGrn'
              ? [...invoiceProblems(state), ...weightProblems(state), ...qcProblems(state, masters), ...grnProblems(state)]
              : action === 'approve'
                ? [...grnProblems(state), ...approvalProblems(state)]
                : [];
    if (problems.length) throw invalid(problems);

    // Submitting QC hands over to Stores for the GRN; if the GRN is already there (a resubmit after a send-back)
    // the report goes straight back to the Purchase Manager.
    const target = action === 'submitQc' && state.header.grnNumber ? 'PENDING_APPROVAL' : ACTION_TARGET[action];
    const audits: AuditEntry[] = [];
    const statusChange = (from: string, to: string): AuditEntry => ({
      userId: user.id,
      reportId: id,
      action: 'STATUS_CHANGE',
      field: 'status',
      oldValue: from,
      newValue: to,
    });
    let data: Prisma.ReportUncheckedUpdateInput = { status: target };

    switch (action) {
      case 'submitInvoice':
      case 'submitWeights':
        audits.push(statusChange(report.status, target));
        break;
      case 'submitQc':
        if (report.status !== target) audits.push(statusChange(report.status, target));
        data = { ...data, checkedById: user.id };
        break;
      case 'submitGrn':
        audits.push(statusChange(report.status, target));
        break;
      case 'sendBack':
        audits.push(statusChange(report.status, target), {
          userId: user.id,
          reportId: id,
          action: 'SEND_BACK',
          field: 'sentBackNote',
          newValue: note,
        });
        data = { ...data, sentBackNote: note };
        break;
      case 'reopen':
        audits.push(statusChange(report.status, target), {
          userId: user.id,
          reportId: id,
          action: 'REOPEN',
          field: 'reopenReason',
          newValue: note,
        });
        data = { ...data, reopenReason: note, approvedById: null, approvedAt: null, narration: null };
        break;
      case 'approve':
        audits.push(statusChange(report.status, target));
        break;
    }

    // Guard on the status we read, so two simultaneous actions cannot both succeed.
    const moved = await tx.report.updateMany({ where: { id, status: report.status }, data });
    if (moved.count !== 1) throw conflict('The report changed status while you were working. Reload and try again.');

    if (action === 'approve') {
      // Final authoritative recompute; this is the snapshot the report keeps from now on.
      const output = await persistState(tx, id, state, masters, {
        approvedById: user.id,
        approvedAt: new Date(),
        sentBackNote: null,
        narration: null,
      });
      await tx.report.update({
        where: { id },
        data: { narration: buildTallyNarration(output, { grnNumber: state.header.grnNumber }) },
      });
    }

    await writeAudit(audits, tx);
    if (HANDOFF_ACTIONS.includes(action) && report.status !== target) {
      const handoff = { id, reportNo: report.reportNo, truckNumber: report.truckNumber, partyName: report.supplier?.name ?? report.partyNameRaw };
      pending = await notifyHandoff(tx, handoff, target, user);
    }
    return toDto(await findReport(id, tx), masters);
  });
  // Only after the commit: a rolled-back hand-off must not ring anyone's phone.
  sendPending(pending);
  return dto;
}
