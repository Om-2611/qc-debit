import { calculateReport, type EngineConfig, type EngineOutput } from '@dalmia/calc';
import type { ReportDto, ReportMaterialDto, ReportReadingDto, ReportSection } from '@dalmia/types';
import type { SectionPatch } from '../../api/reports';

export const HEADER_KEYS = [
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
export type HeaderKey = (typeof HEADER_KEYS)[number];

/** The editable copy of a report held by the page; the server copy stays in the query cache. */
export interface Draft {
  header: Record<HeaderKey, string | null>;
  materials: ReportMaterialDto[];
  baleWeightsKg: (number | null)[];
  readings: ReportReadingDto[];
  shortageAdjustments: Record<string, number | null>;
  otherDescriptions: Record<string, string | null>;
  weightTolerancePercent: number | null;
  remarks: string | null;
}

export function fromDto(dto: ReportDto): Draft {
  return {
    header: Object.fromEntries(HEADER_KEYS.map((k) => [k, dto[k]])) as Draft['header'],
    materials: dto.materials.map((m) => ({ ...m })),
    baleWeightsKg: [...dto.baleWeightsKg],
    readings: dto.readings.map((r) => ({ ...r, perBale: [...r.perBale] })),
    shortageAdjustments: Object.fromEntries(dto.shortageAdjustments.map((s) => [s.materialCode, s.adjustmentQty])),
    otherDescriptions: Object.fromEntries(dto.otherDescriptions.map((d) => [d.materialCode, d.description])),
    weightTolerancePercent: dto.weightTolerancePercent,
    remarks: dto.remarks,
  };
}

/** Same calculation the server runs on save, so the preview and the stored figures agree. */
export function liveOutput(draft: Draft, config: EngineConfig): EngineOutput {
  return calculateReport({
    reportDate: draft.header.reportDate ?? '1970-01-01',
    materials: draft.materials,
    baleWeightsKg: draft.baleWeightsKg,
    readings: draft.readings,
    shortageAdjustments: Object.entries(draft.shortageAdjustments)
      .filter((e): e is [string, number] => e[1] != null)
      .map(([materialCode, adjustmentQty]) => ({ materialCode, adjustmentQty })),
    weightTolerancePercent: draft.weightTolerancePercent,
    config,
  });
}

const slice = (d: Draft, section: ReportSection): unknown => {
  switch (section) {
    case 'header':
      return { ...d.header, grnNumber: null }; // GRN belongs to Stores' own section
    // The weights grid belongs to two desks: supplier-invoice rows + Dalmia rate (Gate) and Dalmia weight/bales (RM Store).
    case 'invoiceWeights':
      return d.materials.map((m) => [m.code, m.invoiceWeightKg, m.invoiceBales, m.invoiceRate, m.dalmiaRate]);
    case 'dalmiaWeights':
      return d.materials.map((m) => [m.code, m.dalmiaWeightKg, m.dalmiaBales]);
    case 'grn':
      return d.header.grnNumber;
    case 'qc':
      return [d.baleWeightsKg, d.readings.map((r) => [r.perBale, r.affectedBales])];
    case 'approval':
      return [
        d.readings.map((r) => r.purchaseAdjustment ?? 0),
        d.shortageAdjustments,
        d.otherDescriptions,
        d.weightTolerancePercent,
        d.remarks,
      ];
  }
};

export const isDirty = (draft: Draft, saved: Draft, section: ReportSection): boolean =>
  JSON.stringify(slice(draft, section)) !== JSON.stringify(slice(saved, section));

export function buildPatch(draft: Draft, section: ReportSection, updatedAt: string): SectionPatch {
  switch (section) {
    case 'header':
      // GRN is saved with the store's rows, not the gate's header.
      const { grnNumber: _grn, ...header } = draft.header;
      return { section, body: { ...header, reportDate: header.reportDate ?? undefined, updatedAt } };
    // Each desk sends only its own rows, so the API checks it against its own permission.
    case 'invoiceWeights':
      return {
        section: 'weights',
        body: {
          materials: draft.materials.map((m) => ({
            code: m.code,
            invoiceWeightKg: m.invoiceWeightKg,
            invoiceBales: m.invoiceBales,
            invoiceRate: m.invoiceRate,
            dalmiaRate: m.dalmiaRate, // from the PO, so the gate's
          })),
          updatedAt,
        },
      };
    case 'dalmiaWeights':
      return {
        section: 'weights',
        body: {
          materials: draft.materials.map((m) => ({
            code: m.code,
            dalmiaWeightKg: m.dalmiaWeightKg,
            dalmiaBales: m.dalmiaBales,
          })),
          updatedAt,
        },
      };
    case 'grn':
      return { section, body: { grnNumber: draft.header.grnNumber, updatedAt } };
    case 'qc':
      return {
        section,
        body: {
          baleWeightsKg: draft.baleWeightsKg,
          readings: draft.readings.map((r) => ({
            parameterCode: r.parameterCode,
            perBale: r.perBale,
            affectedBales: r.affectedBales,
          })),
          updatedAt,
        },
      };
    case 'approval':
      return {
        section,
        body: {
          adjustments: draft.readings.map((r) => ({ parameterCode: r.parameterCode, purchaseAdjustment: r.purchaseAdjustment })),
          shortageAdjustments: Object.entries(draft.shortageAdjustments).map(([materialCode, adjustmentQty]) => ({
            materialCode,
            adjustmentQty,
          })),
          otherDescriptions: Object.entries(draft.otherDescriptions).map(([materialCode, description]) => ({
            materialCode,
            description,
          })),
          weightTolerancePercent: draft.weightTolerancePercent,
          remarks: draft.remarks,
          updatedAt,
        },
      };
  }
}
