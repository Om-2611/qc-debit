import { Router } from 'express';
import type { Material } from '@prisma/client';
import { updateMaterialSchema, type AdminMaterialDto } from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { writeAudit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

const toDto = (m: Material): AdminMaterialDto => ({ id: m.id, code: m.code, name: m.name, sortOrder: m.sortOrder, isActive: m.isActive });

/**
 * Mounted at /api/admin/materials behind requireAuth + requireAdmin.
 * The five materials are the sheet's five columns and `code` is the engine's key, so there is no
 * create or delete and the schema does not accept `code`.
 */
export const materialsRouter = Router();

materialsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const materials = await prisma.material.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
    res.json(materials.map(toDto));
  }),
);

materialsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updateMaterialSchema, req);
    const existing = await prisma.material.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('Material not found');
    if (input.name !== undefined) {
      const clash = await prisma.material.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: existing.id } },
      });
      if (clash) throw conflict(`A material named "${clash.name}" already exists`);
    }

    const material = await prisma.material.update({ where: { id: existing.id }, data: input });
    await writeAudit(
      (['name', 'sortOrder', 'isActive'] as const)
        .filter((f) => input[f] !== undefined && input[f] !== existing[f])
        .map((f) => ({
          userId: admin.id,
          action: 'MATERIAL_UPDATE',
          field: `${existing.code}.${f}`,
          oldValue: existing[f],
          newValue: input[f],
        })),
    );
    res.json(toDto(material));
  }),
);
