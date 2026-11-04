import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { User } from '@prisma/client';
import { createUserSchema, resetPasswordSchema, updateUserSchema, type UserDto } from '@dalmia/types';
import { BCRYPT_ROUNDS } from '../auth/auth.routes';
import { currentUser } from '../auth/middleware';
import { revokeAllForUser } from '../auth/tokens';
import { writeAudit } from '../lib/audit';
import { badRequest, conflict, notFound } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';

const toDto = (u: User): UserDto => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  canSeeRates: u.canSeeRates,
  isActive: u.isActive,
  createdAt: u.createdAt.toISOString(),
});

/** Mounted at /api/admin/users behind requireAuth + requireAdmin. */
export const usersRouter = Router();

usersRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
    res.json(users.map(toDto));
  }),
);

usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(createUserSchema, req);
    if (await prisma.user.findUnique({ where: { email: input.email } })) {
      throw conflict(`A user with email ${input.email} already exists`);
    }
    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        role: input.role,
        // Analysts and store keepers do not see rates unless the admin says so.
        canSeeRates: input.canSeeRates ?? !['QC_ANALYST', 'RM_STORE', 'STORES'].includes(input.role),
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
      },
    });
    await writeAudit({ userId: admin.id, action: 'USER_CREATE', field: user.email, newValue: user.role });
    res.status(201).json(toDto(user));
  }),
);

usersRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const input = parseBody(updateUserSchema, req);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('User not found');

    const losesAdmin =
      existing.role === 'ADMIN' &&
      existing.isActive &&
      ((input.role !== undefined && input.role !== 'ADMIN') || input.isActive === false);
    if (losesAdmin) {
      if (existing.id === admin.id) throw badRequest('You cannot deactivate or demote your own admin account.');
      const otherAdmins = await prisma.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: existing.id } },
      });
      if (otherAdmins === 0) throw badRequest('At least one active admin must remain.');
    }

    const user = await prisma.user.update({ where: { id: existing.id }, data: input });
    // A deactivated or re-roled user must not keep a live session.
    if (input.isActive === false || (input.role && input.role !== existing.role)) await revokeAllForUser(user.id);

    await writeAudit(
      (['name', 'role', 'isActive', 'canSeeRates'] as const)
        .filter((f) => input[f] !== undefined && input[f] !== existing[f])
        .map((f) => ({
          userId: admin.id,
          action: 'USER_UPDATE',
          field: `${existing.email}.${f}`,
          oldValue: existing[f],
          newValue: input[f],
        })),
    );
    res.json(toDto(user));
  }),
);

usersRouter.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const admin = currentUser(req);
    const { password } = parseBody(resetPasswordSchema, req);
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) throw notFound('User not found');

    await prisma.user.update({
      where: { id: existing.id },
      data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) },
    });
    await revokeAllForUser(existing.id);
    await writeAudit({ userId: admin.id, action: 'USER_PASSWORD_RESET', field: existing.email });
    res.status(204).end();
  }),
);
