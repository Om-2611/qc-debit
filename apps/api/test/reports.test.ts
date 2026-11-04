import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sampleReportInput } from '@dalmia/calc';
import type { ReportDto } from '@dalmia/types';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
const sample = sampleReportInput();
let gate: Session, store: Session, analyst: Session, stores: Session, manager: Session, admin: Session;
let supplierId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  supplierId = (await prisma.supplier.create({ data: { name: 'ABC', code: 'ABC' } })).id;
  [gate, store, analyst, stores, manager, admin] = await Promise.all([
    login(app, 'GATE'),
    login(app, 'RM_STORE'),
    login(app, 'QC_ANALYST'),
    login(app, 'STORES'),
    login(app, 'QC_MANAGER'),
    login(app, 'ADMIN'),
  ]);
});
beforeEach(async () => {
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const weightsBody = {
  materials: sample.materials.map(({ name: _n, ...m }) => m),
};
type MaterialPatch = Record<string, string | number | null>;
const onlyFields = (prefix: 'invoice' | 'dalmia', materials: MaterialPatch[] = weightsBody.materials) => ({
  materials: materials.map((m) => Object.fromEntries(Object.entries(m).filter(([k]) => k === 'code' || (prefix === 'invoice' ? k.startsWith('invoice') || k === 'dalmiaRate' : k === 'dalmiaWeightKg' || k === 'dalmiaBales')))),
});
/** Gate: "As per Supplier Invoice" rows. */
const invoiceBody = onlyFields('invoice');
/** Raw Material Store: "As per Dalmia" rows. */
const dalmiaBody = onlyFields('dalmia');

/** Both desks do their part: gate → submit invoice → store → submit weights. Leaves the report WEIGHTS_ENTERED. */
async function enterWeights(id: string, materials: MaterialPatch[] = weightsBody.materials): Promise<ReportDto> {
  expect((await request(app).patch(`/api/reports/${id}/weights`).set(gate.auth).send(onlyFields('invoice', materials))).status).toBe(200);
  expect((await request(app).post(`/api/reports/${id}/submit-invoice`).set(gate.auth)).status).toBe(200);
  expect((await request(app).patch(`/api/reports/${id}/weights`).set(store.auth).send(onlyFields('dalmia', materials))).status).toBe(200);
  const res = await request(app).post(`/api/reports/${id}/submit-weights`).set(store.auth);
  expect(res.status).toBe(200);
  return res.body;
}
const qcBody = {
  baleWeightsKg: sample.baleWeightsKg,
  readings: sample.readings.map((r) => ({ parameterCode: r.parameterCode, perBale: r.perBale })),
};
const approvalBody = {
  adjustments: sample.readings.map((r) => ({ parameterCode: r.parameterCode, purchaseAdjustment: r.purchaseAdjustment ?? 0 })),
  remarks: 'Concession agreed with purchase.',
};

async function createDraft(session: Session = gate): Promise<ReportDto> {
  const res = await request(app)
    .post('/api/reports')
    .set(session.auth)
    .send({ reportDate: '2025-08-12', supplierId, truckNumber: 'MH 15 XY 1234', invoiceNumber: 'INV-9' });
  expect(res.status).toBe(201);
  return res.body;
}

async function toPendingApproval(): Promise<ReportDto> {
  const draft = await createDraft();
  await enterWeights(draft.id);
  expect((await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send(qcBody)).status).toBe(200);
  const qcDone = await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(analyst.auth);
  expect(qcDone.status).toBe(200);
  expect(qcDone.body.status).toBe('QC_ENTERED'); // waiting for Stores
  expect((await request(app).patch(`/api/reports/${draft.id}/grn`).set(stores.auth).send({ grnNumber: 'GRN-77' })).status).toBe(200);
  expect((await request(app).post(`/api/reports/${draft.id}/submit-grn`).set(stores.auth)).status).toBe(200);
  // Read back as the manager: the analyst's copy has rates and amounts stripped.
  return (await request(app).get(`/api/reports/${draft.id}`).set(manager.auth)).body;
}

describe('full lifecycle with the workbook sample', () => {
  it('DRAFT → INVOICE_ENTERED → WEIGHTS_ENTERED → QC_ENTERED → PENDING_APPROVAL → APPROVED with the sheet’s totals', async () => {
    const draft = await createDraft();
    expect(draft.status).toBe('DRAFT');
    expect(draft.reportNo).toBe('QC/25-26/0001');
    expect(draft.partyNameRaw).toBe('ABC'); // defaulted from the supplier
    expect(draft.weightTolerancePercent).toBeNull(); // no default setting seeded in tests
    expect(draft.materials.map((m) => m.code)).toEqual(['CLEAR', 'GREEN', 'BARWASTE', 'BARWASTE_WITH_RING', 'OTHERS']);

    const pending = await toPendingApproval();
    expect(pending.status).toBe('PENDING_APPROVAL');
    expect(pending.checkedBy?.name).toBe('QC_ANALYST user');
    // Before purchase enters any allowance, only the weight shortage is approved.
    expect(pending.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    expect(pending.output.grandTotal.approvedAmount).toBeCloseTo(10900, 2);

    const adjusted = await request(app).patch(`/api/reports/${pending.id}/approval`).set(manager.auth).send(approvalBody);
    expect(adjusted.status).toBe(200);
    expect(adjusted.body.output.grandTotal.approvedAmount).toBeCloseTo(19160.84, 2);

    const approved = await request(app).post(`/api/reports/${pending.id}/approve`).set(manager.auth);
    expect(approved.status).toBe(200);
    const dto: ReportDto = approved.body;
    expect(dto.status).toBe('APPROVED');
    expect(dto.outputIsSnapshot).toBe(true);
    expect(dto.approvedBy?.name).toBe('QC_MANAGER user');
    expect(dto.output.subtotals.contamination.standardAmount).toBeCloseTo(40918.86, 2);
    expect(dto.output.subtotals.contamination.approvedAmount).toBeCloseTo(8260.84, 2);
    expect(dto.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    expect(dto.output.grandTotal.approvedAmount).toBeCloseTo(19160.84, 2);
    expect(dto.narration).toContain('Moisture-6161 (51.35*120)');
    expect(dto.narration).toContain('and GRN No. GRN-77.');

    const list = await request(app).get('/api/reports?status=APPROVED').set(gate.auth);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0]).toMatchObject({ status: 'APPROVED', supplierName: 'ABC', truckNumber: 'MH 15 XY 1234' });
    expect(list.body.items[0].approvedTotal).toBeCloseTo(19160.84, 2);
  });

  it('an approved report keeps its figures when norms change later', async () => {
    const pending = await toPendingApproval();
    await request(app).post(`/api/reports/${pending.id}/approve`).set(manager.auth);

    const moisture = await prisma.parameter.findUniqueOrThrow({ where: { code: 'MOISTURE' }, include: { norms: true } });
    const monsoon = moisture.norms.find((n) => n.seasonStartMonth === 7)!;
    await prisma.normRule.update({ where: { id: monsoon.id }, data: { normPercent: 1 } });
    try {
      const after = await request(app).get(`/api/reports/${pending.id}`).set(gate.auth);
      const row = after.body.output.parameters.find((p: { parameterCode: string }) => p.parameterCode === 'MOISTURE');
      expect(row.normPercent).toBe(5);
      expect(row.standardAmount).toBeCloseTo(33545.4, 2);
      expect(after.body.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    } finally {
      await prisma.normRule.update({ where: { id: monsoon.id }, data: { normPercent: 5 } });
    }
  });

  it('never trusts client-side numbers: totals sent in the body are ignored', async () => {
    const draft = await createDraft();
    const res = await request(app)
      .patch(`/api/reports/${draft.id}/weights`)
      .set(admin.auth)
      .send({ ...weightsBody, standardTotal: 1, output: { grandTotal: { standardAmount: 1 } } });
    expect(res.status).toBe(200);
    expect(res.body.output.shortage.subtotal.standardAmount).toBeCloseTo(10900, 2);
    const row = await prisma.report.findUniqueOrThrow({ where: { id: draft.id } });
    expect(row.standardTotal.toNumber()).toBeCloseTo(10900, 2);
  });
});

describe('section guards (403 with a clear message)', () => {
  it('only GATE and ADMIN create reports', async () => {
    for (const s of [analyst, manager]) {
      const res = await request(app).post('/api/reports').set(s.auth).send({ reportDate: '2025-08-12' });
      expect(res.status).toBe(403);
    }
    expect((await request(app).post('/api/reports').set(admin.auth).send({ reportDate: '2025-08-12' })).status).toBe(201);
  });

  it('roles cannot edit sections they do not own', async () => {
    const draft = await createDraft();
    const asAnalyst = await request(app).patch(`/api/reports/${draft.id}/weights`).set(analyst.auth).send(invoiceBody);
    expect(asAnalyst.status).toBe(403);
    expect(asAnalyst.body.message).toMatch(/GATE/);
    // The gate cannot type the "As per Dalmia" rows, even mixed into a save of its own rows…
    const gateOnDalmia = await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send(weightsBody);
    expect(gateOnDalmia.status).toBe(403);
    expect(gateOnDalmia.body.message).toMatch(/RM_STORE/);
    // …and the store cannot type the supplier-invoice rows, or start before the gate has submitted.
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(store.auth).send(invoiceBody)).status).toBe(403);
    const storeEarly = await request(app).patch(`/api/reports/${draft.id}/weights`).set(store.auth).send(dalmiaBody);
    expect(storeEarly.status).toBe(403);
    expect(storeEarly.body.message).toMatch(/DRAFT/);
    expect((await request(app).patch(`/api/reports/${draft.id}/header`).set(store.auth).send({ poNumber: 'X' })).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/qc`).set(gate.auth).send(qcBody)).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/approval`).set(analyst.auth).send(approvalBody)).status).toBe(403);
  });

  it('sections lock once the status moves on', async () => {
    const draft = await createDraft();
    // QC cannot start before weights are submitted.
    const early = await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send(qcBody);
    expect(early.status).toBe(403);
    expect(early.body.message).toMatch(/DRAFT/);

    // Gate submits → its rows lock and the store's rows open.
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send(invoiceBody);
    const handed = await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(gate.auth);
    expect(handed.body.status).toBe('INVOICE_ENTERED');
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send(invoiceBody)).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send(qcBody)).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(store.auth).send(dalmiaBody)).status).toBe(200);
    // Store submits → its rows lock too; the gate's header is still open.
    expect((await request(app).post(`/api/reports/${draft.id}/submit-weights`).set(store.auth)).body.status).toBe('WEIGHTS_ENTERED');
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(store.auth).send(dalmiaBody)).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/header`).set(gate.auth).send({ poNumber: 'PO-5' })).status).toBe(200);
    // The manager cannot enter concessions before QC is submitted.
    expect((await request(app).patch(`/api/reports/${draft.id}/approval`).set(manager.auth).send(approvalBody)).status).toBe(403);
  });

  it('workflow actions are limited by role and status', async () => {
    const draft = await createDraft();
    expect((await request(app).post(`/api/reports/${draft.id}/approve`).set(manager.auth)).status).toBe(403);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(store.auth)).status).toBe(403);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-weights`).set(gate.auth)).status).toBe(403);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-weights`).set(store.auth)).status).toBe(403); // still DRAFT

    const pending = await toPendingApproval();
    expect((await request(app).post(`/api/reports/${pending.id}/approve`).set(analyst.auth)).status).toBe(403);
    expect((await request(app).post(`/api/reports/${pending.id}/approve`).set(gate.auth)).status).toBe(403);
  });

  it('APPROVED is read-only for everyone, including ADMIN, until reopened', async () => {
    const pending = await toPendingApproval();
    await request(app).post(`/api/reports/${pending.id}/approve`).set(manager.auth);

    for (const s of [gate, store, analyst, stores, manager, admin]) {
      const res = await request(app).patch(`/api/reports/${pending.id}/approval`).set(s.auth).send({ remarks: 'x' });
      expect(res.status).toBe(403);
    }
    expect((await request(app).post(`/api/reports/${pending.id}/reopen`).set(manager.auth).send({ reason: 'typo in rate' })).status).toBe(403);
    expect((await request(app).post(`/api/reports/${pending.id}/reopen`).set(admin.auth).send({})).status).toBe(400);

    const reopened = await request(app).post(`/api/reports/${pending.id}/reopen`).set(admin.auth).send({ reason: 'Typo in rate' });
    expect(reopened.status).toBe(200);
    expect(reopened.body).toMatchObject({ status: 'PENDING_APPROVAL', reopenReason: 'Typo in rate', approvedBy: null, narration: null });
    expect((await request(app).patch(`/api/reports/${pending.id}/approval`).set(manager.auth).send({ remarks: 'ok' })).status).toBe(200);
  });

  it('admin can act as any role on an in-progress report', async () => {
    const draft = await createDraft(admin);
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(admin.auth).send(weightsBody)).status).toBe(200);
    expect((await request(app).patch(`/api/reports/${draft.id}/qc`).set(admin.auth).send(qcBody)).status).toBe(200);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(admin.auth)).status).toBe(200);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-weights`).set(admin.auth)).status).toBe(200);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(admin.auth)).status).toBe(200);
    expect((await request(app).patch(`/api/reports/${draft.id}/grn`).set(admin.auth).send({ grnNumber: 'GRN-ADM' })).status).toBe(200);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-grn`).set(admin.auth)).status).toBe(200);
    expect((await request(app).post(`/api/reports/${draft.id}/approve`).set(admin.auth)).status).toBe(200);
  });
});

describe('Stores: the GRN step', () => {
  async function qcSubmitted(): Promise<ReportDto> {
    const draft = await createDraft();
    await enterWeights(draft.id);
    await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send(qcBody);
    return (await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(analyst.auth)).body;
  }

  it('after QC the report waits for Stores; Stores can only type the GRN and only then', async () => {
    const report = await qcSubmitted();
    expect(report.status).toBe('QC_ENTERED');
    expect((await request(app).get('/api/reports?status=PENDING_APPROVAL').set(manager.auth)).body.total).toBe(0);
    // Stores has nothing to do with the other sections…
    expect((await request(app).patch(`/api/reports/${report.id}/qc`).set(stores.auth).send(qcBody)).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${report.id}/header`).set(stores.auth).send({ poNumber: 'X' })).status).toBe(403);
    // …and cannot forward without a GRN.
    const blocked = await request(app).post(`/api/reports/${report.id}/submit-grn`).set(stores.auth);
    expect(blocked.status).toBe(400);
    expect(blocked.body.details).toEqual(['Enter the GRN number.']);

    expect((await request(app).patch(`/api/reports/${report.id}/grn`).set(stores.auth).send({ grnNumber: 'GRN-S1' })).status).toBe(200);
    const sent = await request(app).post(`/api/reports/${report.id}/submit-grn`).set(stores.auth);
    expect(sent.body.status).toBe('PENDING_APPROVAL');
    expect(sent.body.grnNumber).toBe('GRN-S1');
    // Now locked for Stores; the manager's queue has it.
    expect((await request(app).patch(`/api/reports/${report.id}/grn`).set(stores.auth).send({ grnNumber: 'GRN-S2' })).status).toBe(403);
    expect((await request(app).get('/api/reports?status=PENDING_APPROVAL').set(manager.auth)).body.total).toBe(1);
    const rows = await prisma.auditLog.findMany({ where: { reportId: report.id, action: 'STATUS_CHANGE' }, orderBy: { at: 'asc' } });
    expect(rows.map((r) => `${r.oldValue}→${r.newValue}`)).toContain('QC_ENTERED→PENDING_APPROVAL');
  });

  it('Stores cannot forward before the analyst has submitted QC', async () => {
    const draft = await createDraft();
    await enterWeights(draft.id);
    expect((await request(app).patch(`/api/reports/${draft.id}/grn`).set(stores.auth).send({ grnNumber: 'G' })).status).toBe(403);
    expect((await request(app).post(`/api/reports/${draft.id}/submit-grn`).set(stores.auth)).status).toBe(403);
  });

  it('approval needs the GRN even if an admin skipped the Stores step', async () => {
    const report = await qcSubmitted();
    // An admin can push the status on, but the GRN rule still holds at approval.
    await prisma.report.update({ where: { id: report.id }, data: { status: 'PENDING_APPROVAL' } });
    const blocked = await request(app).post(`/api/reports/${report.id}/approve`).set(manager.auth);
    expect(blocked.status).toBe(400);
    expect(blocked.body.details).toContain('Enter the GRN number.');
  });
});

