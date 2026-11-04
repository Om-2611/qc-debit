import { Router } from 'express';
import type { Plant } from '@prisma/client';
import { createPlantSchema, updatePlantSchema, type AdminPlantDto } from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { writeAudit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

const toDto = (p: Plant, reportCount: number): AdminPlantDto => ({
  id: p.id,
  code: p.code,
  name: p.name,
  ionSiteCode: p.ionSiteCode,
  ionSiteAddressLabel: p.ionSiteAddressLabel,
  stateCode: p.stateCode,
  isActive: p.isActive,
  reportCount,
});

/** Mounted at /api/admin/plants behind requireAuth + requireAdmin. No DELETE: reports reference plants, so a plant is deactivated. */
export const plantsRouter = Router();

plantsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const plants = await prisma.plant.findMany({ include: { _count: { select: { reports: true } } }, orderBy: [{ isActive: 'desc' }, { code: 'asc' }] });
    res.json(plants.map((p) => toDto(p, p._count.reports)));
  }),
);

plantsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(createPlantSchema, req);
    if (await prisma.plant.findUnique({ where: { code: input.code! } })) throw conflict(`A plant with code ${input.code} already exists`);
    const plant = await prisma.plant.create({
      data: {
        code: input.code!,
        name: input.name!,
        ionSiteCode: input.ionSiteCode!,
        ionSiteAddressLabel: input.ionSiteAddressLabel!,
        stateCode: input.stateCode!,
        isActive: input.isActive ?? true,
      },
    });
    await writeAudit({ userId: admin.id, action: 'PLANT_CREATE', field: plant.code, newValue: plant.name });
    res.status(201).json(toDto(plant, 0));
  }),
);

plantsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updatePlantSchema, req);
    const existing = await prisma.plant.findUnique({ where: { id: req.params.id }, include: { _count: { select: { reports: true } } } });
    if (!existing) throw notFound('Plant not found');
    if (input.code !== undefined && input.code !== existing.code && (await prisma.plant.findUnique({ where: { code: input.code } }))) {
      throw conflict(`A plant with code ${input.code} already exists`);
    }
    const plant = await prisma.plant.update({ where: { id: existing.id }, data: input });
    await writeAudit(
      (['code', 'name', 'ionSiteCode', 'ionSiteAddressLabel', 'stateCode', 'isActive'] as const)
        .filter((f) => input[f] !== undefined && input[f] !== existing[f])
        .map((f) => ({ userId: admin.id, action: 'PLANT_UPDATE', field: `${existing.code}.${f}`, oldValue: existing[f], newValue: input[f] })),
    );
    res.json(toDto(plant, existing._count.reports));
  }),
);
