import { describe, expect, it } from 'vitest';
import {
  REPORT_SECTIONS,
  REPORT_STATUSES,
  ROLES,
  canCreateReport,
  canEditSection,
  canPerformAction,
} from '../src';

describe('section ownership', () => {
  it('GATE owns the header and the supplier-invoice rows, never the Dalmia rows', () => {
    expect(canEditSection('GATE', 'DRAFT', 'header').allowed).toBe(true);
    expect(canEditSection('GATE', 'DRAFT', 'invoiceWeights').allowed).toBe(true);
    expect(canEditSection('GATE', 'INVOICE_ENTERED', 'header').allowed).toBe(true);
    expect(canEditSection('GATE', 'WEIGHTS_ENTERED', 'header').allowed).toBe(true);
    expect(canEditSection('GATE', 'INVOICE_ENTERED', 'invoiceWeights').allowed).toBe(false);
    for (const status of REPORT_STATUSES) expect(canEditSection('GATE', status, 'dalmiaWeights').allowed).toBe(false);
    expect(canEditSection('GATE', 'DRAFT', 'qc').allowed).toBe(false);
    expect(canEditSection('GATE', 'PENDING_APPROVAL', 'approval').allowed).toBe(false);
  });

  it('RM_STORE owns only the "As per Dalmia" rows, once the gate has submitted', () => {
    expect(canEditSection('RM_STORE', 'DRAFT', 'dalmiaWeights').allowed).toBe(false);
    expect(canEditSection('RM_STORE', 'INVOICE_ENTERED', 'dalmiaWeights').allowed).toBe(true);
    expect(canEditSection('RM_STORE', 'WEIGHTS_ENTERED', 'dalmiaWeights').allowed).toBe(false);
    for (const section of ['header', 'invoiceWeights', 'qc', 'grn', 'approval'] as const) {
      for (const status of REPORT_STATUSES) expect(canEditSection('RM_STORE', status, section).allowed).toBe(false);
    }
  });

  it('STORES owns only the GRN, once QC has been submitted', () => {
    expect(canEditSection('STORES', 'WEIGHTS_ENTERED', 'grn').allowed).toBe(false);
    expect(canEditSection('STORES', 'QC_ENTERED', 'grn').allowed).toBe(true);
    expect(canEditSection('STORES', 'PENDING_APPROVAL', 'grn').allowed).toBe(false);
    for (const section of ['header', 'invoiceWeights', 'dalmiaWeights', 'qc', 'approval'] as const) {
      for (const status of REPORT_STATUSES) expect(canEditSection('STORES', status, section).allowed).toBe(false);
    }
    expect(canEditSection('QC_ANALYST', 'QC_ENTERED', 'grn').allowed).toBe(false);
  });

  it('QC_ANALYST edits QC once weights are in, and again after a send-back', () => {
    expect(canEditSection('QC_ANALYST', 'DRAFT', 'qc').allowed).toBe(false);
    expect(canEditSection('QC_ANALYST', 'WEIGHTS_ENTERED', 'qc').allowed).toBe(true);
    expect(canEditSection('QC_ANALYST', 'QC_ENTERED', 'qc').allowed).toBe(true);
    expect(canEditSection('QC_ANALYST', 'PENDING_APPROVAL', 'qc').allowed).toBe(false);
    expect(canEditSection('QC_ANALYST', 'WEIGHTS_ENTERED', 'dalmiaWeights').allowed).toBe(false);
    expect(canEditSection('QC_ANALYST', 'INVOICE_ENTERED', 'qc').allowed).toBe(false);
    expect(canEditSection('QC_ANALYST', 'PENDING_APPROVAL', 'approval').allowed).toBe(false);
  });

  it('QC_MANAGER edits only the approval section, only while pending', () => {
    expect(canEditSection('QC_MANAGER', 'PENDING_APPROVAL', 'approval').allowed).toBe(true);
    expect(canEditSection('QC_MANAGER', 'QC_ENTERED', 'approval').allowed).toBe(false);
    expect(canEditSection('QC_MANAGER', 'PENDING_APPROVAL', 'qc').allowed).toBe(false);
  });

  it('nobody — not even ADMIN — edits an APPROVED report', () => {
    for (const role of ROLES) {
      for (const section of REPORT_SECTIONS) {
        const result = canEditSection(role, 'APPROVED', section);
        expect(result.allowed).toBe(false);
        expect(result.reason).toBeTruthy();
      }
    }
  });

  it('ADMIN can edit any section of an in-progress report', () => {
    for (const status of REPORT_STATUSES.filter((s) => s !== 'APPROVED')) {
      for (const section of REPORT_SECTIONS) {
        expect(canEditSection('ADMIN', status, section).allowed).toBe(true);
      }
    }
  });
});

