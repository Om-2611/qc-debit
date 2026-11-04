import { Prisma } from '@prisma/client';
import { ION_CONFIG, type IonConfig } from './config';
import { isoToIon, roundMoney, type MoneyLike } from './money';
import { buildNarration, buildReasonDetails, normalizeGrn, pickMainMaterial, reasonList, type DeductionForReason } from './payload';
import { GST_STATES, resolveSupplierState } from './states';
import { expectedTaxes, taxCodesFor, type ExpectedTax } from './tax';

export interface PreflightInput {
  /** Today in India, "yyyy-mm-dd". Passed in so the check is testable. */
  todayIso: string;
  report: {
    reportNo: string;
    status: string;
    hasMismatch: boolean;
    approvedTotal: MoneyLike;
    invoiceNumber: string | null;
    /** "yyyy-mm-dd" */
    invoiceDate: string | null;
    grnNumber: string | null;
    truckNumber: string | null;
  };
  plant: { code: string; ionSiteCode: string; ionSiteAddressLabel: string; stateCode: string; isActive: boolean } | null;
  supplier: {
    name: string;
    gstin: string | null;
    ionSupplierCode: string | null;
    ionAddressCode: string | null;
    ionStateCode: string | null;
    gstRegistered: boolean;
  } | null;
  materialLines: {
    code: string;
    name: string;
    ionItemCode: string | null;
    invoiceWeightKg: MoneyLike | null;
    invoiceRate: MoneyLike | null;
  }[];
  deductions: DeductionForReason[];
  shortageAmounts: MoneyLike[];
  /** Admin override of the iON item code for this report. */
  itemCodeOverride?: string | null;
  /** The admin ticked "I have checked the amount" for an imported report whose total differs from the sheet's. */
  mismatchConfirmed?: boolean;
  /** The report's iON push when one exists that has not been reset. */
  existingPush: { status: string } | null;
}

export interface PreflightIssue {
  code: string;
  severity: 'block' | 'warn';
  message: string;
}

/** Everything the worker types into iON, fixed at the moment the job is created. */
export interface IonPayload {
  qcNo: string;
  siteCode: string;
  siteAddressLabel: string;
  /** dd/mm/yyyy */
  voucherDate: string;
  supplierCode: string;
  /** e.g. "CRRM_140290 (Bill to Address)" */
  partyAddressLabel: string;
  supplierInvoiceNo: string;
  /** dd/mm/yyyy */
  supplierInvoiceDate: string;
  grnNo: string;
  itemCode: string;
  itemCodeSource: 'override' | 'material';
  /** 2-decimal rupees, taxable value before GST. */
  amount: string;
  /** Used only to decide IGST vs CGST+SGST in pre-flight; the worker re-derives it from the two states shown on the iON screen. */
  supplierStateCode: string;
  interState: boolean;
  expectedTaxes: ExpectedTax[];
  reason: string;
  reasonDetails: string;
  gstTransactionType: string;
  supplierDrCrNo: string;
  narration: string;
}

export interface PreflightResult {
  /** No blocking issue. Warnings do not stop a push. */
  ok: boolean;
  issues: PreflightIssue[];
  /** Present only when ok. */
  payload: IonPayload | null;
}

const hasText = (v: string | null | undefined): v is string => typeof v === 'string' && v.trim() !== '';

/** Sum of invoice weight x invoice rate over the material lines: the invoice's taxable value. */
export function invoiceTaxableValue(lines: PreflightInput['materialLines']): Prisma.Decimal {
  return lines.reduce(
    (acc, l) => acc.plus(new Prisma.Decimal((l.invoiceWeightKg ?? 0).toString()).times((l.invoiceRate ?? 0).toString())),
    new Prisma.Decimal(0),
  );
}

/**
 * Every reason a QC report cannot be loaded on iON yet, all at once (not just the first), plus the payload when there is none.
 * Pure: no database, no clock, no browser.
 */
