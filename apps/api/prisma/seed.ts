import bcrypt from 'bcryptjs';
import type { Role } from '@prisma/client';
import {
  DEFAULT_MATERIALS,
  DEFAULT_PARAMETERS,
  DEFAULT_TOLERANCE_FRACTION,
  SAMPLE_HEADER,
  buildTallyNarration,
  calculateReport,
  sampleReportInput,
} from '@dalmia/calc';
import { SETTING_KEYS, loadEngineConfig } from '../src/config/engine-config';
import { prisma } from '../src/prisma';
import { buildSnapshot } from '../src/reports/snapshot';

const SEED_PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? 'ChangeMe@123';
/** Norms and rates seeded here apply to every report, including back-dated imports. */
const EFFECTIVE_FROM = new Date('2000-01-01');
const SAMPLE_REPORT_NO = 'QC-SAMPLE-0001';

const USERS: { name: string; email: string; role: Role }[] = [
  { name: 'System Admin', email: 'admin@dalmiapolypro.local', role: 'ADMIN' },
  { name: 'Gate Operator', email: 'gate@dalmiapolypro.local', role: 'GATE' },
  { name: 'RM Store Keeper', email: 'store@dalmiapolypro.local', role: 'RM_STORE' },
  { name: 'QC Analyst', email: 'analyst@dalmiapolypro.local', role: 'QC_ANALYST' },
  { name: 'Stores', email: 'stores@dalmiapolypro.local', role: 'STORES' },
  { name: 'Purchase Manager', email: 'manager@dalmiapolypro.local', role: 'QC_MANAGER' },
];

const SUPPLIERS = [
  { code: 'ABC', name: 'ABC' },
  { code: 'SUP-002', name: 'Sample Supplier Two' },
];

async function seedUsers() {
  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 12);
  for (const u of USERS) {
    // Never overwrite an existing user's password or role on re-seed.
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { ...u, passwordHash, canSeeRates: !(['QC_ANALYST', 'RM_STORE', 'STORES'] as Role[]).includes(u.role) } });
  }
}

async function seedMasterData() {
  for (const s of SUPPLIERS) {
    await prisma.supplier.upsert({ where: { code: s.code }, update: {}, create: s });
  }
  for (const m of DEFAULT_MATERIALS) {
    await prisma.material.upsert({ where: { code: m.code }, update: {}, create: m });
  }

  for (const p of DEFAULT_PARAMETERS) {
    const existing = await prisma.parameter.findUnique({ where: { code: p.code } });
    if (existing) continue; // keep whatever the admin has configured since
    await prisma.parameter.create({
      data: {
        code: p.code,
        name: p.name,
        category: p.category,
        inputMode: p.inputMode,
        sortOrder: p.sortOrder,
        isDeductible: p.isDeductible,
        norms: {
          create: p.norms.map((n) => ({
            seasonStartMonth: n.seasonStartMonth,
            seasonEndMonth: n.seasonEndMonth,
            normPercent: n.normPercent,
            effectiveFrom: EFFECTIVE_FROM,
          })),
        },
        rates: {
          create: p.rates.map((r) => ({
            rateMode: r.rateMode,
            fixedRate: r.fixedRate ?? null,
            weightBase: r.weightBase,
            maxActualPercent: r.maxActualPercent ?? null,
            effectiveFrom: EFFECTIVE_FROM,
          })),
        },
      },
    });
  }

  const settings: Record<string, string> = {
    [SETTING_KEYS.toleranceFraction]: String(DEFAULT_TOLERANCE_FRACTION),
    [SETTING_KEYS.useWeightToleranceRow]: 'false',
    [SETTING_KEYS.allowNegativeOtherShortage]: 'false',
    [SETTING_KEYS.defaultWeightTolerancePercent]: '0.5',
  };
  for (const [key, value] of Object.entries(settings)) {
    await prisma.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }
}

/** The worked example from the workbook, stored as an APPROVED report. */
async function seedSampleReport() {
  if (await prisma.report.findUnique({ where: { reportNo: SAMPLE_REPORT_NO } })) return;

  const [admin, manager, analyst, supplier, materials, parameters] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { email: USERS[0]!.email } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'manager@dalmiapolypro.local' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'analyst@dalmiapolypro.local' } }),
    prisma.supplier.findUniqueOrThrow({ where: { code: 'ABC' } }),
    prisma.material.findMany(),
    prisma.parameter.findMany(),
  ]);
  const materialIdByCode = new Map(materials.map((m) => [m.code, m.id]));
  const parameterIdByCode = new Map(parameters.map((p) => [p.code, p.id]));

  const config = await loadEngineConfig();
  const input = sampleReportInput(config);
  const output = calculateReport(input);
  const grnNumber = SAMPLE_HEADER.grnNumber;
  const snapshot = buildSnapshot(output, { materialIdByCode, parameterIdByCode });

  await prisma.report.create({
    data: {
      reportNo: SAMPLE_REPORT_NO,
      status: 'APPROVED',
      source: 'MANUAL',
      reportDate: new Date(SAMPLE_HEADER.reportDate),
      supplierId: supplier.id,
      partyNameRaw: SAMPLE_HEADER.partyName,
      poNumber: SAMPLE_HEADER.poNumber,
      truckNumber: SAMPLE_HEADER.truckNumber,
      grnNumber,
      tokenNumber: SAMPLE_HEADER.tokenNumber,
      tokenDate: new Date(SAMPLE_HEADER.reportDate),
      invoiceNumber: SAMPLE_HEADER.invoiceNumber,
      invoiceDate: new Date(SAMPLE_HEADER.reportDate),
      weightTolerancePercent: input.weightTolerancePercent ?? null,
      remarks: 'Seeded from the worked example in "Debit Note Format 1.xlsx".',
      createdById: admin.id,
      checkedById: analyst.id,
      approvedById: manager.id,
      approvedAt: new Date(),
      standardTotal: snapshot.standardTotal,
      approvedTotal: snapshot.approvedTotal,
      narration: buildTallyNarration(output, { grnNumber }),
      materialLines: {
        create: input.materials.map((m) => ({
          materialId: materialIdByCode.get(m.code)!,
          invoiceWeightKg: m.invoiceWeightKg,
          invoiceBales: m.invoiceBales,
          invoiceRate: m.invoiceRate,
          dalmiaWeightKg: m.dalmiaWeightKg,
          dalmiaBales: m.dalmiaBales,
          dalmiaRate: m.dalmiaRate,
        })),
      },
      bales: {
        create: input.baleWeightsKg.map((w, i) => ({ baleIndex: i + 1, baleWeightKg: w ?? null })),
      },
      readings: {
        create: input.readings.flatMap((r) =>
          r.perBale.map((value, i) => ({
            parameterId: parameterIdByCode.get(r.parameterCode)!,
            baleIndex: i + 1,
            value: value ?? null,
          })),
        ),
      },
      deductions: { createMany: { data: snapshot.deductions } },
      shortageLines: { createMany: { data: snapshot.shortageLines } },
      auditLogs: { create: { userId: admin.id, action: 'REPORT_SEED', newValue: 'APPROVED' } },
    },
  });
  console.log(
    `  sample report ${SAMPLE_REPORT_NO}: standard ₹${snapshot.standardTotal} / approved ₹${snapshot.approvedTotal}`,
  );
}

async function main() {
  console.log('Seeding…');
  await seedUsers();
  await seedMasterData();
  await seedSampleReport();
  console.log(`Done. Seeded users (password "${SEED_PASSWORD}" unless they already existed):`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(11)} ${u.email}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
