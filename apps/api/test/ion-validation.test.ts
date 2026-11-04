import { describe, expect, it } from 'vitest';
import { ION_CONFIG } from '../src/ion/config';
import { isoToIon, roundMoney, todayIst } from '../src/ion/money';
import { buildNarration, buildReasonDetails, pickMainMaterial, toPlainLine } from '../src/ion/payload';
import { invoiceTaxableValue, runPreflight, type PreflightInput } from '../src/ion/preflight';
import { resolveSupplierState } from '../src/ion/states';
import { compareTaxes, expectedTaxes } from '../src/ion/tax';

const DED = (parameterCode: string, name: string, sortOrder: number, approvedAmount: number | string) => ({ parameterCode, name, sortOrder, approvedAmount });

/** The deductions of the reference note, in report order. */
const GOLDEN_DEDUCTIONS = [
  DED('MOISTURE', 'Moisture', 10, 100),
  DED('DIRTY_BOTTLE', 'Dirty bottle', 20, 0),
  DED('IRON_PATTI', 'Iron/Patti', 50, 200),
  DED('RAFFIA', 'Raffia', 60, 100),
  DED('COLOUR_BOTTLE_PET', 'Colour Bottle-PET', 70, 100),
  DED('NON_PET', 'Non-Pet', 80, 100),
  DED('METAL', 'Metal', 100, 0),
];

/** Ecoloom, Uttar Pradesh, into DPNL (Maharashtra): the golden case from the manual run. */
function golden(over: Partial<PreflightInput> = {}): PreflightInput {
  return {
    todayIso: '2026-11-04',
    report: {
      reportNo: 'QC/26-27/0013',
      status: 'APPROVED',
      hasMismatch: false,
      approvedTotal: '1000.0000',
      invoiceNumber: 'ECPL/26-27/0632',
      invoiceDate: '2026-10-27',
      grnNumber: 'DPNL/GRN_RM/2627/4331',
      truckNumber: 'MH 15 XY 1234',
    },
    plant: { code: 'DPNL', ionSiteCode: 'DPNL', ionSiteAddressLabel: 'DPNL (Bill to Address)', stateCode: '27', isActive: true },
    supplier: { name: 'Ecoloom', gstin: '09AAAAA0000A1Z5', ionSupplierCode: 'CRRM_140290', ionAddressCode: null, ionStateCode: '09', gstRegistered: true },
    materialLines: [
      { code: 'CLEAR', name: 'Clear', ionItemCode: 'RM-13001', invoiceWeightKg: 10000, invoiceRate: 30 },
      { code: 'GREEN', name: 'Green', ionItemCode: 'RM-13025', invoiceWeightKg: 2000, invoiceRate: 20 },
    ],
    deductions: GOLDEN_DEDUCTIONS,
    shortageAmounts: [0, 300],
    existingPush: null,
    ...over,
  };
}

const codes = (r: ReturnType<typeof runPreflight>, severity: 'block' | 'warn' = 'block') => r.issues.filter((i) => i.severity === severity).map((i) => i.code);

describe('2-decimal rounding', () => {
  it('rounds half up on the decimal value, not a float', () => {
    expect(roundMoney('1.005').toFixed(2)).toBe('1.01');
    expect(roundMoney('2.675').toFixed(2)).toBe('2.68');
    expect(roundMoney(0.005).toFixed(2)).toBe('0.01');
    expect(roundMoney('1000.0000').toFixed(2)).toBe('1000.00');
    expect(roundMoney('1000.004').toFixed(2)).toBe('1000.00');
    expect(roundMoney('43791.6249').toFixed(2)).toBe('43791.62');
  });

  it('formats dates for iON and reads today in India, not UTC', () => {
    expect(isoToIon('2026-10-27')).toBe('27/10/2026');
    // 20:00 UTC on 3 Nov is already 4 Nov in India.
    expect(todayIst(new Date('2026-11-03T20:00:00Z'))).toBe('2026-11-04');
    expect(todayIst(new Date('2026-11-03T10:00:00Z'))).toBe('2026-11-03');
  });
});

