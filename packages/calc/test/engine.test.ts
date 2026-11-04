import { describe, expect, it } from 'vitest';
import {
  MATERIAL_CODES as M,
  PARAMETER_CODES as P,
  buildTallyNarration,
  calculateReport,
  defaultEngineConfig,
  round,
  sampleReportInput,
  selectNorm,
  sheetParityConfig,
  toYMD,
  type EngineOutput,
  type ReportInput,
} from '../src';

const param = (out: EngineOutput, code: string) => {
  const p = out.parameters.find((x) => x.parameterCode === code);
  if (!p) throw new Error(`parameter ${code} missing`);
  return p;
};
const shortage = (out: EngineOutput, code: string) => {
  const l = out.shortage.lines.find((x) => x.materialCode === code);
  if (!l) throw new Error(`shortage line ${code} missing`);
  return l;
};
const setMaterial = (
  input: ReportInput,
  code: string,
  patch: Partial<ReportInput['materials'][number]>,
): void => {
  const m = input.materials.find((x) => x.code === code);
  if (!m) throw new Error(`material ${code} missing`);
  Object.assign(m, patch);
};
/** Money assertions: equal once rounded to paise, as displayed and exported. */
const expectMoney = (actual: number, expected: number) => expect(round(actual, 2)).toBe(round(expected, 2));