describe('send back', () => {
  it('returns the report to the analyst with the manager’s note', async () => {
    const pending = await toPendingApproval();
    expect((await request(app).post(`/api/reports/${pending.id}/send-back`).set(manager.auth).send({ note: '' })).status).toBe(400);

    const back = await request(app).post(`/api/reports/${pending.id}/send-back`).set(manager.auth).send({ note: 'Re-check bale 2 moisture' });
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ status: 'QC_ENTERED', sentBackNote: 'Re-check bale 2 moisture' });

    const list = await request(app).get('/api/reports?status=QC_ENTERED').set(analyst.auth);
    expect(list.body.items[0].sentBack).toBe(true);

    const fix = await request(app)
      .patch(`/api/reports/${pending.id}/qc`)
      .set(analyst.auth)
      .send({ readings: [{ parameterCode: 'MOISTURE', perBale: [9.52, 6.0, null] }] });
    expect(fix.status).toBe(200);
    const again = await request(app).post(`/api/reports/${pending.id}/submit-qc`).set(analyst.auth);
    expect(again.body.status).toBe('PENDING_APPROVAL'); // the GRN is already there, so Stores is not asked again
  });
});

describe('validation', () => {
  it('each desk is told what is missing from its own part', async () => {
    const res0 = await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2025-08-12' });
    const res = await request(app).post(`/api/reports/${res0.body.id}/submit-invoice`).set(gate.auth);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INCOMPLETE');
    expect(res.body.details).toEqual(['Party name is required.', 'Enter the truck number.', 'Enter at least one supplier invoice weight.']);

    const draft = await createDraft();
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send(invoiceBody);
    await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(gate.auth);
    const fromStore = await request(app).post(`/api/reports/${draft.id}/submit-weights`).set(store.auth);
    expect(fromStore.status).toBe(400);
    expect(fromStore.body.details[0]).toBe('Enter at least one Dalmia weight.');
    // Neither the gate nor the RM store sets the GRN: that is Stores' step, after QC.
    expect((await request(app).patch(`/api/reports/${draft.id}/grn`).set(gate.auth).send({ grnNumber: 'X' })).status).toBe(403);
    expect((await request(app).patch(`/api/reports/${draft.id}/grn`).set(store.auth).send({ grnNumber: 'X' })).status).toBe(403);
  });

  it('a material with an invoice weight needs the Dalmia rate from the gate', async () => {
    const draft = await createDraft();
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', invoiceWeightKg: 1000 }] });
    // The Dalmia rate comes from the PO, so the gate must give it before handing over.
    const res = await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(gate.auth);
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(['Clear: enter the Dalmia rate (from the PO).']);
    // …and the store cannot type it.
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', dalmiaRate: 120 }] });
    await request(app).post(`/api/reports/${draft.id}/submit-invoice`).set(gate.auth);
    expect((await request(app).patch(`/api/reports/${draft.id}/weights`).set(store.auth).send({ materials: [{ code: 'CLEAR', dalmiaRate: 125 }] })).status).toBe(403);
  });

  it('submit-qc needs a bale weight, and kg readings need their bale’s weight', async () => {
    const draft = await createDraft();
    await enterWeights(draft.id);
    const empty = await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(analyst.auth);
    expect(empty.status).toBe(400);
    expect(empty.body.details).toContain('Enter at least one sample bale weight.');

    await request(app)
      .patch(`/api/reports/${draft.id}/qc`)
      .set(analyst.auth)
      .send({ baleWeightsKg: [99, null, null], readings: [{ parameterCode: 'RAFFIA', perBale: [0.1, 0.2, null] }] });
    const partial = await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(analyst.auth);
    expect(partial.body.details).toEqual(['Bale 2 has readings but no bale weight.']);
  });

  it('rejects negative weights, >100% moisture, unknown codes and unknown suppliers', async () => {
    const draft = await createDraft();
    const neg = await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', invoiceWeightKg: -5 }] });
    expect(neg.status).toBe(400);
    const unknown = await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'GOLD', invoiceWeightKg: 5 }] });
    expect(unknown.status).toBe(400);
    const supplier = await request(app).patch(`/api/reports/${draft.id}/header`).set(gate.auth).send({ supplierId: 'nope' });
    expect(supplier.status).toBe(400);

    await enterWeights(draft.id);
    const wet = await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send({ readings: [{ parameterCode: 'MOISTURE', perBale: [120] }] });
    expect(wet.status).toBe(400);
  });

  it('“Other (Please Specify)” needs a description before approval', async () => {
    const draft = await createDraft();
    await enterWeights(draft.id, [
      ...weightsBody.materials.filter((m) => m.code !== 'OTHERS'),
      { code: 'OTHERS', invoiceWeightKg: 100, dalmiaWeightKg: 90, dalmiaRate: 40 },
    ]);
    await request(app).patch(`/api/reports/${draft.id}/qc`).set(analyst.auth).send(qcBody);
    await request(app).post(`/api/reports/${draft.id}/submit-qc`).set(analyst.auth);
    await request(app).patch(`/api/reports/${draft.id}/grn`).set(stores.auth).send({ grnNumber: 'GRN-OTH' });
    await request(app).post(`/api/reports/${draft.id}/submit-grn`).set(stores.auth);

    const blocked = await request(app).post(`/api/reports/${draft.id}/approve`).set(manager.auth);
    expect(blocked.status).toBe(400);
    await request(app)
      .patch(`/api/reports/${draft.id}/approval`)
      .set(manager.auth)
      .send({ otherDescriptions: [{ materialCode: 'OTHERS', description: 'HDPE caps' }] });
    expect((await request(app).post(`/api/reports/${draft.id}/approve`).set(manager.auth)).status).toBe(200);
  });

  it('a stale save is rejected with 409', async () => {
    const draft = await createDraft();
    const first = await request(app).patch(`/api/reports/${draft.id}/header`).set(gate.auth).send({ poNumber: 'A', updatedAt: draft.updatedAt });
    expect(first.status).toBe(200);
    const stale = await request(app).patch(`/api/reports/${draft.id}/header`).set(gate.auth).send({ poNumber: 'B', updatedAt: draft.updatedAt });
    expect(stale.status).toBe(409);
  });
});