describe('expected taxes', () => {
  it('charges IGST 18% across states: 1000.00 -> 180.00', () => {
    expect(expectedTaxes('1000.00', true)).toEqual([{ code: 'INPUT-IGST 18%', amount: '180.00' }]);
  });

  it('splits into CGST 9% + SGST 9% within the state, each line rounded on its own', () => {
    expect(expectedTaxes('1000.00', false)).toEqual([
      { code: 'INPUT-CGST 9%', amount: '90.00' },
      { code: 'INPUT-SGST 9%', amount: '90.00' },
    ]);
    // 333.33 x 9% = 29.9997 -> 30.00 each; 0.50 x 9% = 0.045 -> 0.05 each (half up)
    expect(expectedTaxes('333.33', false).map((t) => t.amount)).toEqual(['30.00', '30.00']);
    expect(expectedTaxes('0.50', false).map((t) => t.amount)).toEqual(['0.05', '0.05']);
    expect(expectedTaxes('333.33', true)[0]!.amount).toBe('60.00'); // 59.9994
  });

  it('accepts iON lines within 0.01 and stops on anything else', () => {
    const expected = expectedTaxes('1000.00', true);
    expect(compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: '180.00' }]).ok).toBe(true);
    expect(compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: '180.01' }]).ok).toBe(true);
    expect(compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: '180.00' }]).ok).toBe(true);
    expect(compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: '179.99' }]).ok).toBe(true);
    expect(compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: '180.02' }]).ok).toBe(false);
    expect(compareTaxes(expected, [{ code: 'INPUT-CGST 9%', amount: '180.00' }]).problems).toHaveLength(2); // missing + unexpected
    expect(compareTaxes(expected, []).ok).toBe(false);
    // The TDS line left in place is an unexpected line.
    const withTds = compareTaxes(expected, [{ code: 'INPUT-IGST 18%', amount: 180 }, { code: ION_CONFIG.tdsTaxCodeText, amount: '-1.00' }]);
    expect(withTds.ok).toBe(false);
    expect(withTds.problems[0]).toContain('unexpected');
  });
});

describe('supplier state', () => {
  it('takes the iON master value first and the GSTIN prefix as the fallback', () => {
    expect(resolveSupplierState({ ionStateCode: '09', gstin: '09AAAAA0000A1Z5' })).toEqual({ code: '09', source: 'ion', conflict: null });
    expect(resolveSupplierState({ ionStateCode: null, gstin: '27AAAAA0000A1Z5' })).toEqual({ code: '27', source: 'gstin', conflict: null });
    expect(resolveSupplierState({ ionStateCode: null, gstin: null }).code).toBeNull();
    expect(resolveSupplierState({ ionStateCode: null, gstin: 'ABC' }).code).toBeNull();
  });

  it('flags a disagreement but still reports the iON value', () => {
    expect(resolveSupplierState({ ionStateCode: '27', gstin: '09AAAAA0000A1Z5' })).toEqual({ code: '27', source: 'ion', conflict: { ion: '27', gstin: '09' } });
  });
});

describe('reason details', () => {
  it('lists the non-zero deductions in report order, with our team\'s short names', () => {
    expect(buildReasonDetails({ deductions: GOLDEN_DEDUCTIONS, shortageAmounts: [], qcNo: 'QC/26-27/0013' })).toBe('Moisture, Iron, Raffia, Colour, Non-PET');
  });

  it('adds Shortage last, and leaves the QC number out when it no longer fits within 50 characters', () => {
    const out = buildReasonDetails({ deductions: GOLDEN_DEDUCTIONS, shortageAmounts: [300], qcNo: 'QC/26-27/0013' });
    expect(out).toBe('Moisture, Iron, Raffia, Colour, Non-PET, Shortage');
    expect(out.length).toBeLessThanOrEqual(50);
  });

  it('includes the QC number when the list is short enough', () => {
    expect(buildReasonDetails({ deductions: [DED('MOISTURE', 'Moisture', 1, 5)], shortageAmounts: [], qcNo: 'QC/26-27/0013' })).toBe('Moisture, QC/26-27/0013');
  });

  it('ignores amounts that round to zero and sorts by report order, not input order', () => {
    const out = buildReasonDetails({
      deductions: [DED('RAFFIA', 'Raffia', 60, 5), DED('MOISTURE', 'Moisture', 10, 0.004), DED('IRON_PATTI', 'Iron/Patti', 50, 5)],
      shortageAmounts: [0, '0.00'],
      qcNo: 'Q',
    });
    expect(out).toBe('Iron, Raffia, Q');
  });

  it('falls back to the parameter name and hard-cuts a long list at 50 characters with no dangling comma', () => {
    const many = [
      DED('MOISTURE', 'Moisture', 1, 1),
      DED('DIRTY_BOTTLE', 'Dirty bottle', 2, 1),
      DED('JAR_PET', 'Jar-PET', 3, 1),
      DED('NON_FOOD_GRADE_PET', 'Non Food Grade-PET', 4, 1),
      DED('IRON_PATTI', 'Iron/Patti', 5, 1),
    ];
    const out = buildReasonDetails({ deductions: many, shortageAmounts: [1], qcNo: 'QC/26-27/0013' });
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.startsWith('Moisture, Dirty bottle, Jar, Non Food Grade-PET, ')).toBe(true);
    expect(out).not.toMatch(/[,\s]$/);
    expect(out).not.toContain('QC/');
  });

  it('is empty when nothing was deducted', () => {
    expect(buildReasonDetails({ deductions: [DED('MOISTURE', 'Moisture', 1, 0)], shortageAmounts: [], qcNo: 'Q' })).toBe('');
  });
});