describe('sample workbook (Party ABC, MH 15 XY 1234) — sheet parity', () => {
  const out = calculateReport(sampleReportInput());

  it('weight block', () => {
    expect(out.weights.totalInvoiceWeight).toBe(11500);
    expect(out.weights.totalDalmiaWeight).toBe(11410);
    expect(out.weights.totalDifference).toBe(-90);
    expect(out.weights.differences.map((d) => d.differenceKg)).toEqual([-50, -20, -20, 0, 0]);
    expect(out.weights.dominantMaterialCode).toBe(M.CLEAR);
    expect(out.weights.dominantRate).toBe(120);
    expect(out.weights.clearWeight).toBe(9950);
    expect(out.totalBaleWeight).toBe(195);
  });

  it('Moisture (Jul–Sep norm 5%) — simple average of % readings', () => {
    const p = param(out, P.MOISTURE);
    expect(p.normPercent).toBe(5);
    expect(p.normSeasonLabel).toBe('Jul–Sep');
    expect(p.actualPercent).toBeCloseTo(7.45, 10);
    expect(p.totalKg).toBeNull();
    expect(p.overNorm).toBe(true);
    expect(p.rate).toBe(120);
    expect(p.weightBase).toBe('TOTAL_DALMIA_WEIGHT');
    expect(p.standardQty).toBeCloseTo(279.545, 6);
    expectMoney(p.standardAmount, 33545.4);
    expect(p.approvedQty).toBeCloseTo(51.345, 6); // (5.45 − 5)% × M18
    expectMoney(p.approvedAmount, 6161.4);
    expectMoney(p.differenceAmount, -27384);
  });

  it('Iron/Patti — weight-weighted actual %, total weight base', () => {
    const p = param(out, P.IRON_PATTI);
    expect(p.totalKg).toBeCloseTo(1.1, 10);
    expect(round(p.actualPercent, 4)).toBe(0.5641);
    expect(p.balePercents[0]).toBeCloseTo((0.4 / 99) * 100, 10);
    expect(p.balePercents[1]).toBeCloseTo((0.7 / 96) * 100, 10);
    expect(p.balePercents[2]).toBeNull();
    expectMoney(p.standardAmount, 877.69);
    expectMoney(p.approvedAmount, 273.84); // (0.52 − 0.5)% × M18 × 120
  });

  it('Raffia — norm 0, any presence deducts', () => {
    const p = param(out, P.RAFFIA);
    expect(p.normPercent).toBe(0);
    expectMoney(p.standardAmount, 3510.77);
    expectMoney(p.approvedAmount, 0); // no purchase allowed entered
    expectMoney(p.differenceAmount, -3510.77);
  });

  it('Colour Bottle-PET — Clear weight base, Clear rate − 20 (sheet O36 = $E$20−20)', () => {
    const p = param(out, P.COLOUR_BOTTLE_PET);
    expect(p.weightBase).toBe('CLEAR_WEIGHT');
    expect(p.weightBaseKg).toBe(9950);
    expect(p.rate).toBe(100);
    expectMoney(p.standardAmount, 1148.08);
    expectMoney(p.approvedAmount, 570.5); // approved always uses M18, not the Clear weight
  });

  it('Non-Pet', () => {
    const p = param(out, P.NON_PET);
    expect(p.rate).toBe(100);
    expectMoney(p.standardAmount, 1658.33);
    expectMoney(p.approvedAmount, 1141);
  });

  it('Aluminium-PET — fixed rate 10', () => {
    const p = param(out, P.ALUMINIUM_PET);
    expect(p.rate).toBe(10);
    expectMoney(p.standardAmount, 178.59);
    expectMoney(p.approvedAmount, 114.1);
  });

  it('parameters under their norm (or with no readings) produce nothing', () => {
    expect(round(param(out, P.DIRTY_BOTTLE).actualPercent, 4)).toBe(0.4615); // sheet L28
    expect(round(param(out, P.NON_FOOD_GRADE_PET).actualPercent, 4)).toBe(1.2308); // sheet L33
    expect(param(out, P.JAR_PET).actualPercent).toBe(0);
    for (const code of [P.DIRTY_BOTTLE, P.JAR_PET, P.NON_FOOD_GRADE_PET, P.METAL]) {
      const p = param(out, code);
      expect(p.standardAmount).toBe(0);
      expect(p.approvedAmount).toBe(0);
      expect(p.overNorm).toBe(false);
    }
    expect(param(out, P.DIRTY_BOTTLE).rate).toBe(10);
    expect(param(out, P.JAR_PET).rate).toBe(5);
  });

  it('shortage block', () => {
    expect(out.shortage.shortfallTotal).toBe(90);
    expect(out.shortage.beyondTolerance).toBe(true);
    expect(out.shortage.toleranceKg).toBe(0); // D50 is blank in the workbook
    expect(out.weights.totalDalmiaBales).toBe(105); // sheet M19
    expect(out.shortage.lines.map((l) => l.materialCode)).toEqual([
      M.CLEAR, M.BARWASTE, M.GREEN, M.BARWASTE_WITH_RING, M.OTHERS,
    ]);

    const clear = shortage(out, M.CLEAR);
    expect(clear.shortageQty).toBe(50);
    expect(clear.approvedQty).toBe(50);
    expectMoney(clear.standardAmount, 10800); // TOTAL shortfall 90 × 120, not Clear-only 50 × 120
    expectMoney(clear.approvedAmount, 10800);

    const bar = shortage(out, M.BARWASTE);
    expect(bar.shortageQty).toBe(20);
    expect(bar.amountRate).toBe(5);
    expectMoney(bar.standardAmount, 100);
    expectMoney(bar.approvedAmount, 100);

    const green = shortage(out, M.GREEN);
    expect(green.shortageQty).toBe(20);
    expect(green.standardAmount).toBe(0);
    expect(green.approvedQty).toBe(0);
    expect(green.approvedAmount).toBe(0);

    expectMoney(out.shortage.subtotal.standardAmount, 10900);
    expectMoney(out.shortage.subtotal.approvedAmount, 10900);
  });

  it('totals: (A), (B), (A+B) and (A+B+C)', () => {
    expectMoney(out.subtotals.discretionary.standardAmount, 33545.4);
    expectMoney(out.subtotals.discretionary.approvedAmount, 6161.4);
    expectMoney(out.subtotals.nonDiscretionary.standardAmount, 7373.46);
    expectMoney(out.subtotals.nonDiscretionary.approvedAmount, 2099.44);
    expectMoney(out.subtotals.contamination.standardAmount, 40918.86);
    expectMoney(out.subtotals.contamination.approvedAmount, 8260.84);
    expectMoney(out.grandTotal.standardAmount, 51818.86);
    expectMoney(out.grandTotal.approvedAmount, 19160.84);
    expectMoney(out.grandTotal.differenceAmount, -32658.02);
  });

  it('is pure — same input, same output, input untouched', () => {
    const input = sampleReportInput();
    const snapshot = JSON.stringify(input);
    expect(calculateReport(input)).toEqual(calculateReport(input));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('bales', () => {
  it('1 bale only', () => {
    const input = sampleReportInput();
    input.baleWeightsKg = [100, null, null];
    input.readings = [
      { parameterCode: P.MOISTURE, perBale: [8, null, null], purchaseAdjustment: 0 },
      { parameterCode: P.IRON_PATTI, perBale: [1, null, null], purchaseAdjustment: 0 },
    ];
    const out = calculateReport(input);
    expect(out.totalBaleWeight).toBe(100);
    expect(param(out, P.MOISTURE).actualPercent).toBe(8);
    expectMoney(param(out, P.MOISTURE).standardAmount, 0.03 * 11410 * 120);
    const iron = param(out, P.IRON_PATTI);
    expect(iron.actualPercent).toBe(1);
    expect(iron.balePercents).toEqual([1, null, null]);
    expectMoney(iron.standardAmount, 0.005 * 11410 * 120);
  });

  it('3 bales — actual % is Σkg ÷ Σbale weight, not the mean of bale %', () => {
    const input = sampleReportInput();
    input.baleWeightsKg = [100, 50, 50];
    input.readings = [{ parameterCode: P.NON_PET, perBale: [1, 2, 0], purchaseAdjustment: 0 }];
    const p = param(calculateReport(input), P.NON_PET);
    expect(p.balePercents).toEqual([1, 4, 0]);
    expect(p.actualPercent).toBe(1.5); // mean of bale % would be 1.667
  });

  it('kg reading against a blank bale weight: bale % is 0 but kg still counts (as in Excel)', () => {
    const input = sampleReportInput();
    input.baleWeightsKg = [100, null, null];
    input.readings = [{ parameterCode: P.RAFFIA, perBale: [1, 1, null], purchaseAdjustment: 0 }];
    const p = param(calculateReport(input), P.RAFFIA);
    expect(p.balePercents).toEqual([1, 0, null]);
    expect(p.actualPercent).toBe(2);
  });

  it('no bale weights at all — no division by zero', () => {
    const input = sampleReportInput();
    input.baleWeightsKg = [null, null, null];
    const out = calculateReport(input);
    expect(param(out, P.IRON_PATTI).actualPercent).toBe(0);
    expect(param(out, P.MOISTURE).actualPercent).toBeCloseTo(7.45, 10); // % readings need no bale weight
    expect(Number.isFinite(out.grandTotal.standardAmount)).toBe(true);
  });

  it('all-zero readings → zero contamination deduction', () => {
    const input = sampleReportInput();
    input.readings = input.config.parameters.map((p) => ({
      parameterCode: p.code,
      perBale: [0, 0, 0],
      purchaseAdjustment: 0,
    }));
    const out = calculateReport(input);
    expect(out.subtotals.contamination.standardAmount).toBe(0);
    expect(out.subtotals.contamination.approvedAmount).toBe(0);
    expect(out.parameters.every((p) => !p.overNorm)).toBe(true);
    expectMoney(out.grandTotal.standardAmount, 10900); // shortage still applies
  });

  it('blank moisture readings are ignored by the average; none → 0', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [null, 6, null] }];
    expect(param(calculateReport(input), P.MOISTURE).actualPercent).toBe(6);
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [null, null, null] }];
    expect(param(calculateReport(input), P.MOISTURE).actualPercent).toBe(0);
  });
});

