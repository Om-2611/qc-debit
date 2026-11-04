import { defaultEngineConfig } from './defaults';
import type { EngineConfig, MaterialInput, ReportInput } from './types';
import { MATERIAL_CODES as M, PARAMETER_CODES as P } from './types';

/** The defaults now ARE the sheet; kept as a named entry point for tests that assert sheet parity. */
export function sheetParityConfig(overrides: Partial<EngineConfig> = {}): EngineConfig {
  const config = defaultEngineConfig(overrides);
  for (const p of config.parameters) {
    if (p.code === P.NON_FOOD_GRADE_PET || p.code === P.METAL) p.isDeductible = false;
  }
  return config;
}

export function blankMaterial(code: string, name: string): MaterialInput {
  return {
    code,
    name,
    invoiceWeightKg: null,
    invoiceBales: null,
    invoiceRate: null,
    dalmiaWeightKg: null,
    dalmiaBales: null,
    dalmiaRate: null,
  };
}

/**
 * The worked example exactly as it appears in the client's "Debit Note Format 1.xlsx" (sheet "Format") —
 * Party ABC, truck MH 15 XY 1234. apps/api/test/workbook-parity.test.ts checks the engine against the
 * file's own cached results cell by cell.
 */
export const SAMPLE_HEADER = {
  partyName: 'ABC',
  truckNumber: 'MH 15 XY 1234',
  reportDate: '2026-08-26',
  poNumber: 'DPNL/PO_RM/2627/1234',
  grnNumber: 'DPNL/GRN_RM/2627/1234',
  tokenNumber: '1',
  invoiceNumber: 'ABC/26-27-1',
} as const;

export function sampleReportInput(config: EngineConfig = sheetParityConfig()): ReportInput {
  return {
    reportDate: SAMPLE_HEADER.reportDate,
    materials: [
      { code: M.CLEAR, name: 'Clear', invoiceWeightKg: 10000, invoiceBales: null, invoiceRate: 120, dalmiaWeightKg: 9950, dalmiaBales: 90, dalmiaRate: 120 },
      { code: M.GREEN, name: 'Green', invoiceWeightKg: 500, invoiceBales: null, invoiceRate: 110, dalmiaWeightKg: 480, dalmiaBales: 5, dalmiaRate: 110 },
      { code: M.BARWASTE, name: 'Barwaste', invoiceWeightKg: 1000, invoiceBales: null, invoiceRate: 125, dalmiaWeightKg: 980, dalmiaBales: 10, dalmiaRate: 125 },
      blankMaterial(M.BARWASTE_WITH_RING, 'Barwaste With Ring'),
      blankMaterial(M.OTHERS, 'Others'),
    ],
    baleWeightsKg: [99, 96, null],
    readings: [
      // Column N holds "purchase allowed": the total % accepted. The workbook's concessions (0.45 above a 5 norm…)
      // are expressed here as the thresholds they amount to, so every figure still matches the sheet.
      { parameterCode: P.MOISTURE, perBale: [9.52, 5.38, null], purchaseAdjustment: 5.45 },
      // Both are under their norms in the workbook, so they raise nothing under either configuration.
      { parameterCode: P.DIRTY_BOTTLE, perBale: [0.5, 0.4, null], purchaseAdjustment: 0 },
      { parameterCode: P.NON_FOOD_GRADE_PET, perBale: [1.1, 1.3, null], purchaseAdjustment: 0 },
      { parameterCode: P.IRON_PATTI, perBale: [0.4, 0.7, null], purchaseAdjustment: 0.52 },
      { parameterCode: P.RAFFIA, perBale: [0.3, 0.2, null], purchaseAdjustment: 0 },
      { parameterCode: P.COLOUR_BOTTLE_PET, perBale: [0.6, 0.6, null], purchaseAdjustment: 0.55 },
      { parameterCode: P.NON_PET, perBale: [0.5, 0.8, null], purchaseAdjustment: 0.6 },
      { parameterCode: P.ALUMINIUM_PET, perBale: [0.9, 1.4, null], purchaseAdjustment: 1.1 },
      { parameterCode: P.METAL, perBale: [0, 0, null], purchaseAdjustment: 0 },
    ],
    shortageAdjustments: [],
    weightTolerancePercent: null, // D50 is blank in the workbook
    config,
  };
}
