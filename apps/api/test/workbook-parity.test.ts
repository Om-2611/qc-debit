import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MATERIAL_CODES as M,
  PARAMETER_CODES as P,
  calculateReport,
  sampleReportInput,
  sheetParityConfig,
  type EngineOutput,
  type ReportInput,
} from '@dalmia/calc';

/**
 * The client's real workbook ("Debit Note Format 1.xlsx", sheet "Format"). Inputs are read from the
 * file, the engine is run under sheet-parity configuration, and every result is compared with the
 * value Excel itself cached in the file. This is the proof that the engine reproduces the sheet.
 */
const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/debit-note-format.xlsx');

const MATERIAL_COLUMNS: [string, string, string][] = [
  [M.CLEAR, 'Clear', 'E'],
  [M.GREEN, 'Green', 'G'],
  [M.BARWASTE, 'Barwaste', 'I'],
  [M.BARWASTE_WITH_RING, 'Barwaste With Ring', 'K'],
  [M.OTHERS, 'Others', 'L'],
];
// Row → parameter. Rows 26/28 are the Jul–Sep rows; 27/29 are the rest-of-year rows for the same parameter.
const PARAMETER_ROWS: [number, string][] = [
  [26, P.MOISTURE],
  [28, P.DIRTY_BOTTLE],
  [30, P.JAR_PET],
  [33, P.NON_FOOD_GRADE_PET],
  [34, P.IRON_PATTI],
  [35, P.RAFFIA],
  [36, P.COLOUR_BOTTLE_PET],
  [37, P.NON_PET],
  [38, P.ALUMINIUM_PET],
  [39, P.METAL],
];

let ws: ExcelJS.Worksheet;
let input: ReportInput;
let out: EngineOutput;

/** Cached value of a cell: plain values as-is, formula cells by their stored result, blank → null. */
function cell(address: string): number | string | Date | null {
  const v = ws.getCell(address).value;
  if (v == null) return null;
  if (typeof v === 'object' && !(v instanceof Date)) {
    if ('result' in v) return (v.result as number | string | Date | undefined) ?? null;
    if ('formula' in v || 'sharedFormula' in v) return null; // formula with no cached value
    return null;
  }
  return typeof v === 'boolean' ? null : v;
}
const num = (address: string): number | null => {
  const v = cell(address);
  return typeof v === 'number' ? v : null;
};
const excel = (address: string): number => num(address) ?? 0;

beforeAll(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FIXTURE);
  ws = wb.getWorksheet('Format')!;

  const date = cell('L10') as Date;
  input = {
    reportDate: date.toISOString().slice(0, 10),
    materials: MATERIAL_COLUMNS.map(([code, name, col]) => ({
      code,
      name,
      invoiceWeightKg: num(`${col}15`),
      invoiceBales: num(`${col}16`),
      invoiceRate: num(`${col}17`),
      dalmiaWeightKg: num(`${col}18`),
      dalmiaBales: num(`${col}19`),
      dalmiaRate: num(`${col}20`),
    })),
    baleWeightsKg: [num('E24'), num('G24'), num('I24')],
    readings: PARAMETER_ROWS.map(([row, parameterCode]) => ({
      parameterCode,
      // Moisture is typed as a % in F/H/J; every other parameter is typed as kg in E/G/I.
      perBale: (parameterCode === P.MOISTURE ? ['F', 'H', 'J'] : ['E', 'G', 'I']).map((c) => num(`${c}${row}`)),
      // The fixture predates "purchase allowed": its column N is a concession in points above the norm.
      purchaseAdjustment: (num(`N${row}`) ?? 0) > 0 ? num(`D${row}`)! + num(`N${row}`)! : null,
    })),
    shortageAdjustments: [
      { materialCode: M.CLEAR, adjustmentQty: excel('N43') },
      { materialCode: M.BARWASTE, adjustmentQty: excel('N44') },
    ],
    weightTolerancePercent: num('D50'),
    config: sheetParityConfig(),
  };
  out = calculateReport(input);
});

describe('layout of the real workbook (corrections to the build prompt’s cell map)', () => {
  it('is recognisable as the template', () => {
    expect(String(cell('A10')).trim()).toBe('QC Report');
    expect(String(cell('A22')).trim()).toBe('QC Parameters');
    expect(String(cell('L8')).trim()).toBe('DPIPL/QA/F-11');
  });

  it('keeps the report date in L10 (label "Date" in K10), not row 9', () => {
    expect(cell('K10')).toBe('Date');
    expect(cell('L10')).toBeInstanceOf(Date);
    expect(input.reportDate).toBe('2026-08-26');
  });

  it('has header values where the importer will look', () => {
    expect(cell('B11')).toBe('ABC');
    expect(cell('B13')).toBe('MH 15 XY 1234');
    expect(cell('I13')).toBe('DPNL/GRN_RM/2627/1234');
    expect(cell('L12')).toBe('ABC/26-27-1');
    expect(cell('A54')).toBe('Checked by'); // row 54, not 53
    expect(cell('J54')).toBe('Approved by');
  });

  it('stores some typed inputs as formulas, so inputs must be read by cached result too', () => {
    expect(ws.getCell('H26').value).toMatchObject({ formula: '5.38' });
    expect(num('H26')).toBe(5.38);
  });

  it('the shared sample fixture is the same data as the workbook', () => {
    const { config: _a, ...fromFile } = input;
    const { config: _b, ...fixture } = sampleReportInput();
    // The workbook types a literal 0 for unused materials where the fixture leaves them blank.
    const blankZero = (v: number | null) => (v === 0 ? null : v);
    const normalise = (r: typeof fromFile) => ({
      ...r,
      materials: r.materials.map((m) => ({
        ...m,
        invoiceWeightKg: blankZero(m.invoiceWeightKg),
        dalmiaWeightKg: blankZero(m.dalmiaWeightKg),
        dalmiaBales: blankZero(m.dalmiaBales),
      })),
      readings: r.readings
        .map((x) => ({ ...x, purchaseAdjustment: x.purchaseAdjustment ?? 0 }))
        .filter((x) => x.perBale.some((v) => v != null) || x.purchaseAdjustment !== 0)
        .sort((a, b) => a.parameterCode.localeCompare(b.parameterCode)),
      shortageAdjustments: (r.shortageAdjustments ?? []).filter((s) => s.adjustmentQty !== 0),
    });
    expect(normalise(fixture)).toEqual(normalise(fromFile));
  });
});