describe('seasonal norms', () => {
  it('Moisture in October uses the 3% norm', () => {
    const input = sampleReportInput();
    input.reportDate = '2025-10-01';
    const p = param(calculateReport(input), P.MOISTURE);
    expect(p.normPercent).toBe(3);
    expect(p.normSeasonLabel).toBe('Oct–Jun');
    expect(p.standardQty).toBeCloseTo(0.0445 * 11410, 6);
    expectMoney(p.standardAmount, 60929.4);
    // Purchase allowed 5.45 does not change with the season: approved is (5.45 − 3)%, not 0.45%.
    expectMoney(p.approvedAmount, 0.0245 * 11410 * 120);
  });

  it('season boundaries: 30 Jun / 1 Jul / 30 Sep / 1 Oct', () => {
    const norms = defaultEngineConfig().parameters.find((p) => p.code === P.MOISTURE)!.norms;
    expect(selectNorm(norms, '2026-06-30')?.normPercent).toBe(3);
    expect(selectNorm(norms, '2026-07-01')?.normPercent).toBe(5);
    expect(selectNorm(norms, '2026-09-30')?.normPercent).toBe(5);
    expect(selectNorm(norms, '2026-10-01')?.normPercent).toBe(3);
    expect(selectNorm(norms, '2026-01-15')?.normPercent).toBe(3);
  });

  it('Dirty bottle norm: 4% Jul–Sep, 3% otherwise', () => {
    const input = sampleReportInput();
    expect(param(calculateReport(input), P.DIRTY_BOTTLE).normPercent).toBe(4);
    input.reportDate = '2026-12-05';
    expect(param(calculateReport(input), P.DIRTY_BOTTLE).normPercent).toBe(3);
  });

  it('a Date just after midnight IST on 1 July is a July report', () => {
    expect(toYMD(new Date('2026-06-30T18:40:00.000Z'))).toEqual({ year: 2026, month: 7, day: 1 });
    expect(toYMD('2026-06-30T18:40:00.000Z').month).toBe(7);
    expect(toYMD('2026-06-30').month).toBe(6);
  });

  it('effectiveFrom: a later norm only applies to reports dated on/after it', () => {
    const norms = [
      { seasonStartMonth: 1, seasonEndMonth: 12, normPercent: 2 },
      { seasonStartMonth: 1, seasonEndMonth: 12, normPercent: 1.5, effectiveFrom: '2026-04-01' },
    ];
    expect(selectNorm(norms, '2026-03-31')?.normPercent).toBe(2);
    expect(selectNorm(norms, '2026-04-01')?.normPercent).toBe(1.5);
  });
});