describe('narration', () => {
  it('follows the template and always carries the QC number', () => {
    expect(buildNarration({ qcNo: 'QC/26-27/0013', invoiceNo: 'ECPL/26-27/0632', grnNo: 'DPNL/GRN_RM/2627/4331', truckNo: 'MH 15 XY 1234' })).toBe(
      'QC deduction as per QC/26-27/0013, Inv ECPL/26-27/0632, GRN DPNL/GRN_RM/2627/4331, Truck MH 15 XY 1234',
    );
  });

  it('drops the truck when there is none, and is plain ASCII on one line', () => {
    expect(buildNarration({ qcNo: 'Q', invoiceNo: 'I', grnNo: 'G', truckNo: '  ' })).toBe('QC deduction as per Q, Inv I, GRN G');
    expect(toPlainLine('Debit ₹1,000\n  for  café')).toBe('Debit Rs1,000 for cafe');
  });
});

describe('main item', () => {
  const line = (code: string, w: number | null, item: string | null = null) => ({ code, name: code, ionItemCode: item, invoiceWeightKg: w });
  it('is Clear when the invoice has any Clear', () => {
    expect(pickMainMaterial([line('GREEN', 9000), line('CLEAR', 10)])?.code).toBe('CLEAR');
  });
  it('is the heaviest invoice material when there is no Clear', () => {
    expect(pickMainMaterial([line('GREEN', 500), line('BARWASTE', 900), line('OTHERS', 100)])?.code).toBe('BARWASTE');
    expect(pickMainMaterial([line('CLEAR', 0), line('GREEN', 500)])?.code).toBe('GREEN');
  });
  it('is nothing when no material has an invoice weight', () => {
    expect(pickMainMaterial([line('CLEAR', 0), line('GREEN', null)])).toBeNull();
  });
});