describe('engine vs. Excel’s cached results', () => {
  it('weight block (rows 15–21) and bale total (K24)', () => {
    expect(out.weights.totalInvoiceWeight).toBe(excel('M15'));
    expect(out.weights.totalDalmiaWeight).toBe(excel('M18'));
    expect(out.weights.totalDalmiaBales).toBe(excel('M19'));
    expect(out.weights.totalDifference).toBe(excel('M21'));
    expect(out.weights.dominantRate).toBe(excel('O26'));
    expect(out.totalBaleWeight).toBe(excel('K24'));
  });

  it.each(PARAMETER_ROWS)('row %i (%s): actual %%, rate and columns P–U', (row, code) => {
    const p = out.parameters.find((x) => x.parameterCode === code)!;
    expect(p.actualPercent).toBeCloseTo(excel(`L${row}`), 9);
    if (p.totalKg !== null) expect(p.totalKg).toBeCloseTo(excel(`K${row}`), 9);
    expect(p.normPercent).toBe(excel(`D${row}`));
    expect(p.standardQty).toBeCloseTo(excel(`P${row}`), 6);
    expect(p.standardAmount).toBeCloseTo(excel(`Q${row}`), 6);
    // Approved no longer follows the sheet's R/S: it is (purchase allowed − norm)% × M18 × rate (client, 2026-09-23).
    const allowed = Math.min(Math.max(p.purchaseAdjustment, p.normPercent), Math.max(p.actualPercent, p.normPercent));
    const approvedQty = p.isDeductible ? ((allowed - p.normPercent) / 100) * excel('M18') : 0;
    expect(p.approvedQty).toBeCloseTo(approvedQty, 6);
    expect(p.approvedAmount).toBeCloseTo(p.beyondCutOff ? 0 : approvedQty * p.rate, 6);
    expect(p.differenceAmount).toBeCloseTo(p.approvedAmount - p.standardAmount, 6);
    // Rows 33 and 39 hold a literal 0 rate in the sheet because they have no formula at all.
    if (p.isDeductible) expect(p.rate).toBe(excel(`O${row}`));
  });

  it('per-bale percentages (columns F and H)', () => {
    const iron = out.parameters.find((p) => p.parameterCode === P.IRON_PATTI)!;
    expect(iron.balePercents[0]).toBeCloseTo(excel('F34'), 9);
    expect(iron.balePercents[1]).toBeCloseTo(excel('H34'), 9);
  });

  it('subtotals A, B and Total (A+B) — amounts', () => {
    expect(out.subtotals.discretionary.standardAmount).toBeCloseTo(excel('Q31'), 6);
    expect(out.subtotals.nonDiscretionary.standardAmount).toBeCloseTo(excel('Q40'), 6);
    expect(out.subtotals.contamination.standardAmount).toBeCloseTo(excel('Q41'), 6);
  });

  it('shortage rows 43–45 and C) Sub Total', () => {
    const line = (code: string) => out.shortage.lines.find((l) => l.materialCode === code)!;
    for (const [row, code] of [[43, M.CLEAR], [44, M.BARWASTE], [45, M.GREEN]] as const) {
      expect(line(code).shortageQty).toBe(excel(`O${row}`));
      expect(line(code).rate).toBe(excel(`P${row}`));
      expect(line(code).standardAmount).toBeCloseTo(excel(`Q${row}`), 6);
      expect(line(code).approvedQty).toBe(excel(`R${row}`));
      expect(line(code).approvedAmount).toBeCloseTo(excel(`S${row}`), 6);
    }
    expect(out.shortage.subtotal.standardAmount).toBeCloseTo(excel('Q48'), 6);
    expect(out.shortage.subtotal.approvedAmount).toBeCloseTo(excel('S48'), 6);
  });

  it('Total (A+B+C) — row 49', () => {
    expect(out.grandTotal.standardAmount).toBeCloseTo(excel('Q49'), 6);
    expect(excel('Q49')).toBeCloseTo(51818.86, 2);
    expect(excel('S49')).toBeCloseTo(43791.62, 2); // the sheet's old approved rule
    expect(out.grandTotal.approvedAmount).toBeCloseTo(19160.84, 2);
  });

  it('documents where the app deliberately differs from sheet bugs', () => {
    // R31 (approved qty, discretionary) has no formula, so the sheet's Total (A+B) approved qty omits Moisture.
    expect(cell('R31')).toBeNull();
    expect(excel('R41')).toBeCloseTo(excel('R40'), 9);
    // Row 47 "Other" takes its quantity from the RATE cell: O47 = -L20 (should be -L21).
    expect(ws.getCell('O47').value).toMatchObject({ formula: '-L20' });
  });
});