describe('configuration switches', () => {
  it('Non Food Grade-PET and Metal have no formula in the sheet: recorded, highlighted, never deducted', () => {
    const readings = [
      { parameterCode: P.NON_FOOD_GRADE_PET, perBale: [2.97, 2.88, null] }, // 3%
      { parameterCode: P.METAL, perBale: [0.99, 0.96, null] }, // 1%
    ];
    const out = calculateReport({ ...sampleReportInput(), readings });
    expect(param(out, P.NON_FOOD_GRADE_PET).standardAmount).toBe(0);
    expect(param(out, P.NON_FOOD_GRADE_PET).actualPercent).toBeCloseTo(3, 10);
    expect(param(out, P.NON_FOOD_GRADE_PET).overNorm).toBe(true); // still highlighted
    expect(param(out, P.METAL).approvedAmount).toBe(0);

    // An admin can switch them on; they then use the standard truck-wide formula.
    const config = defaultEngineConfig();
    for (const p of config.parameters) p.isDeductible = true;
    const on = calculateReport({ ...sampleReportInput(config), readings });
    expectMoney(param(on, P.NON_FOOD_GRADE_PET).standardAmount, 0.01 * 11410 * 120);
    expectMoney(param(on, P.METAL).standardAmount, 0.01 * 11410 * 120);
  });

  it('weight base is configurable per parameter', () => {
    const config = sheetParityConfig();
    config.parameters.find((p) => p.code === P.COLOUR_BOTTLE_PET)!.rates = [
      { rateMode: 'CLEAR_RATE_MINUS_20', weightBase: 'TOTAL_DALMIA_WEIGHT' },
    ];
    const p = param(calculateReport(sampleReportInput(config)), P.COLOUR_BOTTLE_PET);
    expect(p.weightBaseKg).toBe(11410);
    expectMoney(p.standardAmount, round(((1.2 / 195) * 100 - 0.5) / 100 * 11410 * 100, 2));
  });

  it('dominant material follows the largest Dalmia weight', () => {
    const input = sampleReportInput();
    setMaterial(input, M.GREEN, { invoiceWeightKg: 12000, dalmiaWeightKg: 12000 });
    const out = calculateReport(input);
    expect(out.weights.dominantMaterialCode).toBe(M.GREEN);
    expect(out.weights.dominantRate).toBe(110);
    expect(param(out, P.MOISTURE).rate).toBe(110);
    expect(param(out, P.NON_PET).rate).toBe(100); // Clear rate − 20, whatever the dominant material
    expect(out.weights.clearRate).toBe(120);
    expect(param(out, P.ALUMINIUM_PET).rate).toBe(10);
  });

  it('approved = (purchase allowed − norm)% × total Dalmia weight (M18) × rate', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [9.52, 5.38, null], purchaseAdjustment: 7 }];
    const p = param(calculateReport(input), P.MOISTURE);
    expect(p.approvedFromPercent).toBe(7);
    expect(p.standardQty).toBeCloseTo(0.0245 * 11410, 6); // from the norm, unchanged
    expect(p.approvedQty).toBeCloseTo(0.02 * 11410, 6); // 7 − 5
    expectMoney(p.approvedAmount, 0.02 * 11410 * 120);
  });

  it('purchase allowed is capped between the norm (D) and the actual % (L)', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [6, 6, null], purchaseAdjustment: 8 }];
    const capped = param(calculateReport(input), P.MOISTURE);
    expect(capped.approvedFromPercent).toBe(6); // capped at the actual %
    expectMoney(capped.approvedAmount, 0.01 * 11410 * 120);

    input.readings = [{ parameterCode: P.MOISTURE, perBale: [6, 6, null], purchaseAdjustment: 2 }];
    const belowNorm = param(calculateReport(input), P.MOISTURE);
    expect(belowNorm.approvedFromPercent).toBe(5);
    expect(belowNorm.approvedAmount).toBe(0);
  });

  it('blank "purchase allowed" gives no approved amount', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [6, 6, null] }];
    const p = param(calculateReport(input), P.MOISTURE);
    expect(p.approvedFromPercent).toBe(5);
    expect(p.approvedAmount).toBe(0);
  });

  it('an allowance on a parameter within norm approves nothing', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.MOISTURE, perBale: [4, 4, null], purchaseAdjustment: 6 }];
    const p = param(calculateReport(input), P.MOISTURE);
    expect(p.standardAmount).toBe(0);
    expect(p.approvedAmount).toBe(0);
  });
});