describe('pre-flight', () => {
  it('passes the golden case and builds exactly what the manual run typed', () => {
    const r = runPreflight(golden());
    expect(r.issues).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.payload).toEqual({
      qcNo: 'QC/26-27/0013',
      siteCode: 'DPNL',
      siteAddressLabel: 'DPNL (Bill to Address)',
      voucherDate: '04/11/2026',
      supplierCode: 'CRRM_140290',
      partyAddressLabel: 'CRRM_140290 (Bill to Address)',
      supplierInvoiceNo: 'ECPL/26-27/0632',
      supplierInvoiceDate: '27/10/2026',
      grnNo: 'DPNL/GRN_RM/2627/4331',
      itemCode: 'RM-13001',
      itemCodeSource: 'material',
      amount: '1000.00',
      supplierStateCode: '09',
      supplierStateName: 'Uttar Pradesh',
      interState: true,
      expectedTaxes: [{ code: 'INPUT-IGST 18%', amount: '180.00' }],
      reason: 'Others',
      reasonDetails: 'Moisture, Iron, Raffia, Colour, Non-PET, Shortage',
      gstTransactionType: 'CDN',
      supplierDrCrNo: '.',
      narration: 'QC deduction as per QC/26-27/0013, Inv ECPL/26-27/0632, GRN DPNL/GRN_RM/2627/4331, Truck MH 15 XY 1234',
    });
  });

  it('uses the address code when the supplier has one, otherwise the supplier code', () => {
    const r = runPreflight(golden({ supplier: { ...golden().supplier!, ionAddressCode: 'CRRM_140290_B' } }));
    expect(r.payload?.partyAddressLabel).toBe('CRRM_140290_B (Bill to Address)');
  });

  it('lists every problem at once when nothing is set up', () => {
    const r = runPreflight(
      golden({
        report: { ...golden().report, status: 'PENDING_APPROVAL', approvedTotal: 0, invoiceNumber: null, invoiceDate: null, grnNumber: null },
        plant: null,
        supplier: null,
        materialLines: [],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.payload).toBeNull();
    expect(codes(r)).toEqual(
      expect.arrayContaining(['NOT_APPROVED', 'AMOUNT_NOT_POSITIVE', 'INVOICE_NO_MISSING', 'INVOICE_DATE_MISSING', 'GRN_MISSING', 'PLANT_MISSING', 'SUPPLIER_MISSING', 'NO_INVOICE_MATERIAL']),
    );
  });

  it('blocks a debit larger than the invoice taxable value and shows both figures (the green-shortage-at-Clear-rate case)', () => {
    const r = runPreflight(golden({ report: { ...golden().report, approvedTotal: '350000.00' } }));
    expect(codes(r)).toContain('DEBIT_EXCEEDS_INVOICE');
    const msg = r.issues.find((i) => i.code === 'DEBIT_EXCEEDS_INVOICE')!.message;
    expect(msg).toContain('350000.00');
    expect(msg).toContain('340000.00'); // 10000 x 30 + 2000 x 20
    // equal to the invoice value is allowed
    expect(codes(runPreflight(golden({ report: { ...golden().report, approvedTotal: '340000.00' } })))).not.toContain('DEBIT_EXCEEDS_INVOICE');
    expect(invoiceTaxableValue(golden().materialLines).toFixed(2)).toBe('340000.00');
  });

  it('supports registered suppliers only', () => {
    const r = runPreflight(golden({ supplier: { ...golden().supplier!, gstRegistered: false } }));
    expect(codes(r)).toContain('SUPPLIER_UNREGISTERED');
  });

  it('checks the invoice date is not in the future, and the GRN format', () => {
    expect(codes(runPreflight(golden({ report: { ...golden().report, invoiceDate: '2026-11-05' } })))).toContain('INVOICE_DATE_FUTURE');
    expect(codes(runPreflight(golden({ report: { ...golden().report, invoiceDate: '2026-11-04' } })))).not.toContain('INVOICE_DATE_FUTURE');
    for (const grn of ['4331', 'DPNL/GRN_RM/2627', 'DPNL-GRN_RM-2627-4331']) {
      expect(codes(runPreflight(golden({ report: { ...golden().report, grnNumber: grn } }))), grn).toContain('GRN_FORMAT');
    }
    expect(codes(runPreflight(golden({ report: { ...golden().report, grnNumber: 'DPVP/GRN_RM/2627/12' } })))).not.toContain('GRN_FORMAT');
  });

  it('blocks when an iON push already exists, whatever its status', () => {
    for (const status of ['queued', 'running', 'draft_created', 'submitted', 'failed', 'check_manually']) {
      expect(codes(runPreflight(golden({ existingPush: { status } }))), status).toContain('PUSH_EXISTS');
    }
  });

  it('blocks an imported report whose total differs from the sheet until the admin confirms the amount', () => {
    const mismatch = golden({ report: { ...golden().report, hasMismatch: true } });
    expect(codes(runPreflight(mismatch))).toContain('MISMATCH_UNCONFIRMED');
    expect(runPreflight({ ...mismatch, mismatchConfirmed: true }).ok).toBe(true);
  });

  it('blocks a supplier whose iON state disagrees with the GSTIN, or whose state is unknown', () => {
    const base = golden().supplier!;
    expect(codes(runPreflight(golden({ supplier: { ...base, ionStateCode: '27' } })))).toContain('SUPPLIER_STATE_CONFLICT');
    expect(codes(runPreflight(golden({ supplier: { ...base, ionStateCode: null, gstin: null } })))).toContain('SUPPLIER_STATE_MISSING');
    expect(codes(runPreflight(golden({ supplier: { ...base, ionStateCode: '99', gstin: null } })))).toContain('SUPPLIER_STATE_UNKNOWN');
    expect(codes(runPreflight(golden({ supplier: { ...base, ionSupplierCode: ' ' } })))).toContain('ION_SUPPLIER_CODE_MISSING');
  });

  it('uses the GSTIN state when the iON state is blank', () => {
    const r = runPreflight(golden({ supplier: { ...golden().supplier!, ionStateCode: null } }));
    expect(r.ok).toBe(true);
    expect(r.payload?.supplierStateCode).toBe('09');
  });

  it('keeps same-state suppliers blocked until the CGST/SGST code names are confirmed', () => {
    const maharashtra = golden({ supplier: { ...golden().supplier!, gstin: '27AAAAA0000A1Z5', ionStateCode: '27' } });
    const blocked = runPreflight(maharashtra);
    expect(codes(blocked)).toEqual(['TAX_CODES_UNCONFIRMED']);
    expect(blocked.issues[0]!.message).toContain('INPUT-CGST 9%');

    const confirmed = {
      ...ION_CONFIG,
      intraStateTaxes: ION_CONFIG.intraStateTaxes.map((t) => ({ ...t, confirmed: true })),
    };
    const ok = runPreflight(maharashtra, confirmed);
    expect(ok.ok).toBe(true);
    expect(ok.payload?.interState).toBe(false);
    expect(ok.payload?.expectedTaxes).toEqual([
      { code: 'INPUT-CGST 9%', amount: '90.00' },
      { code: 'INPUT-SGST 9%', amount: '90.00' },
    ]);
  });

  it('needs an item code: the material default, or the per-report override, which wins', () => {
    const noDefault = golden({ materialLines: golden().materialLines.map((l) => ({ ...l, ionItemCode: null })) });
    expect(codes(runPreflight(noDefault))).toContain('ITEM_CODE_MISSING');
    const overridden = runPreflight({ ...noDefault, itemCodeOverride: ' RM-13002 ' });
    expect(overridden.ok).toBe(true);
    expect(overridden.payload).toMatchObject({ itemCode: 'RM-13002', itemCodeSource: 'override' });
    expect(runPreflight({ ...golden(), itemCodeOverride: 'RM-13002' }).payload?.itemCode).toBe('RM-13002');
  });

  it('picks the heaviest invoice material\'s code when the invoice has no Clear', () => {
    const r = runPreflight(golden({ materialLines: [{ code: 'GREEN', name: 'Green', ionItemCode: 'RM-13025', invoiceWeightKg: 5000, invoiceRate: 25 }] }));
    expect(r.payload?.itemCode).toBe('RM-13025');
  });

  it('rounds the amount to 2 decimals and rejects one that rounds to zero', () => {
    expect(runPreflight(golden({ report: { ...golden().report, approvedTotal: '1000.0049' } })).payload?.amount).toBe('1000.00');
    expect(runPreflight(golden({ report: { ...golden().report, approvedTotal: '1000.005' } })).payload?.amount).toBe('1000.01');
    expect(codes(runPreflight(golden({ report: { ...golden().report, approvedTotal: '0.004' } })))).toContain('AMOUNT_NOT_POSITIVE');
    expect(codes(runPreflight(golden({ report: { ...golden().report, approvedTotal: '-5' } })))).toContain('AMOUNT_NOT_POSITIVE');
  });

  it('warns, but does not block, when Reason Details had to be cut', () => {
    const many = [
      DED('MOISTURE', 'Moisture', 1, 1),
      DED('DIRTY_BOTTLE', 'Dirty bottle', 2, 1),
      DED('JAR_PET', 'Jar-PET', 3, 1),
      DED('NON_FOOD_GRADE_PET', 'Non Food Grade-PET', 4, 1),
      DED('IRON_PATTI', 'Iron/Patti', 5, 1),
    ];
    const r = runPreflight(golden({ deductions: many }));
    expect(r.ok).toBe(true);
    expect(codes(r, 'warn')).toEqual(['REASON_DETAILS_TRUNCATED']);
    expect(r.payload!.reasonDetails.length).toBeLessThanOrEqual(50);
  });

  it('blocks a plant that is off or has an unknown state', () => {
    const base = golden().plant!;
    expect(codes(runPreflight(golden({ plant: { ...base, isActive: false } })))).toContain('PLANT_INACTIVE');
    expect(codes(runPreflight(golden({ plant: { ...base, stateCode: '00' } })))).toContain('PLANT_STATE_UNKNOWN');
  });
});
