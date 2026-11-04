import ExcelJS from 'exceljs';
import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { PARAMETER_CODES, toYMD } from '@dalmia/calc';
import {
  STATUS_LABELS,
  WEIGHT_SHORTAGE_KEY,
  dashboardQuerySchema,
  excelViewQuerySchema,
  type DashboardMonthRow,
  type DashboardParameterRow,
  type DashboardSummaryDto,
  type DashboardSupplierRow,
  type ExcelViewResponse,
  type ExcelViewRow,
} from '@dalmia/types';
import type { z } from 'zod';
import { currentUser, requireAdmin } from '../auth/middleware';
import { writeAudit } from '../lib/audit';
import { asyncHandler, parseQuery } from '../lib/http';
import { prisma } from '../prisma';

type Filters = z.infer<typeof dashboardQuerySchema>;
type ExcelFilters = z.infer<typeof excelViewQuerySchema>;

const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);
const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const num = (d: Prisma.Decimal | null | undefined): number => d?.toNumber() ?? 0;

/** Date range and supplier, for the Prisma client. Money figures add `status: 'APPROVED'` on top. */
const rangeWhere = (q: Filters): Prisma.ReportWhereInput => ({
  supplierId: q.supplierId,
  reportDate: q.from || q.to ? { gte: q.from ? toDate(q.from) : undefined, lte: q.to ? toDate(q.to) : undefined } : undefined,
});
const approvedWhere = (q: Filters): Prisma.ReportWhereInput => ({ ...rangeWhere(q), status: 'APPROVED' });

/** The same filter for $queryRaw, on alias `r`. Every value is a bound parameter. */
function approvedSql(q: Filters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`r."status" = 'APPROVED'`];
  if (q.from) parts.push(Prisma.sql`r."reportDate" >= ${q.from}::date`);
  if (q.to) parts.push(Prisma.sql`r."reportDate" <= ${q.to}::date`);
  if (q.supplierId) parts.push(Prisma.sql`r."supplierId" = ${q.supplierId}`);
  return Prisma.join(parts, ' AND ');
}

/** Mounted at /api/dashboard behind requireAuth. ADMIN only. Money figures count APPROVED reports only. */
export const dashboardRouter = Router();
dashboardRouter.use(requireAdmin);

dashboardRouter.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const q = parseQuery(dashboardQuerySchema, req);
    // "This month" is the calendar month in Asia/Kolkata, whatever the server's timezone.
    const today = toYMD(new Date());
    const monthStart = new Date(Date.UTC(today.year, today.month - 1, 1));
    const nextMonthStart = new Date(Date.UTC(today.year, today.month, 1));

    const [reportsInRange, approved, pendingApprovals, reportsThisMonth] = await Promise.all([
      prisma.report.count({ where: rangeWhere(q) }),
      prisma.report.aggregate({ where: approvedWhere(q), _count: true, _sum: { standardTotal: true, approvedTotal: true } }),
      prisma.report.count({ where: { status: 'PENDING_APPROVAL', supplierId: q.supplierId } }),
      prisma.report.count({ where: { supplierId: q.supplierId, reportDate: { gte: monthStart, lt: nextMonthStart } } }),
    ]);
    const standardTotal = num(approved._sum.standardTotal);
    const approvedTotal = num(approved._sum.approvedTotal);
    res.json({
      reportsInRange,
      approvedReports: approved._count,
      standardTotal,
      approvedTotal,
      waivedTotal: standardTotal - approvedTotal,
      pendingApprovals,
      reportsThisMonth,
    } satisfies DashboardSummaryDto);
  }),
);

dashboardRouter.get(
  '/by-supplier',
  asyncHandler(async (req, res) => {
    const q = parseQuery(dashboardQuerySchema, req);
    // Raw SQL: a party typed freely (no supplierId) is grouped by name, and if that name matches a
    // supplier in the master (case-insensitive) it is merged into that supplier rather than shown twice.
    const rows = await prisma.$queryRaw<
      { supplierId: string | null; supplierName: string; reportCount: number; standardTotal: Prisma.Decimal; approvedTotal: Prisma.Decimal }[]
    >(Prisma.sql`
      WITH matched AS (
        SELECT r.*,
               COALESCE(r."supplierId", byName."id") AS "resolvedSupplierId",
               COALESCE(s."name", byName."name", NULLIF(TRIM(r."partyNameRaw"), ''), 'Unknown party') AS "resolvedName"
        FROM "Report" r
        LEFT JOIN "Supplier" s ON s."id" = r."supplierId"
        LEFT JOIN "Supplier" byName ON r."supplierId" IS NULL AND LOWER(byName."name") = LOWER(TRIM(r."partyNameRaw"))
        WHERE ${approvedSql(q)}
      )
      SELECT "resolvedSupplierId" AS "supplierId",
             "resolvedName" AS "supplierName",
             COUNT(*)::int AS "reportCount",
             SUM("standardTotal") AS "standardTotal",
             SUM("approvedTotal") AS "approvedTotal"
      FROM matched
      GROUP BY 1, 2
      ORDER BY SUM("approvedTotal") DESC, 2 ASC
      LIMIT 15`);
    res.json(
      rows.map(
        (r): DashboardSupplierRow => ({
          supplierId: r.supplierId,
          supplierName: r.supplierName,
          reportCount: r.reportCount,
          standardTotal: num(r.standardTotal),
          approvedTotal: num(r.approvedTotal),
        }),
      ),
    );
  }),
);