describe('per-affected-bale parameters (sheet column M "No. of Bales")', () => {
  const avgTruckBale = 11410 / 105; // M18 ÷ M19

  it('Dirty bottle: excess % × bales affected × average truck bale weight × 10', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.DIRTY_BOTTLE, perBale: [4.95, 4.8, null], affectedBales: 10 }]; // 5%
    const p = param(calculateReport(input), P.DIRTY_BOTTLE);
    expect(p.actualPercent).toBeCloseTo(5, 10);
    expect(p.weightBase).toBe('AFFECTED_BALES_TRUCK_AVG');
    expect(p.affectedBales).toBe(10);
    expect(p.weightBaseKg).toBeCloseTo(10 * avgTruckBale, 9);
    expect(p.standardQty).toBeCloseTo(0.01 * 10 * avgTruckBale, 9);
    expectMoney(p.standardAmount, 0.01 * 10 * avgTruckBale * 10);
    expect(p.approvedAmount).toBe(0); // no purchase allowed entered
  });

  it('Dirty bottle is charged only below 6% (sheet Q28); the quantity is still shown', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.DIRTY_BOTTLE, perBale: [5.94, 5.76, null], affectedBales: 10 }]; // 6%
    const at = param(calculateReport(input), P.DIRTY_BOTTLE);
    expect(at.beyondCutOff).toBe(true);
    expect(at.standardQty).toBeCloseTo(0.02 * 10 * avgTruckBale, 9);
    expect(at.standardAmount).toBe(0);
    expect(at.approvedAmount).toBe(0);

    input.readings = [{ parameterCode: P.DIRTY_BOTTLE, perBale: [5.9, 5.7, null], affectedBales: 10 }];
    const under = param(calculateReport(input), P.DIRTY_BOTTLE);
    expect(under.beyondCutOff).toBe(false);
    expect(under.standardAmount).toBeGreaterThan(0);
  });

  it('no bales entered, or no truck bale count, means no deduction (blank M cell)', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.DIRTY_BOTTLE, perBale: [4.95, 4.8, null] }];
    expect(param(calculateReport(input), P.DIRTY_BOTTLE).standardAmount).toBe(0);

    input.readings = [{ parameterCode: P.DIRTY_BOTTLE, perBale: [4.95, 4.8, null], affectedBales: 10 }];
    for (const m of input.materials) m.dalmiaBales = null; // Excel would show #DIV/0!
    const p = param(calculateReport(input), P.DIRTY_BOTTLE);
    expect(p.standardAmount).toBe(0);
    expect(Number.isFinite(p.standardQty)).toBe(true);
  });

  it('Jar-PET: excess % × bales affected × average SAMPLE bale weight × 5', () => {
    const input = sampleReportInput();
    input.readings = [{ parameterCode: P.JAR_PET, perBale: [2.97, 2.88, null], affectedBales: 4, purchaseAdjustment: 2.5 }]; // 3%; purchase allows 2.5
    const p = param(calculateReport(input), P.JAR_PET);
    expect(p.weightBase).toBe('AFFECTED_BALES_SAMPLE_AVG');
    expect(p.weightBaseKg).toBeCloseTo(4 * 97.5, 9); // AVERAGE(99, 96)
    expect(p.standardQty).toBeCloseTo(3.9, 9);
    expectMoney(p.standardAmount, 19.5);
    expectMoney(p.approvedAmount, 0.005 * 11410 * 5); // (2.5 − 2)% × M18 × 5
  });

  it('affected bales are ignored by truck-wide parameters', () => {
    const input = sampleReportInput();
    const moisture = input.readings.find((r) => r.parameterCode === P.MOISTURE)!;
    moisture.affectedBales = 50;
    const p = param(calculateReport(input), P.MOISTURE);
    expect(p.affectedBales).toBeNull();
    expectMoney(p.standardAmount, 33545.4);
  });
});

