import { Router } from 'express';
import type { Supplier } from '@prisma/client';
import { createSupplierSchema, updateSupplierSchema, type AdminSupplierDto } from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { writeAudit } from '../lib/audit';
import { conflict, notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

const toDto = (s: Supplier, reportCount: number): AdminSupplierDto => ({
  id: s.id,
  name: s.name,
  code: s.code,
  gstin: s.gstin,
  address: s.address,
  isActive: s.isActive,
  createdAt: s.createdAt.toISOString(),
  reportCount,
});

/** Name and code are both unique; names compare case-insensitively so "ABC Traders" and "abc traders" cannot coexist. */
async function assertUnique(input: { name?: string; code?: string }, exceptId?: string): Promise<void> {
  const not = exceptId ? { id: { not: exceptId } } : {};
  if (input.name !== undefined) {
    const clash = await prisma.supplier.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' }, ...not } });
    if (clash) throw conflict(`A supplier named "${clash.name}" already exists`);
  }
  if (input.code !== undefined) {
    const clash = await prisma.supplier.findFirst({ where: { code: { equals: input.code, mode: 'insensitive' }, ...not } });
    if (clash) throw conflict(`Supplier code ${clash.code} is already used by "${clash.name}"`);
  }
}

/**
 * Mounted at /api/admin/suppliers behind requireAuth + requireAdmin.
 * There is no DELETE: reports reference suppliers, so a supplier is deactivated instead.
 */
export const suppliersRouter = Router();

suppliersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const suppliers = await prisma.supplier.findMany({
      include: { _count: { select: { reports: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    res.json(suppliers.map((s) => toDto(s, s._count.reports)));
  }),
);

suppliersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(createSupplierSchema, req);
    await assertUnique(input);
    const supplier = await prisma.supplier.create({
      data: { name: input.name, code: input.code, gstin: input.gstin ?? null, address: input.address ?? null, isActive: input.isActive ?? true },
    });
    await writeAudit({ userId: admin.id, action: 'SUPPLIER_CREATE', field: supplier.code, newValue: supplier.name });
    res.status(201).json(toDto(supplier, 0));
  }),
);

suppliersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updateSupplierSchema, req);
    const existing = await prisma.supplier.findUnique({ where: { id: req.params.id }, include: { _count: { select: { reports: true } } } });
    if (!existing) throw notFound('Supplier not found');
    await assertUnique(input, existing.id);

    const supplier = await prisma.supplier.update({ where: { id: existing.id }, data: input });
    await writeAudit(
      (['name', 'code', 'gstin', 'address', 'isActive'] as const)
        .filter((f) => input[f] !== undefined && input[f] !== existing[f])
        .map((f) => ({
          userId: admin.id,
          action: 'SUPPLIER_UPDATE',
          field: `${existing.code}.${f}`,
          oldValue: existing[f],
          newValue: input[f],
        })),
    );
    res.json(toDto(supplier, existing._count.reports));
  }),
);