dashboardRouter.get(
  '/by-parameter',
  asyncHandler(async (req, res) => {
    const q = parseQuery(dashboardQuerySchema, req);
    const report = approvedWhere(q);
    const [parameters, sums, shortage] = await Promise.all([
      prisma.parameter.findMany({ orderBy: { sortOrder: 'asc' } }),
      prisma.deduction.groupBy({ by: ['parameterId'], where: { report }, _sum: { standardAmount: true, approvedAmount: true } }),
      prisma.shortageLine.aggregate({ where: { report }, _sum: { standardAmount: true, approvedAmount: true } }),
    ]);
    const byId = new Map(sums.map((s) => [s.parameterId, s._sum]));
    const rows: DashboardParameterRow[] = parameters
      // A parameter switched off in Settings still shows while it has history.
      .filter((p) => p.isActive || byId.has(p.id))
      .map((p) => ({
        key: p.code,
        name: p.name,
        category: p.category,
        standardAmount: num(byId.get(p.id)?.standardAmount),
        approvedAmount: num(byId.get(p.id)?.approvedAmount),
      }));
    rows.push({
      key: WEIGHT_SHORTAGE_KEY,
      name: 'Weight shortage',
      category: 'SHORTAGE',
      standardAmount: num(shortage._sum.standardAmount),
      approvedAmount: num(shortage._sum.approvedAmount),
    });
    res.json(rows);
  }),
);

dashboardRouter.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const q = parseQuery(dashboardQuerySchema, req);
    // One Deduction row per report and parameter, so the join cannot double-count the report totals.
    const rows = await prisma.$queryRaw<
      { month: string; reportCount: number; standardTotal: Prisma.Decimal; approvedTotal: Prisma.Decimal; averageMoisture: Prisma.Decimal | null }[]
    >(Prisma.sql`
      SELECT to_char(r."reportDate", 'YYYY-MM') AS "month",
             COUNT(*)::int AS "reportCount",
             SUM(r."standardTotal") AS "standardTotal",
             SUM(r."approvedTotal") AS "approvedTotal",
             AVG(d."actualPercent") AS "averageMoisture"
      FROM "Report" r
      LEFT JOIN "Deduction" d
             ON d."reportId" = r."id"
            AND d."actualPercent" > 0
            AND d."parameterId" = (SELECT p."id" FROM "Parameter" p WHERE p."code" = ${PARAMETER_CODES.MOISTURE})
      WHERE ${approvedSql(q)}
      GROUP BY 1
      ORDER BY 1`);
    res.json(
      rows.map(
        (r): DashboardMonthRow => ({
          month: r.month,
          reportCount: r.reportCount,
          standardTotal: num(r.standardTotal),
          approvedTotal: num(r.approvedTotal),
          averageMoisturePercent: r.averageMoisture ? r.averageMoisture.toNumber() : null,
        }),
      ),
    );
  }),
);

// ---------------------------------------------------------------- Excel view

const JSON_ROW_LIMIT = 2000;
const XLSX_ROW_LIMIT = 20_000;

