import type { Prisma } from '@prisma/client';
import { calculateReport, type EngineConfig, type EngineOutput } from '@dalmia/calc';
import { BALE_COUNT, type ReportMaterialDto, type ReportReadingDto } from '@dalmia/types';

export const reportInclude = {
  supplier: true,
  materialLines: { include: { material: true } },
  bales: true,
  readings: { include: { parameter: true } },
  deductions: { include: { parameter: true } },
  shortageLines: { include: { material: true } },
  createdBy: { select: { id: true, name: true } },
  checkedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
} satisfies Prisma.ReportInclude;

export type FullReport = Prisma.ReportGetPayload<{ include: typeof reportInclude }>;

export interface Masters {
  materials: { id: string; code: string; name: string; sortOrder: number }[];
  parameters: { id: string; code: string }[];
  config: EngineConfig;
}

export const HEADER_FIELDS = [
  'reportDate',
  'supplierId',
  'partyNameRaw',
  'poNumber',
  'truckNumber',
  'grnNumber',
  'tokenDate',
  'tokenNumber',
  'invoiceNumber',
  'invoiceDate',
] as const;
export type HeaderField = (typeof HEADER_FIELDS)[number];

/** Everything a user can type into a report, in plain JS values. Engine output is derived from it. */
export interface ReportState {
  header: Record<HeaderField, string | null> & { reportDate: string };
  materials: ReportMaterialDto[];
  baleWeightsKg: (number | null)[];
  readings: ReportReadingDto[];
  shortageAdjustments: Record<string, number | null>;
  otherDescriptions: Record<string, string | null>;
  weightTolerancePercent: number | null;
  remarks: string | null;
}

const num = (d: Prisma.Decimal | null | undefined): number | null => (d == null ? null : d.toNumber());
export const isoDate = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
export const toDate = (s: string | null): Date | null => (s ? new Date(`${s}T00:00:00.000Z`) : null);

export function extractState(report: FullReport, masters: Masters): ReportState {
  const lineByCode = new Map(report.materialLines.map((l) => [l.material.code, l]));
  // Active materials in sheet order, plus any the report already uses that were deactivated since.
  const materialCodes = [
    ...masters.materials.map((m) => ({ code: m.code, name: m.name })),
    ...report.materialLines
      .filter((l) => !masters.materials.some((m) => m.code === l.material.code))
      .map((l) => ({ code: l.material.code, name: l.material.name })),
  ];

  const adjustmentByParam = new Map(report.deductions.map((d) => [d.parameter.code, d.purchaseAdjustment.toNumber()]));
  const affectedByParam = new Map(report.deductions.map((d) => [d.parameter.code, num(d.affectedBales)]));
  const shortageByCode = new Map(report.shortageLines.map((s) => [s.material.code, s]));

  return {
    header: {
      reportDate: isoDate(report.reportDate)!,
      supplierId: report.supplierId,
      partyNameRaw: report.partyNameRaw,
      poNumber: report.poNumber,
      truckNumber: report.truckNumber,
      grnNumber: report.grnNumber,
      tokenDate: isoDate(report.tokenDate),
      tokenNumber: report.tokenNumber,
      invoiceNumber: report.invoiceNumber,
      invoiceDate: isoDate(report.invoiceDate),
    },
    materials: materialCodes.map(({ code, name }) => {
      const l = lineByCode.get(code);
      return {
        code,
        name,
        invoiceWeightKg: num(l?.invoiceWeightKg),
        invoiceBales: num(l?.invoiceBales),
        invoiceRate: num(l?.invoiceRate),
        dalmiaWeightKg: num(l?.dalmiaWeightKg),
        dalmiaBales: num(l?.dalmiaBales),
        dalmiaRate: num(l?.dalmiaRate),
      };
    }),
    baleWeightsKg: Array.from({ length: BALE_COUNT }, (_, i) =>
      num(report.bales.find((b) => b.baleIndex === i + 1)?.baleWeightKg),
    ),
    readings: masters.config.parameters.map((p) => ({
      parameterCode: p.code,
      perBale: Array.from({ length: BALE_COUNT }, (_, i) =>
        num(report.readings.find((r) => r.parameter.code === p.code && r.baleIndex === i + 1)?.value),
      ),
      purchaseAdjustment: adjustmentByParam.get(p.code) || null,
      affectedBales: affectedByParam.get(p.code) ?? null,
    })),
    shortageAdjustments: Object.fromEntries(materialCodes.map(({ code }) => [code, num(shortageByCode.get(code)?.adjustment)])),
    otherDescriptions: Object.fromEntries(
      materialCodes.map(({ code }) => [code, shortageByCode.get(code)?.otherDescription ?? null]),
    ),
    weightTolerancePercent: num(report.weightTolerancePercent),
    remarks: report.remarks,
  };
}

export function computeOutput(state: ReportState, config: EngineConfig): EngineOutput {
  return calculateReport({
    reportDate: state.header.reportDate,
    materials: state.materials,
    baleWeightsKg: state.baleWeightsKg,
    readings: state.readings,
    shortageAdjustments: Object.entries(state.shortageAdjustments)
      .filter((e): e is [string, number] => e[1] != null)
      .map(([materialCode, adjustmentQty]) => ({ materialCode, adjustmentQty })),
    weightTolerancePercent: state.weightTolerancePercent,
    config,
  });
}

