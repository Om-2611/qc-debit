import express, { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { buildTallyNarration } from '@dalmia/calc';
import {
  approvalPatchSchema,
  canCreateReport,
  createReportSchema,
  headerPatchSchema,
  qcPatchSchema,
  reopenSchema,
  reportListQuerySchema,
  sendBackSchema,
  weightsPatchSchema,
  grnPatchSchema,
  type AuditEntryDto,
  type ReportListItem,
  type ReportListResponse,
  type ReportSection,
} from '@dalmia/types';
import { currentUser, requireAdmin } from '../auth/middleware';
import { buildBlankTemplate, buildReportWorkbook, exportFileName } from '../export/excel';
import { auditRevealsRate, canSeeRates, redactListItem, redactReport } from './redact';
import { renderReportPdf } from '../export/pdf';
import { writeAudit } from '../lib/audit';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { asyncHandler, parseBody, parseQuery } from '../lib/http';
import { prisma } from '../prisma';
import { createReport, getReport, performAction, updateSection } from './report.service';
import { HEADER_FIELDS, isoDate, toDate } from './report.state';

/** Mounted at /api/reports behind requireAuth. Role and status rules live in @dalmia/types permissions. */
export const reportsRouter = Router();

reportsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = parseQuery(reportListQuerySchema, req);
    const where: Prisma.ReportWhereInput = {
      status: q.status,
      source: q.source,
      supplierId: q.supplierId,
      reportDate: q.from || q.to ? { gte: toDate(q.from ?? null) ?? undefined, lte: toDate(q.to ?? null) ?? undefined } : undefined,
      OR: q.q
        ? (['truckNumber', 'grnNumber', 'invoiceNumber', 'reportNo', 'partyNameRaw'] as const).map((f) => ({
            [f]: { contains: q.q, mode: 'insensitive' },
          }))
        : undefined,
    };
    const [total, rows] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        include: { supplier: { select: { name: true } } },
        orderBy: [{ reportDate: 'desc' }, { createdAt: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
    ]);
    const items = rows.map(
      (r): ReportListItem => ({
        id: r.id,
        reportNo: r.reportNo,
        status: r.status,
        source: r.source,
        reportDate: isoDate(r.reportDate)!,
        supplierId: r.supplierId,
        supplierName: r.supplier?.name ?? r.partyNameRaw,
        truckNumber: r.truckNumber,
        grnNumber: r.grnNumber,
        invoiceNumber: r.invoiceNumber,
        standardTotal: r.standardTotal.toNumber(),
        approvedTotal: r.approvedTotal.toNumber(),
        hasMismatch: r.hasMismatch,
        sentBack: r.status === 'QC_ENTERED' && !!r.sentBackNote,
        updatedAt: r.updatedAt.toISOString(),
      }),
    );
    const user = currentUser(req);
    res.json({ items: items.map((i) => redactListItem(i, user)), page: q.page, pageSize: q.pageSize, total } satisfies ReportListResponse);
  }),
);

reportsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    if (!canCreateReport(user.role)) throw forbidden(`Only GATE (or ADMIN) can create a report; your role is ${user.role}.`);
    res.status(201).json(await createReport(user, parseBody(createReportSchema, req)));
  }),
);

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const attachment = (name: string): string => `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;

// Exports are ADMIN only (client decision, 21-09-2026).
// Registered before '/:id' so "template.xlsx" is not taken for a report id.
reportsRouter.get(
  '/template.xlsx',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const buffer = await (await buildBlankTemplate()).xlsx.writeBuffer();
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', attachment('Debit Note Format.xlsx'));
    res.send(Buffer.from(buffer));
  }),
);

reportsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(redactReport(await getReport(req.params.id!), currentUser(req)));
  }),
);

reportsRouter.patch(
  '/:id/header',
  asyncHandler(async (req, res) => {
    const { updatedAt, ...patch } = parseBody(headerPatchSchema, req);
    const dto = await updateSection(req.params.id!, currentUser(req), 'header', updatedAt, (state) => {
      // GRN is not a header field any more: it is saved with the store's Dalmia rows.
      const values = patch as Partial<Record<(typeof HEADER_FIELDS)[number], string | null>>;
      for (const f of HEADER_FIELDS) {
        if (f !== 'grnNumber' && values[f] !== undefined) (state.header as Record<string, string | null>)[f] = values[f] ?? null;
      }
    });
    res.json(redactReport(dto, currentUser(req)));
  }),
);

reportsRouter.patch(
  '/:id/weights',
  asyncHandler(async (req, res) => {
    const { updatedAt, materials } = parseBody(weightsPatchSchema, req);
    // The grid holds two desks' rows. Gate: invoice weight/bales/rate and the Dalmia rate (from the PO).
    // Store: Dalmia weight and bales. Only the groups present in the body are checked, so
    // each desk can save its own rows.
    const GATE_KEYS = new Set(['invoiceWeightKg', 'invoiceBales', 'invoiceRate', 'dalmiaRate']);
    const STORE_KEYS = new Set(['dalmiaWeightKg', 'dalmiaBales']);
    const has = (keys: Set<string>) => materials.some((m) => Object.entries(m).some(([k, v]) => keys.has(k) && v !== undefined));
    const sections: ReportSection[] = [];
    if (has(GATE_KEYS)) sections.push('invoiceWeights');
    if (has(STORE_KEYS)) sections.push('dalmiaWeights');
    if (sections.length === 0) throw badRequest('Nothing to update');
    const dto = await updateSection(req.params.id!, currentUser(req), sections, updatedAt, (state) => {
      for (const { code, ...fields } of materials) {
        const line = state.materials.find((m) => m.code === code);
        if (!line) throw badRequest(`Unknown material "${code}"`);
        for (const [k, v] of Object.entries(fields)) if (v !== undefined) (line as unknown as Record<string, number | null>)[k] = v;
      }
    });
    res.json(redactReport(dto, currentUser(req)));
  }),
);

reportsRouter.patch(
  '/:id/grn',
  asyncHandler(async (req, res) => {
    const { updatedAt, grnNumber } = parseBody(grnPatchSchema, req);
    const dto = await updateSection(req.params.id!, currentUser(req), 'grn', updatedAt, (state) => {
      state.header.grnNumber = grnNumber;
    });
    res.json(redactReport(dto, currentUser(req)));
  }),
);

reportsRouter.patch(
  '/:id/qc',
  asyncHandler(async (req, res) => {
    const { updatedAt, baleWeightsKg, readings } = parseBody(qcPatchSchema, req);
    const dto = await updateSection(req.params.id!, currentUser(req), 'qc', updatedAt, (state, masters) => {
      baleWeightsKg?.forEach((w, i) => (state.baleWeightsKg[i] = w));
      for (const r of readings ?? []) {
        const target = state.readings.find((x) => x.parameterCode === r.parameterCode);
        const param = masters.config.parameters.find((p) => p.code === r.parameterCode);
        if (!target || !param) throw badRequest(`Unknown parameter "${r.parameterCode}"`);
        if (r.affectedBales !== undefined) target.affectedBales = r.affectedBales;
        r.perBale?.forEach((v, i) => {
          if (param.inputMode === 'PERCENT_PER_BALE' && v != null && v > 100) {
            throw badRequest(`${param.name}: a reading cannot exceed 100%`);
          }
          target.perBale[i] = v;
        });
      }
    });
    res.json(redactReport(dto, currentUser(req)));
  }),
);

reportsRouter.patch(
  '/:id/approval',
  asyncHandler(async (req, res) => {
    const { updatedAt, ...patch } = parseBody(approvalPatchSchema, req);
    const dto = await updateSection(req.params.id!, currentUser(req), 'approval', updatedAt, (state) => {
      for (const a of patch.adjustments ?? []) {
        const target = state.readings.find((x) => x.parameterCode === a.parameterCode);
        if (!target) throw badRequest(`Unknown parameter "${a.parameterCode}"`);
        target.purchaseAdjustment = a.purchaseAdjustment;
      }
      for (const s of patch.shortageAdjustments ?? []) {
        if (!(s.materialCode in state.shortageAdjustments)) throw badRequest(`Unknown material "${s.materialCode}"`);
        state.shortageAdjustments[s.materialCode] = s.adjustmentQty;
      }
      for (const d of patch.otherDescriptions ?? []) {
        if (!(d.materialCode in state.otherDescriptions)) throw badRequest(`Unknown material "${d.materialCode}"`);
        state.otherDescriptions[d.materialCode] = d.description;
      }
      if (patch.weightTolerancePercent !== undefined) state.weightTolerancePercent = patch.weightTolerancePercent;
      if (patch.remarks !== undefined) state.remarks = patch.remarks;
    });
    res.json(dto);
  }),
);

const act = (action: 'submitInvoice' | 'submitWeights' | 'submitQc' | 'submitGrn') =>
  asyncHandler(async (req: express.Request, res: express.Response) => {
    const user = currentUser(req);
    res.json(redactReport(await performAction(req.params.id!, user, action), user));
  });
reportsRouter.post('/:id/submit-invoice', act('submitInvoice'));
reportsRouter.post('/:id/submit-weights', act('submitWeights'));
reportsRouter.post('/:id/submit-qc', act('submitQc'));
reportsRouter.post('/:id/submit-grn', act('submitGrn'));
reportsRouter.post(
  '/:id/approve',
  asyncHandler(async (req, res) => res.json(await performAction(req.params.id!, currentUser(req), 'approve'))),
);
reportsRouter.post(
  '/:id/send-back',
  asyncHandler(async (req, res) => {
    const { note } = parseBody(sendBackSchema, req);
    res.json(await performAction(req.params.id!, currentUser(req), 'sendBack', note));
  }),
);
reportsRouter.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    const { reason } = parseBody(reopenSchema, req);
    res.json(await performAction(req.params.id!, currentUser(req), 'reopen', reason));
  }),
);

reportsRouter.get(
  '/:id/export.xlsx',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const dto = await getReport(req.params.id!);
    const buffer = await (await buildReportWorkbook(dto)).xlsx.writeBuffer();
    await writeAudit({ userId: currentUser(req).id, reportId: dto.id, action: 'EXPORT_EXCEL' });
    res.setHeader('Content-Type', XLSX);
    res.setHeader('Content-Disposition', attachment(exportFileName(dto, 'xlsx')));
    res.send(Buffer.from(buffer));
  }),
);

reportsRouter.get(
  '/:id/export.pdf',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const dto = await getReport(req.params.id!);
    const pdf = await renderReportPdf(dto);
    await writeAudit({ userId: currentUser(req).id, reportId: dto.id, action: 'EXPORT_PDF' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', attachment(exportFileName(dto, 'pdf')));
    res.send(pdf);
  }),
);

reportsRouter.get(
  '/:id/narration',
  asyncHandler(async (req, res) => {
    if (!canSeeRates(currentUser(req))) throw forbidden('The Tally narration contains rates and amounts, which your account may not see.');
    const dto = await getReport(req.params.id!);
    // Frozen at approval; before that it is a preview of what the narration would be.
    const narration = dto.narration ?? buildTallyNarration(dto.output, { grnNumber: dto.grnNumber });
    res.json({ narration, final: dto.status === 'APPROVED' });
  }),
);

reportsRouter.get(
  '/:id/audit',
  asyncHandler(async (req, res) => {
    const exists = await prisma.report.findUnique({ where: { id: req.params.id! }, select: { id: true } });
    if (!exists) throw notFound('Report not found');
    const user = currentUser(req);
    const rows = await prisma.auditLog.findMany({
      where: { reportId: req.params.id! },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { at: 'desc' },
      take: 1000,
    });
    res.json(
      rows.filter((r) => canSeeRates(user) || !auditRevealsRate(r.field)).map(
        (r): AuditEntryDto => ({
          id: r.id,
          at: r.at.toISOString(),
          user: r.user,
          action: r.action,
          field: r.field,
          oldValue: r.oldValue,
          newValue: r.newValue,
        }),
      ),
    );
  }),
);