describe('rules taken from the workbook', () => {
  const dirtyFivePercent = { parameterCode: 'DIRTY_BOTTLE', perBale: [4.95, 4.8, null] };

  async function toWeightsEntered(): Promise<ReportDto> {
    const draft = await createDraft();
    return enterWeights(draft.id);
  }

  it('Dirty bottle is charged per affected bale (sheet column M), and the count is required when over norm', async () => {
    const report = await toWeightsEntered();
    await request(app)
      .patch(`/api/reports/${report.id}/qc`)
      .set(analyst.auth)
      .send({ baleWeightsKg: [99, 96, null], readings: [dirtyFivePercent] });

    const blocked = await request(app).post(`/api/reports/${report.id}/submit-qc`).set(analyst.auth);
    expect(blocked.status).toBe(400);
    expect(blocked.body.details).toEqual(['Dirty bottle is above norm: enter the number of bales affected.']);

    const saved = await request(app)
      .patch(`/api/reports/${report.id}/qc`)
      .set(analyst.auth)
      .send({ readings: [{ parameterCode: 'DIRTY_BOTTLE', affectedBales: 10 }] });
    expect(saved.status).toBe(200);
    expect(saved.body.ratesHidden).toBe(true); // the analyst never sees the amount…
    const asAdmin = await request(app).get(`/api/reports/${report.id}`).set(admin.auth); // …but it is there
    const row = asAdmin.body.output.parameters.find((p: { parameterCode: string }) => p.parameterCode === 'DIRTY_BOTTLE');
    expect(row.affectedBales).toBe(10);
    expect(row.standardAmount).toBeCloseTo(0.01 * 10 * (11410 / 105) * 10, 4); // (5−4)% × 10 bales × M18/M19 × ₹10
    expect(saved.body.readings.find((r: { parameterCode: string }) => r.parameterCode === 'DIRTY_BOTTLE').perBale).toEqual([4.95, 4.8, null]);

    expect((await request(app).post(`/api/reports/${report.id}/submit-qc`).set(analyst.auth)).status).toBe(200);
    const audit = await request(app).get(`/api/reports/${report.id}/audit`).set(analyst.auth);
    expect(audit.body.some((r: { field: string; newValue: string }) => r.field === 'affectedBales.DIRTY_BOTTLE' && r.newValue === '10')).toBe(true);
  });

  it('Non Food Grade-PET is recorded but not deducted, as in the sheet', async () => {
    const report = await toWeightsEntered();
    const res = await request(app)
      .patch(`/api/reports/${report.id}/qc`)
      .set(analyst.auth)
      .send({ baleWeightsKg: [99, 96, null], readings: [{ parameterCode: 'NON_FOOD_GRADE_PET', perBale: [5, 5, null] }] });
    const row = res.body.output.parameters.find((p: { parameterCode: string }) => p.parameterCode === 'NON_FOOD_GRADE_PET');
    expect(row.overNorm).toBe(true);
    expect(row.standardAmount).toBe(0);
  });

  it('"purchase allowed" is the total % accepted: must lie between the norm and the actual %; approved = (allowed − norm)% × M18 × rate', async () => {
    const pending = await toPendingApproval(); // Moisture actual 7.45, norm 5
    const belowNorm = await request(app)
      .patch(`/api/reports/${pending.id}/approval`)
      .set(manager.auth)
      .send({ adjustments: [{ parameterCode: 'MOISTURE', purchaseAdjustment: 0.45 }] });
    expect(belowNorm.status).toBe(400);
    expect(belowNorm.body.error).toBe('INVALID_ADJUSTMENT');
    expect(belowNorm.body.details[0]).toContain('Moisture: purchase allowed (0.45%) is below the norm (5%)');

    const seven = await request(app)
      .patch(`/api/reports/${pending.id}/approval`)
      .set(manager.auth)
      .send({ adjustments: [{ parameterCode: 'MOISTURE', purchaseAdjustment: 7 }] });
    expect(seven.status).toBe(200);
    const row = seven.body.output.parameters.find((p: { parameterCode: string }) => p.parameterCode === 'MOISTURE');
    expect(row.standardAmount).toBeCloseTo(33545.4, 2); // unchanged: from the norm
    expect(row.approvedAmount).toBeCloseTo(0.02 * 11410 * 120, 2); // (7 − 5)% × M18 × rate

    const waived = await request(app)
      .patch(`/api/reports/${pending.id}/approval`)
      .set(manager.auth)
      .send({ adjustments: [{ parameterCode: 'MOISTURE', purchaseAdjustment: 8 }] });
    expect(waived.status).toBe(400);
    expect(waived.body.error).toBe('INVALID_ADJUSTMENT');
    expect(waived.body.details[0]).toContain('Moisture: purchase allowed (8%) is above the actual % (7.45%)');

    const atActual = await request(app)
      .patch(`/api/reports/${pending.id}/approval`)
      .set(manager.auth)
      .send({ adjustments: [{ parameterCode: 'MOISTURE', purchaseAdjustment: 7.45 }] });
    expect(atActual.status).toBe(200);
    expect(atActual.body.output.parameters.find((p: { parameterCode: string }) => p.parameterCode === 'MOISTURE').approvedAmount).toBeCloseTo(0.0245 * 11410 * 120, 2);
  });
});

