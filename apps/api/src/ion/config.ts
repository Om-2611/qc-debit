/**
 * Every tunable value of the TCS iON push, in one place. Nothing here is a secret.
 * Values marked UNCONFIRMED are our best guess and keep the pre-flight red until the accountant confirms them.
 */
export interface IonTaxCode {
  code: string;
  ratePercent: number;
  /** false = name not yet confirmed against iON; pre-flight refuses to push a report that needs it. */
  confirmed: boolean;
}

export interface IonConfig {
  /** Ledger iON pre-fills on the item (GRIR - Raw Material); the worker verifies it. */
  grirLedger: string;
  /** Supplier in a different state from the plant. */
  interStateTaxes: IonTaxCode[];
  /** Supplier in the plant's state. UNCONFIRMED names. */
  intraStateTaxes: IonTaxCode[];
  /** Text of the TDS line iON adds on its own. */
  tdsTaxCodeText: string;
  /** Delete that TDS line (our team's notes carry only the GST line). The accountant still has to confirm. */
  deleteTdsLine: boolean;
  /** Delete the zero-amount item lines of the invoice. Unconfirmed, so off. Must run before Item Expense. */
  deleteZeroItemLines: boolean;
  reason: string;
  supplierDrCrNo: string;
  /** CDN = registered supplier. CDNUR (unregistered) is not supported yet. */
  gstTransactionType: 'CDN';
  voucherType: string;
  voucherSubType: string;
  reasonDetailsMaxLength: number;
  /** Largest accepted difference between iON's tax line and ours, per line, in rupees (rounding). */
  taxToleranceRupees: number;
  /** e.g. DPNL/GRN_RM/2627/4331 */
  grnPattern: RegExp;
  /** Short names our team writes in Reason Details; a parameter not listed falls back to its own name. UNCONFIRMED wording. */
  reasonLabels: Record<string, string>;
  shortageLabel: string;
}

export const ION_CONFIG: IonConfig = {
  grirLedger: 'CL-CFIL-GRIR100420',
  interStateTaxes: [{ code: 'INPUT-IGST 18%', ratePercent: 18, confirmed: true }],
  intraStateTaxes: [
    { code: 'INPUT-CGST 9%', ratePercent: 9, confirmed: false },
    { code: 'INPUT-SGST 9%', ratePercent: 9, confirmed: false },
  ],
  tdsTaxCodeText: '393 1031 TDS ON Purchase 0.1%',
  deleteTdsLine: true,
  deleteZeroItemLines: false,
  reason: 'Others',
  supplierDrCrNo: '.',
  gstTransactionType: 'CDN',
  voucherType: 'Debit Note',
  voucherSubType: 'Debit Note',
  reasonDetailsMaxLength: 50,
  taxToleranceRupees: 0.01,
  grnPattern: /^[A-Z0-9]+\/GRN_[A-Z]+\/\d{4}\/\d+$/i,
  reasonLabels: {
    MOISTURE: 'Moisture',
    DIRTY_BOTTLE: 'Dirty bottle',
    JAR_PET: 'Jar',
    IRON_PATTI: 'Iron',
    RAFFIA: 'Raffia',
    COLOUR_BOTTLE_PET: 'Colour',
    NON_PET: 'Non-PET',
    ALUMINIUM_PET: 'Aluminium',
  },
  shortageLabel: 'Shortage',
};
