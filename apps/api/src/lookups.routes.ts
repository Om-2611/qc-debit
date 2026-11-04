import { Router } from 'express';
import type { LookupsDto } from '@dalmia/types';
import { SETTING_KEYS, loadEngineConfig } from './config/engine-config';
import { asyncHandler } from './lib/http';
import { prisma } from './prisma';

/** GET /api/lookups — read-only reference data every role needs to render and live-calculate a report. */
export const lookupsRouter = Router();

lookupsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [suppliers, materials, engineConfig, tolerance] = await Promise.all([
      prisma.supplier.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, name: true, code: true } }),
      prisma.material.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: { code: true, name: true, sortOrder: true } }),
      loadEngineConfig(),
      prisma.setting.findUnique({ where: { key: SETTING_KEYS.defaultWeightTolerancePercent } }),
    ]);
    const value = Number(tolerance?.value);
    res.json({
      suppliers,
      materials,
      engineConfig,
      defaultWeightTolerancePercent: tolerance && Number.isFinite(value) ? value : null,
    } satisfies LookupsDto);
  }),
);