describe('rate visibility', () => {
  it('strips rates and every rupee figure for the analyst and the store, on every read and save', async () => {
    const pending = await toPendingApproval();
    for (const s of [analyst, store, stores]) {
      const res = await request(app).get(`/api/reports/${pending.id}`).set(s.auth);
      expect(res.status).toBe(200);
      const dto: ReportDto = res.body;
      expect(dto.ratesHidden).toBe(true);
      expect(dto.materials.every((m) => m.invoiceRate === null && m.dalmiaRate === null)).toBe(true);
      expect(dto.output.weights.dominantRate).toBe(0);
      expect(dto.output.parameters.every((p) => p.rate === 0 && p.standardAmount === 0 && p.approvedAmount === 0)).toBe(true);
      expect(dto.output.shortage.lines.every((l) => l.rate === 0 && l.standardAmount === 0)).toBe(true);
      expect(dto.output.grandTotal).toEqual({ standardAmount: 0, approvedAmount: 0, differenceAmount: 0 });
      // Quantities and readings are untouched.
      expect(dto.output.parameters.find((p) => p.parameterCode === 'MOISTURE')!.actualPercent).toBeCloseTo(7.45, 6);
      expect(dto.output.parameters.find((p) => p.parameterCode === 'MOISTURE')!.standardQty).toBeCloseTo(279.545, 3);
      expect(dto.materials[0]!.dalmiaWeightKg).toBe(9950);
      expect((await request(app).get(`/api/reports/${pending.id}/narration`).set(s.auth)).status).toBe(403);
      const list = await request(app).get('/api/reports').set(s.auth);
      expect(list.body.items[0]).toMatchObject({ standardTotal: 0, approvedTotal: 0, ratesHidden: true });
    }
    // The gate and the manager see everything.
    for (const s of [gate, manager]) {
      const dto: ReportDto = (await request(app).get(`/api/reports/${pending.id}`).set(s.auth)).body;
      expect(dto.ratesHidden).toBeUndefined();
      expect(dto.output.grandTotal.standardAmount).toBeCloseTo(51818.86, 2);
    }
  });

  it('the audit log hides rate changes from such users', async () => {
    const pending = await toPendingApproval();
    const asGate = await request(app).get(`/api/reports/${pending.id}/audit`).set(gate.auth);
    const asStore = await request(app).get(`/api/reports/${pending.id}/audit`).set(store.auth);
    const rateRows = (rows: { field: string | null }[]) => rows.filter((r) => r.field?.endsWith('Rate'));
    expect(rateRows(asGate.body).length).toBeGreaterThan(0);
    expect(rateRows(asStore.body)).toHaveLength(0);
    expect(asStore.body.length).toBeGreaterThan(0);
  });

  it('an admin can grant rate access per user, and it takes effect immediately', async () => {
    const pending = await toPendingApproval();
    const analystUser = await prisma.user.findUniqueOrThrow({ where: { email: 'qc_analyst@test.local' } });
    expect((await request(app).patch(`/api/admin/users/${analystUser.id}`).set(store.auth).send({ canSeeRates: true })).status).toBe(403);
    const grant = await request(app).patch(`/api/admin/users/${analystUser.id}`).set(admin.auth).send({ canSeeRates: true });
    expect(grant.status).toBe(200);
    expect(grant.body.canSeeRates).toBe(true);
    try {
      const dto: ReportDto = (await request(app).get(`/api/reports/${pending.id}`).set(analyst.auth)).body;
      expect(dto.ratesHidden).toBeUndefined();
      expect(dto.materials[0]!.dalmiaRate).toBe(120);
    } finally {
      await request(app).patch(`/api/admin/users/${analystUser.id}`).set(admin.auth).send({ canSeeRates: false });
    }
    const rows = await prisma.auditLog.findMany({ where: { action: 'USER_UPDATE', field: 'qc_analyst@test.local.canSeeRates' } });
    expect(rows.length).toBe(2);
  });
});