describe('shortage block', () => {
  it('excess weight — no shortage charged', () => {
    const input = sampleReportInput();
    setMaterial(input, M.CLEAR, { dalmiaWeightKg: 10100 });
    setMaterial(input, M.GREEN, { dalmiaWeightKg: 500 });
    setMaterial(input, M.BARWASTE, { dalmiaWeightKg: 1010 });
    const out = calculateReport(input);
    expect(out.shortage.shortfallTotal).toBe(-110);
    expect(out.shortage.beyondTolerance).toBe(false);
    expect(out.shortage.lines.every((l) => l.standardAmount === 0 && l.approvedAmount === 0)).toBe(true);
    expect(shortage(out, M.CLEAR).shortageQty).toBe(-100);
    expect(shortage(out, M.BARWASTE).approvedQty).toBe(0);
    expect(out.shortage.subtotal.standardAmount).toBe(0);
  });

  it('Green excess recovers the price difference vs Clear', () => {
    const input = sampleReportInput();
    setMaterial(input, M.CLEAR, { dalmiaWeightKg: 9800 });
    setMaterial(input, M.GREEN, { dalmiaWeightKg: 700 }); // 200 kg of Clear arrived as Green
    setMaterial(input, M.BARWASTE, { dalmiaWeightKg: 1000 });
    const out = calculateReport(input);
    expect(out.shortage.shortfallTotal).toBe(0);
    const green = shortage(out, M.GREEN);
    expect(green.shortageQty).toBe(-200);
    expect(green.amountRate).toBe(-10);
    expect(green.approvedQty).toBe(-200);
    expectMoney(green.standardAmount, 2000);
    expectMoney(green.approvedAmount, 2000);
    expect(shortage(out, M.CLEAR).standardAmount).toBe(0); // total weight matches the invoice
    expectMoney(out.shortage.subtotal.approvedAmount, 2000);
  });

  it('tolerance boundary: exactly 99.5% received is NOT charged; a hair under is', () => {
    const input = sampleReportInput();
    setMaterial(input, M.GREEN, { invoiceWeightKg: 0, dalmiaWeightKg: 0 });
    setMaterial(input, M.BARWASTE, { invoiceWeightKg: 0, dalmiaWeightKg: 0 });
    setMaterial(input, M.CLEAR, { invoiceWeightKg: 10000, dalmiaWeightKg: 9950 });
    const at = calculateReport(input);
    expect(at.shortage.beyondTolerance).toBe(false);
    expect(shortage(at, M.CLEAR).standardAmount).toBe(0);
    expect(shortage(at, M.CLEAR).approvedAmount).toBe(0);
    expect(shortage(at, M.CLEAR).shortageQty).toBe(50);

    setMaterial(input, M.CLEAR, { dalmiaWeightKg: 9949.99 });
    const under = calculateReport(input);
    expect(under.shortage.beyondTolerance).toBe(true);
    expectMoney(shortage(under, M.CLEAR).standardAmount, 6001.2);
  });

  it('tolerance boundary holds for awkward decimals (no floating-point false positives)', () => {
    for (const invoice of [11500, 12345.6, 9876.54, 23710, 1000.1]) {
      const input = sampleReportInput();
      setMaterial(input, M.GREEN, { invoiceWeightKg: 0, dalmiaWeightKg: 0 });
      setMaterial(input, M.BARWASTE, { invoiceWeightKg: 0, dalmiaWeightKg: 0 });
      setMaterial(input, M.CLEAR, { invoiceWeightKg: invoice, dalmiaWeightKg: invoice * 0.995 });
      expect(calculateReport(input).shortage.beyondTolerance).toBe(false);
    }
  });

  it('shortage adjustment reduces approved only', () => {
    const input = sampleReportInput();
    input.shortageAdjustments = [
      { materialCode: M.CLEAR, adjustmentQty: 40 },
      { materialCode: M.BARWASTE, adjustmentQty: 5 },
    ];
    const out = calculateReport(input);
    expectMoney(shortage(out, M.CLEAR).standardAmount, 10800);
    expectMoney(shortage(out, M.CLEAR).approvedAmount, 50 * 120);
    expectMoney(shortage(out, M.BARWASTE).approvedAmount, 15 * 5);
    expectMoney(out.shortage.subtotal.differenceAmount, -(40 * 120 + 5 * 5));
  });

  it('Barwaste With Ring / Others: qty × own rate; excess is not credited by default', () => {
    const input = sampleReportInput();
    setMaterial(input, M.BARWASTE_WITH_RING, { invoiceWeightKg: 300, dalmiaWeightKg: 280, dalmiaRate: 90 });
    setMaterial(input, M.OTHERS, { invoiceWeightKg: 100, dalmiaWeightKg: 130, dalmiaRate: 50 });
    const out = calculateReport(input);
    expectMoney(shortage(out, M.BARWASTE_WITH_RING).standardAmount, 1800);
    expectMoney(shortage(out, M.BARWASTE_WITH_RING).approvedAmount, 1800);
    expect(shortage(out, M.OTHERS).standardAmount).toBe(0);

    const literal = calculateReport({ ...input, config: sheetParityConfig({ allowNegativeOtherShortage: true }) });
    expectMoney(shortage(literal, M.OTHERS).standardAmount, -1500);
  });

  it('useWeightToleranceRow replaces the 0.5% test with shortfall > tolerance kg', () => {
    const input = sampleReportInput(sheetParityConfig({ useWeightToleranceRow: true }));
    input.weightTolerancePercent = 1; // 114.1 kg allowed, shortfall is 90
    const lenient = calculateReport(input);
    expect(lenient.shortage.toleranceTest).toBe('TOLERANCE_ROW');
    expect(lenient.shortage.beyondTolerance).toBe(false);
    expect(shortage(lenient, M.CLEAR).standardAmount).toBe(0);

    input.weightTolerancePercent = 0.5; // 57.05 kg allowed
    expect(calculateReport(input).shortage.beyondTolerance).toBe(true);
  });

  it('empty report — everything is zero and finite', () => {
    const input = sampleReportInput();
    for (const m of input.materials) setMaterial(input, m.code, { invoiceWeightKg: null, dalmiaWeightKg: null, dalmiaRate: null });
    input.readings = [];
    input.baleWeightsKg = [];
    const out = calculateReport(input);
    expect(out.grandTotal).toEqual({ standardAmount: 0, approvedAmount: 0, differenceAmount: 0 });
    expect(out.shortage.beyondTolerance).toBe(false);
  });
});

describe('Tally narration', () => {
  it('lists only non-zero approved lines, then the GRN', () => {
    const text = buildTallyNarration(calculateReport(sampleReportInput()), { grnNumber: '4521' });
    expect(text).toBe(
      'Being Debit Note for Moisture-6161 (51.35*120), Iron/Patti-274 (2.28*120), ' +
        'Colour Bottle-PET-571 (5.71*100), Non-Pet-1141 (11.41*100), Aluminium-PET-114 (11.41*10), ' +
        'Weight Short-10800 (90*120), Barwaste Short-100 (20*5) and GRN No. 4521.',
    );
  });

  it('narrates excess green with positive figures', () => {
    const input = sampleReportInput();
    input.readings = [];
    setMaterial(input, M.CLEAR, { dalmiaWeightKg: 9800 });
    setMaterial(input, M.GREEN, { dalmiaWeightKg: 700 });
    setMaterial(input, M.BARWASTE, { dalmiaWeightKg: 1000 });
    expect(buildTallyNarration(calculateReport(input), { grnNumber: 'G-7' })).toBe(
      'Being Debit Note for Excess Green-2000 (200*10) and GRN No. G-7.',
    );
  });
});
