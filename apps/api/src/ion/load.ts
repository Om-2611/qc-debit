import { notFound } from '../lib/errors';
import { prisma } from '../prisma';
import { ION_CONFIG, type IonConfig } from './config';
import { todayIst } from './money';
import { runPreflight, type PreflightInput, type PreflightResult } from './preflight';

const isoDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

export interface PreflightOverrides {
  /** Per-report iON item code chosen by an admin. */
  itemCodeOverride?: string | null;
  /** "I have checked the amount", for an imported report whose total differs from the sheet's. */
  mismatchConfirmed?: boolean;
  /** The report's iON push when it has one that has not been reset (comes from the job model). */
  existingPush?: { status: string } | null;
}

/** Reads one report with everything the pre-flight needs into the plain shape runPreflight takes. */
export async function loadPreflightInput(reportId: string, overrides: PreflightOverrides = {}, now: Date = new Date()): Promise<PreflightInput> {
  const report = await prisma.report.findUnique({
    where: { id: reportId },
    include: {
      plant: true,
      supplier: true,
      materialLines: { include: { material: true }, orderBy: { material: { sortOrder: 'asc' } } },
      deductions: { include: { parameter: true } },
      shortageLines: true,
    },
  });
  if (!report) throw notFound('Report not found');

  return {
    todayIso: todayIst(now),
    report: {
      reportNo: report.reportNo,
      status: report.status,
      hasMismatch: report.hasMismatch,
      approvedTotal: report.approvedTotal,
      invoiceNumber: report.invoiceNumber,
      invoiceDate: isoDate(report.invoiceDate),
      grnNumber: report.grnNumber,
      truckNumber: report.truckNumber,
    },
    plant: report.plant,
    supplier: report.supplier,
    materialLines: report.materialLines.map((l) => ({
      code: l.material.code,
      name: l.material.name,
      ionItemCode: l.material.ionItemCode,
      invoiceWeightKg: l.invoiceWeightKg,
      invoiceRate: l.invoiceRate,
    })),
    deductions: report.deductions.map((d) => ({
      parameterCode: d.parameter.code,
      name: d.parameter.name,
      sortOrder: d.parameter.sortOrder,
      approvedAmount: d.approvedAmount,
    })),
    shortageAmounts: report.shortageLines.map((s) => s.approvedAmount),
    itemCodeOverride: overrides.itemCodeOverride ?? null,
    mismatchConfirmed: overrides.mismatchConfirmed ?? false,
    existingPush: overrides.existingPush ?? null,
  };
}

export async function preflightReport(reportId: string, overrides: PreflightOverrides = {}, config: IonConfig = ION_CONFIG): Promise<PreflightResult> {
  return runPreflight(await loadPreflightInput(reportId, overrides), config);
}