describe('audit log', () => {
  it('records every field change and status change with who and what', async () => {
    const draft = await createDraft();
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', invoiceWeightKg: 10000 }] });
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', invoiceWeightKg: 10050 }] });
    // Saving the same value again writes nothing.
    await request(app).patch(`/api/reports/${draft.id}/weights`).set(gate.auth).send({ materials: [{ code: 'CLEAR', invoiceWeightKg: 10050 }] });

    const res = await request(app).get(`/api/reports/${draft.id}/audit`).set(analyst.auth);
    expect(res.status).toBe(200);
    const changes = res.body.filter((r: { action: string }) => r.action === 'FIELD_CHANGE');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ field: 'weights.CLEAR.invoiceWeightKg', oldValue: '10000', newValue: '10050' });
    expect(changes[0].user.name).toBe('GATE user');
    expect(res.body.some((r: { action: string }) => r.action === 'REPORT_CREATE')).toBe(true);
  });

  it('submit-qc records both transitions', async () => {
    const pending = await toPendingApproval();
    const rows = await prisma.auditLog.findMany({ where: { reportId: pending.id, action: 'STATUS_CHANGE' }, orderBy: { at: 'asc' } });
    expect(rows.map((r) => `${r.oldValue}→${r.newValue}`)).toEqual(
      expect.arrayContaining(['DRAFT→INVOICE_ENTERED', 'INVOICE_ENTERED→WEIGHTS_ENTERED','WEIGHTS_ENTERED→QC_ENTERED', 'QC_ENTERED→PENDING_APPROVAL']),
    );
  });
});