export function runPreflight(input: PreflightInput, config: IonConfig = ION_CONFIG): PreflightResult {
  const issues: PreflightIssue[] = [];
  const block = (code: string, message: string): void => void issues.push({ code, severity: 'block', message });
  const warn = (code: string, message: string): void => void issues.push({ code, severity: 'warn', message });
  const { report, plant, supplier } = input;

  // ---- the report itself
  if (report.status !== 'APPROVED') block('NOT_APPROVED', 'The QC report has not had its final approval.');
  const amount = roundMoney(report.approvedTotal);
  if (!amount.greaterThan(0)) block('AMOUNT_NOT_POSITIVE', `The approved debit amount is ${amount.toFixed(2)}; it must be above zero.`);
  if (report.hasMismatch && !input.mismatchConfirmed) {
    block('MISMATCH_UNCONFIRMED', 'This imported report\'s total differs from the Excel sheet\'s own. Tick "I have checked the amount" to continue.');
  }
  if (input.existingPush) block('PUSH_EXISTS', `This report already has an iON push (status: ${input.existingPush.status}). Reset it first if it must be redone.`);

  // ---- invoice and GRN
  if (!hasText(report.invoiceNumber)) block('INVOICE_NO_MISSING', 'The invoice number is missing.');
  if (!hasText(report.invoiceDate)) block('INVOICE_DATE_MISSING', 'The invoice date is missing.');
  else if (report.invoiceDate > input.todayIso) block('INVOICE_DATE_FUTURE', `The invoice date ${isoToIon(report.invoiceDate)} is in the future.`);
  if (!hasText(report.grnNumber)) block('GRN_MISSING', 'The GRN number is missing.');
  else if (!config.grnPattern.test(normalizeGrn(report.grnNumber))) {
    block('GRN_FORMAT', `GRN "${report.grnNumber}" does not look like an iON GRN number (e.g. DPNL/GRN_RM/2627/4331).`);
  }

  // ---- plant
  if (!plant) block('PLANT_MISSING', 'The report has no plant. Set it so the iON site is known.');
  else if (!plant.isActive) block('PLANT_INACTIVE', `Plant ${plant.code} is switched off.`);
  else if (!GST_STATES[plant.stateCode]) block('PLANT_STATE_UNKNOWN', `Plant ${plant.code} has an unknown GST state code "${plant.stateCode}".`);

  // ---- supplier
  let supplierStateCode: string | null = null;
  if (!supplier) block('SUPPLIER_MISSING', 'The report has no supplier from the supplier master.');
  else {
    if (!hasText(supplier.ionSupplierCode)) block('ION_SUPPLIER_CODE_MISSING', `Supplier "${supplier.name}" has no iON supplier code.`);
    if (!supplier.gstRegistered) block('SUPPLIER_UNREGISTERED', `Supplier "${supplier.name}" is unregistered (CDNUR); only registered suppliers (CDN) are supported.`);
    const state = resolveSupplierState(supplier);
    if (state.conflict) {
      block('SUPPLIER_STATE_CONFLICT', `Supplier "${supplier.name}": iON master says state ${state.conflict.ion}, but the GSTIN starts with ${state.conflict.gstin}. Correct the supplier master.`);
    } else if (!state.code) block('SUPPLIER_STATE_MISSING', `Supplier "${supplier.name}" has neither an iON state code nor a GSTIN to take the state from.`);
    else if (!GST_STATES[state.code]) block('SUPPLIER_STATE_UNKNOWN', `Supplier "${supplier.name}" has an unknown GST state code "${state.code}".`);
    else supplierStateCode = state.code;
  }

  // ---- item
  const main = pickMainMaterial(input.materialLines);
  const overrideCode = input.itemCodeOverride?.trim() || null;
  let itemCode: string | null = null;
  let itemCodeSource: IonPayload['itemCodeSource'] = 'material';
  if (overrideCode) {
    itemCode = overrideCode;
    itemCodeSource = 'override';
  } else if (!main) block('NO_INVOICE_MATERIAL', 'No material line has an invoice weight, so the main item cannot be chosen.');
  else if (!hasText(main.ionItemCode)) block('ITEM_CODE_MISSING', `Material "${main.name}" has no default iON item code, and no override is set for this report.`);
  else itemCode = main.ionItemCode.trim();

  // ---- amount against the invoice
  const taxable = roundMoney(invoiceTaxableValue(input.materialLines));
  if (amount.greaterThan(taxable)) {
    block('DEBIT_EXCEEDS_INVOICE', `The debit ${amount.toFixed(2)} is more than the invoice's taxable value ${taxable.toFixed(2)} (invoice weight x invoice rate). Check the shortage lines.`);
  }

  // ---- taxes
  const interState = plant && supplierStateCode ? supplierStateCode !== plant.stateCode : null;
  if (interState !== null) {
    const unconfirmed = taxCodesFor(interState, config).filter((t) => !t.confirmed);
    if (unconfirmed.length) block('TAX_CODES_UNCONFIRMED', `The iON tax code names ${unconfirmed.map((t) => `"${t.code}"`).join(' and ')} have not been confirmed yet.`);
  }

  // ---- reason details
  const reasonDetails = buildReasonDetails({ deductions: input.deductions, shortageAmounts: input.shortageAmounts, qcNo: report.reportNo }, config);
  const fullList = reasonList(input, config);
  if (!reasonDetails) block('REASON_DETAILS_EMPTY', 'There is no non-zero deduction to describe in Reason Details.');
  else if (fullList.length > config.reasonDetailsMaxLength) warn('REASON_DETAILS_TRUNCATED', `Reason Details was cut to ${config.reasonDetailsMaxLength} characters: "${reasonDetails}".`);

  const blocking = issues.some((i) => i.severity === 'block');
  if (blocking || !plant || !supplier || !itemCode || interState === null || !supplierStateCode) return { ok: false, issues, payload: null };

  const supplierCode = supplier.ionSupplierCode!.trim();
  // iON shows the party address as "<code> (Bill to Address)"; the code defaults to the supplier code.
  const addressCode = supplier.ionAddressCode?.trim() || supplierCode;
  const payload: IonPayload = {
    qcNo: report.reportNo,
    siteCode: plant.ionSiteCode,
    siteAddressLabel: plant.ionSiteAddressLabel,
    voucherDate: isoToIon(input.todayIso),
    supplierCode,
    partyAddressLabel: `${addressCode} (Bill to Address)`,
    supplierInvoiceNo: report.invoiceNumber!.trim(),
    supplierInvoiceDate: isoToIon(report.invoiceDate!),
    grnNo: normalizeGrn(report.grnNumber!),
    itemCode,
    itemCodeSource,
    amount: amount.toFixed(2),
    supplierStateCode,
    interState,
    expectedTaxes: expectedTaxes(amount, interState, config),
    reason: config.reason,
    reasonDetails,
    gstTransactionType: config.gstTransactionType,
    supplierDrCrNo: config.supplierDrCrNo,
    narration: buildNarration({ qcNo: report.reportNo, invoiceNo: report.invoiceNumber!, grnNo: normalizeGrn(report.grnNumber!), truckNo: report.truckNumber }),
  };
  return { ok: true, issues, payload };
}
