import type { Prisma } from '@prisma/client';
import { round, type EngineOutput } from '@dalmia/calc';

/** Money and quantities are stored at 4 dp; rounding to 2 dp happens only at display/export. */
const dp4 = (v: number): number => round(v, 4);

export interface SnapshotLookups {
  parameterIdByCode: Map<string, string>;
  materialIdByCode: Map<string, string>;
}

export interface SnapshotExtras {
  /** Typed "No. of Bales" per parameter code (kept even if the parameter's current rule does not use it). */
  affectedBales?: Record<string, number | null | undefined>;
  /** "Other (Please Specify)" text, keyed by material code. */
  otherDescriptions?: Record<string, string | null | undefined>;
}

/**
 * Freezes engine output into Deduction / ShortageLine rows and the report's total columns, so an
 * approved report keeps its figures when norms or rates are edited later.
 */
export function buildSnapshot(output: EngineOutput, lookups: SnapshotLookups, extras: SnapshotExtras = {}) {
  const deductions: Prisma.DeductionCreateManyReportInput[] = [];
  for (const p of output.parameters) {
    const parameterId = lookups.parameterIdByCode.get(p.parameterCode);
    if (!parameterId) continue;
    deductions.push({
      parameterId,
      normPercent: dp4(p.normPercent),
      totalKg: p.totalKg === null ? null : dp4(p.totalKg),
      actualPercent: dp4(p.actualPercent),
      purchaseAdjustment: dp4(p.purchaseAdjustment),
      affectedBales: extras.affectedBales?.[p.parameterCode] ?? p.affectedBales,
      rate: dp4(p.rate),
      weightBase: p.weightBase,
      isDeductible: p.isDeductible,
      standardQty: dp4(p.standardQty),
      standardAmount: dp4(p.standardAmount),
      approvedQty: dp4(p.approvedQty),
      approvedAmount: dp4(p.approvedAmount),
      differenceQty: dp4(p.differenceQty),
      differenceAmount: dp4(p.differenceAmount),
    });
  }

  const shortageLines: Prisma.ShortageLineCreateManyReportInput[] = [];
  for (const l of output.shortage.lines) {
    const materialId = lookups.materialIdByCode.get(l.materialCode);
    if (!materialId) continue;
    shortageLines.push({
      materialId,
      shortageQty: dp4(l.shortageQty),
      rate: dp4(l.rate),
      standardAmount: dp4(l.standardAmount),
      approvedQty: dp4(l.approvedQty),
      approvedAmount: dp4(l.approvedAmount),
      adjustment: l.adjustmentQty ? dp4(l.adjustmentQty) : null,
      otherDescription: extras.otherDescriptions?.[l.materialCode]?.trim() || null,
    });
  }

  return {
    deductions,
    shortageLines,
    standardTotal: dp4(output.grandTotal.standardAmount),
    approvedTotal: dp4(output.grandTotal.approvedAmount),
  };
}