describe('list filters and numbering', () => {
  it('numbers within the financial year and filters by status, date, supplier and search', async () => {
    const a = await createDraft();
    const b = (await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2026-02-10', truckNumber: 'GJ 01 AB 9999' })).body;
    await request(app).patch(`/api/reports/${a.id}/weights`).set(gate.auth).send(invoiceBody);
    await request(app).post(`/api/reports/${a.id}/submit-invoice`).set(gate.auth);
    await request(app).patch(`/api/reports/${a.id}/grn`).set(admin.auth).send({ grnNumber: 'GRN-77' });
    const c = (await request(app).post('/api/reports').set(gate.auth).send({ reportDate: '2026-04-01' })).body;
    expect([a.reportNo, b.reportNo, c.reportNo]).toEqual(['QC/25-26/0001', 'QC/25-26/0002', 'QC/26-27/0001']);

    const get = async (qs: string) => (await request(app).get(`/api/reports?${qs}`).set(manager.auth)).body;
    expect((await get('')).total).toBe(3);
    expect((await get('q=gj 01')).items.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect((await get('q=grn-77')).total).toBe(1);
    expect((await get(`supplierId=${supplierId}`)).total).toBe(1);
    expect((await get('from=2026-01-01&to=2026-03-31')).items.map((r: { id: string }) => r.id)).toEqual([b.id]);
    expect((await get('status=APPROVED')).total).toBe(0);
    expect((await request(app).get('/api/reports?status=BOGUS').set(manager.auth)).status).toBe(400);
  });

  it('returns 404 for an unknown report', async () => {
    expect((await request(app).get('/api/reports/does-not-exist').set(gate.auth)).status).toBe(404);
  });
});

describe('GET /api/lookups', () => {
  it('gives every role the suppliers, materials and engine config', async () => {
    const res = await request(app).get('/api/lookups').set(analyst.auth);
    expect(res.status).toBe(200);
    expect(res.body.suppliers).toEqual([{ id: supplierId, name: 'ABC', code: 'ABC' }]);
    expect(res.body.materials).toHaveLength(5);
    expect(res.body.engineConfig.parameters).toHaveLength(10);
  });
});
