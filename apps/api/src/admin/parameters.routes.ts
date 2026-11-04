import { Router } from 'express';
import type { NormRule, Parameter, RateRule } from '@prisma/client';
import { seasonLabel } from '@dalmia/calc';
import {
  rateRuleSchema,
  replaceNormsSchema,
  updateParameterSchema,
  validateNormCoverage,
  type AdminParameterDto,
} from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { writeAudit } from '../lib/audit';
import { badRequest, notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

type ParameterWithRules = Parameter & { norms: NormRule[]; rates: RateRule[] };

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);
const toDate = (ymd: string): Date => new Date(`${ymd}T00:00:00.000Z`);

const toDto = (p: ParameterWithRules): AdminParameterDto => ({
  id: p.id,
  code: p.code,
  name: p.name,
  category: p.category,
  inputMode: p.inputMode,
  sortOrder: p.sortOrder,
  isActive: p.isActive,
  isDeductible: p.isDeductible,
  norms: p.norms
    .map((n) => ({
      id: n.id,
      seasonStartMonth: n.seasonStartMonth,
      seasonEndMonth: n.seasonEndMonth,
      normPercent: n.normPercent.toNumber(),
      effectiveFrom: isoDate(n.effectiveFrom),
    }))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom) || a.seasonStartMonth - b.seasonStartMonth),
  rates: p.rates
    .map((r) => ({
      id: r.id,
      rateMode: r.rateMode,
      fixedRate: r.fixedRate?.toNumber() ?? null,
      weightBase: r.weightBase,
      maxActualPercent: r.maxActualPercent?.toNumber() ?? null,
      effectiveFrom: isoDate(r.effectiveFrom),
    }))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
});

const withRules = { norms: true, rates: true } as const;

async function findParameter(id: string | undefined): Promise<ParameterWithRules> {
  const parameter = id ? await prisma.parameter.findUnique({ where: { id }, include: withRules }) : null;
  if (!parameter) throw notFound('Parameter not found');
  return parameter;
}

/** Compact, readable audit values: "2000-01-01 Jul–Sep 5%; 2000-01-01 Oct–Jun 3%". */
const describeNorms = (norms: AdminParameterDto['norms']): string =>
  norms.map((n) => `${n.effectiveFrom} ${seasonLabel(n.seasonStartMonth, n.seasonEndMonth) || 'All year'} ${n.normPercent}%`).join('; ');
const describeRate = (r: Omit<AdminParameterDto['rates'][number], 'id'>): string =>
  [
    r.effectiveFrom,
    r.rateMode === 'FIXED' ? `FIXED ${r.fixedRate}` : r.rateMode,
    r.weightBase,
    r.maxActualPercent != null ? `below ${r.maxActualPercent}%` : null,
  ]
    .filter(Boolean)
    .join(' ');

/**
 * Mounted at /api/admin/parameters behind requireAuth + requireAdmin.
 * Parameters are the sheet's rows, so they are not created or deleted here; `code`, category and input mode are fixed.
 * Approved reports keep their snapshot, so nothing here rewrites history.
 */
export const parametersRouter = Router();

parametersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const parameters = await prisma.parameter.findMany({ include: withRules, orderBy: { sortOrder: 'asc' } });
    res.json(parameters.map(toDto));
  }),
);

parametersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updateParameterSchema, req);
    const existing = await findParameter(req.params.id);

    const parameter = await prisma.parameter.update({ where: { id: existing.id }, data: input, include: withRules });
    await writeAudit(
      (['name', 'sortOrder', 'isActive', 'isDeductible'] as const)
        .filter((f) => input[f] !== undefined && input[f] !== existing[f])
        .map((f) => ({
          userId: admin.id,
          action: 'PARAMETER_UPDATE',
          field: `${existing.code}.${f}`,
          oldValue: existing[f],
          newValue: input[f],
        })),
    );
    res.json(toDto(parameter));
  }),
);

/** Replaces the parameter's whole norm list, history included, so the client sends every rule it wants kept. */
parametersRouter.put(
  '/:id/norms',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { norms } = parseBody(replaceNormsSchema, req);
    const existing = await findParameter(req.params.id);
    const problems = validateNormCoverage(norms);
    if (problems.length) throw badRequest(problems.join(' '), problems);

    const parameter = await prisma.$transaction(async (tx) => {
      await tx.normRule.deleteMany({ where: { parameterId: existing.id } });
      await tx.normRule.createMany({
        data: norms.map((n) => ({
          parameterId: existing.id,
          seasonStartMonth: n.seasonStartMonth,
          seasonEndMonth: n.seasonEndMonth,
          normPercent: n.normPercent,
          effectiveFrom: toDate(n.effectiveFrom),
        })),
      });
      const updated = await tx.parameter.findUniqueOrThrow({ where: { id: existing.id }, include: withRules });
      const before = describeNorms(toDto(existing).norms);
      const after = describeNorms(toDto(updated).norms);
      if (before !== after) {
        await writeAudit({ userId: admin.id, action: 'NORM_UPDATE', field: `${existing.code}.norms`, oldValue: before, newValue: after }, tx);
      }
      return updated;
    });
    res.json(toDto(parameter));
  }),
);

/**
 * Adds a rate rule effective from the given date, or updates the rule that already starts on that date
 * (send the current rule's date to correct it in place).
 */
parametersRouter.put(
  '/:id/rate',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(rateRuleSchema, req);
    const existing = await findParameter(req.params.id);
    const effectiveFrom = toDate(input.effectiveFrom);
    const current = existing.rates.find((r) => isoDate(r.effectiveFrom) === input.effectiveFrom);
    const data = {
      rateMode: input.rateMode,
      fixedRate: input.rateMode === 'FIXED' ? input.fixedRate! : null,
      weightBase: input.weightBase,
      maxActualPercent: input.maxActualPercent ?? null,
      effectiveFrom,
    };

    const parameter = await prisma.$transaction(async (tx) => {
      if (current) await tx.rateRule.update({ where: { id: current.id }, data });
      else await tx.rateRule.create({ data: { ...data, parameterId: existing.id } });
      const updated = await tx.parameter.findUniqueOrThrow({ where: { id: existing.id }, include: withRules });
      const before = current ? describeRate(toDto(existing).rates.find((r) => r.id === current.id)!) : null;
      const after = describeRate({ ...data, fixedRate: data.fixedRate ?? null, effectiveFrom: input.effectiveFrom });
      if (before !== after) {
        await writeAudit({ userId: admin.id, action: 'RATE_UPDATE', field: `${existing.code}.rate`, oldValue: before, newValue: after }, tx);
      }
      return updated;
    });
    res.json(toDto(parameter));
  }),
);

/** Removes a rate rule added by mistake. The last rule stays: without one the engine falls back to a rate nobody chose. */
parametersRouter.delete(
  '/:id/rate/:rateId',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const existing = await findParameter(req.params.id);
    const rule = toDto(existing).rates.find((r) => r.id === req.params.rateId);
    if (!rule) throw notFound('Rate rule not found');
    if (existing.rates.length === 1) throw badRequest('A parameter must keep at least one rate rule; change it instead.');

    const parameter = await prisma.$transaction(async (tx) => {
      await tx.rateRule.delete({ where: { id: rule.id } });
      await writeAudit({ userId: admin.id, action: 'RATE_UPDATE', field: `${existing.code}.rate`, oldValue: describeRate(rule), newValue: null }, tx);
      return tx.parameter.findUniqueOrThrow({ where: { id: existing.id }, include: withRules });
    });
    res.json(toDto(parameter));
  }),
);