/** Flat `field → value` view of the state, used to write one audit row per changed field. */
export function flattenState(state: ReportState): Record<string, string | number | null> {
  const flat: Record<string, string | number | null> = {};
  for (const f of HEADER_FIELDS) flat[f] = state.header[f];
  for (const m of state.materials) {
    const { code, name: _name, ...fields } = m;
    for (const [k, v] of Object.entries(fields)) flat[`weights.${code}.${k}`] = v;
  }
  state.baleWeightsKg.forEach((w, i) => (flat[`bale.${i + 1}.weightKg`] = w));
  for (const r of state.readings) {
    r.perBale.forEach((v, i) => (flat[`reading.${r.parameterCode}.bale${i + 1}`] = v));
    flat[`purchaseAdjustment.${r.parameterCode}`] = r.purchaseAdjustment;
    flat[`affectedBales.${r.parameterCode}`] = r.affectedBales;
  }
  for (const [code, v] of Object.entries(state.shortageAdjustments)) flat[`shortageAdjustment.${code}`] = v;
  for (const [code, v] of Object.entries(state.otherDescriptions)) flat[`otherDescription.${code}`] = v;
  flat.weightTolerancePercent = state.weightTolerancePercent;
  flat.remarks = state.remarks;
  return flat;
}

export interface FieldChange {
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
}

export function diffStates(before: ReportState, after: ReportState): FieldChange[] {
  const a = flattenState(before);
  const b = flattenState(after);
  const changes: FieldChange[] = [];
  for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const oldValue = a[field] ?? null;
    const newValue = b[field] ?? null;
    // Treat a cleared adjustment (null) and 0 as the same thing.
    const same = oldValue === newValue || (field.includes('djustment') && (oldValue ?? 0) === (newValue ?? 0));
    if (!same) changes.push({ field, oldValue, newValue });
  }
  return changes;
}

/**
 * Replaces the freshly calculated amounts with the ones frozen in the database, so an APPROVED
 * report (or an imported sheet) shows its historical figures even after norms or rates change.
 */
export function overlaySnapshot(output: EngineOutput, report: FullReport): EngineOutput {
  const dByCode = new Map(report.deductions.map((d) => [d.parameter.code, d]));
  const sByCode = new Map(report.shortageLines.map((s) => [s.material.code, s]));

  const parameters = output.parameters.map((p) => {
    const d = dByCode.get(p.parameterCode);
    if (!d) return p;
    const actualPercent = d.actualPercent.toNumber();
    const normPercent = d.normPercent.toNumber();
    return {
      ...p,
      normPercent,
      totalKg: d.totalKg ? d.totalKg.toNumber() : p.totalKg,
      actualPercent,
      overNorm: actualPercent > normPercent,
      purchaseAdjustment: d.purchaseAdjustment.toNumber(),
      rate: d.rate.toNumber(),
      weightBase: d.weightBase,
      affectedBales: num(d.affectedBales),
      isDeductible: d.isDeductible,
      standardQty: d.standardQty.toNumber(),
      standardAmount: d.standardAmount.toNumber(),
      approvedQty: d.approvedQty.toNumber(),
      approvedAmount: d.approvedAmount.toNumber(),
      differenceQty: d.differenceQty.toNumber(),
      differenceAmount: d.differenceAmount.toNumber(),
    };
  });

  const lines = output.shortage.lines.map((l) => {
    const s = sByCode.get(l.materialCode);
    if (!s) return l;
    const standardAmount = s.standardAmount.toNumber();
    const approvedAmount = s.approvedAmount.toNumber();
    return {
      ...l,
      shortageQty: s.shortageQty.toNumber(),
      rate: s.rate.toNumber(),
      standardAmount,
      approvedQty: s.approvedQty.toNumber(),
      approvedAmount,
      differenceAmount: approvedAmount - standardAmount,
      adjustmentQty: s.adjustment?.toNumber() ?? 0,
    };
  });

  const keys = ['standardQty', 'standardAmount', 'approvedQty', 'approvedAmount', 'differenceQty', 'differenceAmount'] as const;
  const total = (rows: typeof parameters) =>
    Object.fromEntries(keys.map((k) => [k, rows.reduce((a, r) => a + r[k], 0)])) as Record<(typeof keys)[number], number>;
  const discretionary = total(parameters.filter((p) => p.category === 'DISCRETIONARY'));
  const nonDiscretionary = total(parameters.filter((p) => p.category === 'NON_DISCRETIONARY'));
  const contamination = Object.fromEntries(keys.map((k) => [k, discretionary[k] + nonDiscretionary[k]])) as typeof discretionary;
  const subtotal = {
    standardAmount: lines.reduce((a, l) => a + l.standardAmount, 0),
    approvedAmount: lines.reduce((a, l) => a + l.approvedAmount, 0),
    differenceAmount: lines.reduce((a, l) => a + l.differenceAmount, 0),
  };

  return {
    ...output,
    parameters,
    subtotals: { discretionary, nonDiscretionary, contamination },
    shortage: { ...output.shortage, lines, subtotal },
    grandTotal: {
      // The report's stored totals win: for imports they are the sheet's own Total (A+B+C).
      standardAmount: report.standardTotal.toNumber(),
      approvedAmount: report.approvedTotal.toNumber(),
      differenceAmount: report.approvedTotal.toNumber() - report.standardTotal.toNumber(),
    },
  };
}