async function excelView(q: ExcelFilters, limit: number): Promise<ExcelViewResponse> {
  const where: Prisma.ReportWhereInput = { ...rangeWhere(q), status: q.status };
  const [total, reports] = await Promise.all([
    prisma.report.count({ where }),
    prisma.report.findMany({
      where,
      include: {
        supplier: { select: { name: true } },
        materialLines: { select: { invoiceWeightKg: true, dalmiaWeightKg: true } },
        deductions: { select: { actualPercent: true, approvedAmount: true, parameter: { select: { code: true, category: true } } } },
        shortageLines: { select: { approvedAmount: true } },
      },
      orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
      take: limit,
    }),
  ]);
  const rows = reports.map((r): ExcelViewRow => {
    const sum = (values: (Prisma.Decimal | null)[]): number => values.reduce((a, v) => a + num(v), 0);
    const totalInvoiceWeightKg = sum(r.materialLines.map((m) => m.invoiceWeightKg));
    const totalDalmiaWeightKg = sum(r.materialLines.map((m) => m.dalmiaWeightKg));
    const moisture = r.deductions.find((d) => d.parameter.code === PARAMETER_CODES.MOISTURE);
    const block = (category: 'DISCRETIONARY' | 'NON_DISCRETIONARY') =>
      sum(r.deductions.filter((d) => d.parameter.category === category).map((d) => d.approvedAmount));
    const standardTotal = r.standardTotal.toNumber();
    const approvedTotal = r.approvedTotal.toNumber();
    return {
      id: r.id,
      reportNo: r.reportNo,
      reportDate: isoDate(r.reportDate),
      supplierName: r.supplier?.name ?? r.partyNameRaw,
      truckNumber: r.truckNumber,
      grnNumber: r.grnNumber,
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      source: r.source,
      totalInvoiceWeightKg,
      totalDalmiaWeightKg,
      shortfallKg: totalInvoiceWeightKg - totalDalmiaWeightKg,
      moistureActualPercent: moisture && moisture.actualPercent.toNumber() > 0 ? moisture.actualPercent.toNumber() : null,
      discretionaryApproved: block('DISCRETIONARY'),
      nonDiscretionaryApproved: block('NON_DISCRETIONARY'),
      shortageApproved: sum(r.shortageLines.map((l) => l.approvedAmount)),
      standardTotal,
      approvedTotal,
      waived: standardTotal - approvedTotal,
    };
  });
  return { rows, total };
}

dashboardRouter.get(
  '/excel-view',
  asyncHandler(async (req, res) => {
    res.json(await excelView(parseQuery(excelViewQuerySchema, req), JSON_ROW_LIMIT));
  }),
);

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Indian digit grouping (lakh, crore). */
const INR_FORMAT = '#,##,##0.00';

type Column = { header: string; width: number; numFmt?: string; value: (r: ExcelViewRow) => string | number | Date | null };
const EXCEL_COLUMNS: Column[] = [
  { header: 'Report No.', width: 16, value: (r) => r.reportNo },
  { header: 'Date', width: 12, numFmt: 'dd-mm-yyyy', value: (r) => toDate(r.reportDate) },
  { header: 'Supplier', width: 28, value: (r) => r.supplierName },
  { header: 'Truck No.', width: 16, value: (r) => r.truckNumber },
  { header: 'GRN No.', width: 24, value: (r) => r.grnNumber },
  { header: 'Invoice No.', width: 18, value: (r) => r.invoiceNumber },
  { header: 'Status', width: 18, value: (r) => STATUS_LABELS[r.status] },
  { header: 'Source', width: 11, value: (r) => (r.source === 'IMPORTED' ? 'Imported' : 'Manual') },
  { header: 'Invoice weight (kg)', width: 18, numFmt: INR_FORMAT, value: (r) => r.totalInvoiceWeightKg },
  { header: 'Dalmia weight (kg)', width: 18, numFmt: INR_FORMAT, value: (r) => r.totalDalmiaWeightKg },
  { header: 'Shortfall (kg)', width: 15, numFmt: INR_FORMAT, value: (r) => r.shortfallKg },
  { header: 'Moisture actual %', width: 16, numFmt: '0.00', value: (r) => r.moistureActualPercent },
  { header: 'A) Discretionary approved', width: 22, numFmt: INR_FORMAT, value: (r) => r.discretionaryApproved },
  { header: 'B) Non-discretionary approved', width: 25, numFmt: INR_FORMAT, value: (r) => r.nonDiscretionaryApproved },
  { header: 'C) Shortage approved', width: 20, numFmt: INR_FORMAT, value: (r) => r.shortageApproved },
  { header: 'Total standard', width: 17, numFmt: INR_FORMAT, value: (r) => r.standardTotal },
  { header: 'Total approved', width: 17, numFmt: INR_FORMAT, value: (r) => r.approvedTotal },
  { header: 'Waived', width: 15, numFmt: INR_FORMAT, value: (r) => r.waived },
];

dashboardRouter.get(
  '/excel-view.xlsx',
  asyncHandler(async (req, res) => {
    const q = parseQuery(excelViewQuerySchema, req);
    const { rows } = await excelView(q, XLSX_ROW_LIMIT);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Dalmia Polypro QC';
    const sheet = workbook.addWorksheet('Reports', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = EXCEL_COLUMNS.map((c) => ({ header: c.header, width: c.width, style: c.numFmt ? { numFmt: c.numFmt } : {} }));
    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    for (const r of rows) sheet.addRow(EXCEL_COLUMNS.map((c) => c.value(r)));
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: EXCEL_COLUMNS.length } };

    await writeAudit({
      userId: currentUser(req).id,
      action: 'EXPORT_DASHBOARD_EXCEL',
      newValue: `${rows.length} rows${q.from || q.to ? `, ${q.from ?? '…'} to ${q.to ?? '…'}` : ''}`,
    });
    const name = `QC reports ${q.from ?? 'start'} to ${q.to ?? isoDate(new Date())}.xlsx`;
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }),
);
