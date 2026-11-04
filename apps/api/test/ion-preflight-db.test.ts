import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { prisma } from '../src/prisma';
import { login, resetDatabase, seedEngineConfig, seedUsers, type Session } from './helpers';

const app = createApp();
let admin: Session, manager: Session;
let reportId: string;

beforeAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await seedUsers();
  [admin, manager] = await Promise.all([login(app, 'ADMIN'), login(app, 'QC_MANAGER')]);

  const [adminUser, plant, clear, green, moisture, iron] = await Promise.all([
    prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' } }),
    prisma.plant.findUniqueOrThrow({ where: { code: 'DPNL' } }),
    prisma.material.findUniqueOrThrow({ where: { code: 'CLEAR' } }),
    prisma.material.findUniqueOrThrow({ where: { code: 'GREEN' } }),
    prisma.parameter.findUniqueOrThrow({ where: { code: 'MOISTURE' } }),
    prisma.parameter.findUniqueOrThrow({ where: { code: 'IRON_PATTI' } }),
  ]);
  await prisma.material.update({ where: { id: clear.id }, data: { ionItemCode: 'RM-13001' } });
  const supplier = await prisma.supplier.create({
    data: { name: 'Ecoloom', code: 'ECO', gstin: '09AAAAA0000A1Z5', ionSupplierCode: 'CRRM_140290', ionStateCode: '09' },
  });

  const deduction = (parameterId: string, approvedAmount: number) => ({
    parameterId,
    normPercent: 0,
    actualPercent: 0,
    rate: 0,
    weightBase: 'TOTAL_DALMIA_WEIGHT' as const,
    standardQty: 0,
    standardAmount: 0,
    approvedQty: 0,
    approvedAmount,
    differenceQty: 0,
    differenceAmount: 0,
  });
  const report = await prisma.report.create({
    data: {
      reportNo: 'QC/26-27/0013',
      status: 'APPROVED',
      reportDate: new Date('2026-11-03'),
      supplierId: supplier.id,
      plantId: plant.id,
      truckNumber: 'MH 15 XY 1234',
      grnNumber: 'DPNL/GRN_RM/2627/4331',
      invoiceNumber: 'ECPL/26-27/0632',
      invoiceDate: new Date('2026-10-27'),
      approvedTotal: '1000.0049',
      createdById: adminUser.id,
      materialLines: {
        create: [
          { materialId: clear.id, invoiceWeightKg: 10000, invoiceRate: 30 },
          { materialId: green.id, invoiceWeightKg: 2000, invoiceRate: 20 },
        ],
      },
      deductions: { create: [deduction(moisture.id, 400.0049), deduction(iron.id, 600)] },
    },
  });
  reportId = report.id;
});
afterAll(async () => {
  await resetDatabase();
  await seedEngineConfig();
  await prisma.$disconnect();
});

describe('GET /api/ion/reports/:id/preflight', () => {
  it('is for admins only', async () => {
    expect((await request(app).get(`/api/ion/reports/${reportId}/preflight`)).status).toBe(401);
    expect((await request(app).get(`/api/ion/reports/${reportId}/preflight`).set(manager.auth)).status).toBe(403);
  });

  it('builds the payload from a real approved report', async () => {
    const res = await request(app).get(`/api/ion/reports/${reportId}/preflight`).set(admin.auth);
    expect(res.status).toBe(200);
    // The voucher date is "today", so only the date-independent parts are compared.
    expect(res.body.issues).toEqual([]);
    expect(res.body.ok).toBe(true);
    expect(res.body.payload).toMatchObject({
      qcNo: 'QC/26-27/0013',
      siteCode: 'DPNL',
      supplierCode: 'CRRM_140290',
      partyAddressLabel: 'CRRM_140290 (Bill to Address)',
      supplierInvoiceNo: 'ECPL/26-27/0632',
      supplierInvoiceDate: '27/10/2026',
      grnNo: 'DPNL/GRN_RM/2627/4331',
      itemCode: 'RM-13001',
      amount: '1000.00',
      interState: true,
      expectedTaxes: [{ code: 'INPUT-IGST 18%', amount: '180.00' }],
      reasonDetails: 'Moisture, Iron, QC/26-27/0013',
      narration: 'QC deduction as per QC/26-27/0013, Inv ECPL/26-27/0632, GRN DPNL/GRN_RM/2627/4331, Truck MH 15 XY 1234',
    });
  });

  it('lists what is missing once the masters are incomplete, and 404s an unknown report', async () => {
    await prisma.supplier.update({ where: { code: 'ECO' }, data: { ionSupplierCode: null, gstRegistered: false } });
    await prisma.report.update({ where: { id: reportId }, data: { status: 'PENDING_APPROVAL', grnNumber: '4331' } });
    const res = await request(app).get(`/api/ion/reports/${reportId}/preflight`).set(admin.auth);
    expect(res.body.ok).toBe(false);
    expect(res.body.payload).toBeNull();
    expect(res.body.issues.map((i: { code: string }) => i.code).sort()).toEqual(['GRN_FORMAT', 'ION_SUPPLIER_CODE_MISSING', 'NOT_APPROVED', 'SUPPLIER_UNREGISTERED']);

    expect((await request(app).get('/api/ion/reports/nope/preflight').set(admin.auth)).status).toBe(404);
  });
});