describe('workflow actions', () => {
  it('follows DRAFT → INVOICE_ENTERED → WEIGHTS_ENTERED → QC_ENTERED → PENDING_APPROVAL → APPROVED', () => {
    expect(canPerformAction('STORES', 'QC_ENTERED', 'submitGrn').allowed).toBe(true);
    expect(canPerformAction('STORES', 'WEIGHTS_ENTERED', 'submitGrn').allowed).toBe(false);
    expect(canPerformAction('QC_ANALYST', 'QC_ENTERED', 'submitGrn').allowed).toBe(false);
    expect(canPerformAction('GATE', 'DRAFT', 'submitInvoice').allowed).toBe(true);
    expect(canPerformAction('GATE', 'INVOICE_ENTERED', 'submitInvoice').allowed).toBe(false);
    expect(canPerformAction('RM_STORE', 'INVOICE_ENTERED', 'submitWeights').allowed).toBe(true);
    expect(canPerformAction('RM_STORE', 'DRAFT', 'submitWeights').allowed).toBe(false);
    expect(canPerformAction('GATE', 'INVOICE_ENTERED', 'submitWeights').allowed).toBe(false);
    expect(canPerformAction('QC_ANALYST', 'WEIGHTS_ENTERED', 'submitQc').allowed).toBe(true);
    expect(canPerformAction('QC_ANALYST', 'QC_ENTERED', 'submitQc').allowed).toBe(true);
    expect(canPerformAction('QC_ANALYST', 'DRAFT', 'submitQc').allowed).toBe(false);
    expect(canPerformAction('QC_MANAGER', 'PENDING_APPROVAL', 'approve').allowed).toBe(true);
    expect(canPerformAction('QC_MANAGER', 'PENDING_APPROVAL', 'sendBack').allowed).toBe(true);
    expect(canPerformAction('QC_MANAGER', 'QC_ENTERED', 'approve').allowed).toBe(false);
  });

  it('roles cannot perform each other’s actions', () => {
    expect(canPerformAction('QC_ANALYST', 'INVOICE_ENTERED', 'submitWeights').allowed).toBe(false);
    expect(canPerformAction('RM_STORE', 'DRAFT', 'submitInvoice').allowed).toBe(false);
    expect(canPerformAction('GATE', 'WEIGHTS_ENTERED', 'submitQc').allowed).toBe(false);
    expect(canPerformAction('QC_ANALYST', 'PENDING_APPROVAL', 'approve').allowed).toBe(false);
    expect(canPerformAction('GATE', 'PENDING_APPROVAL', 'sendBack').allowed).toBe(false);
  });

  it('only ADMIN reopens, and only an APPROVED report', () => {
    expect(canPerformAction('ADMIN', 'APPROVED', 'reopen').allowed).toBe(true);
    expect(canPerformAction('QC_MANAGER', 'APPROVED', 'reopen').allowed).toBe(false);
    expect(canPerformAction('ADMIN', 'PENDING_APPROVAL', 'reopen').allowed).toBe(false);
  });

  it('ADMIN can act as any role, but still only in the right status', () => {
    expect(canPerformAction('ADMIN', 'DRAFT', 'submitInvoice').allowed).toBe(true);
    expect(canPerformAction('ADMIN', 'INVOICE_ENTERED', 'submitWeights').allowed).toBe(true);
    expect(canPerformAction('ADMIN', 'PENDING_APPROVAL', 'approve').allowed).toBe(true);
    expect(canPerformAction('ADMIN', 'DRAFT', 'approve').allowed).toBe(false);
  });

  it('only GATE and ADMIN create reports', () => {
    expect(ROLES.filter(canCreateReport)).toEqual(['GATE', 'ADMIN']);
  });
});
