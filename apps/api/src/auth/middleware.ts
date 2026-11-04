import type { RequestHandler } from 'express';
import type { AuthUser, Role } from '@dalmia/types';
import { forbidden, unauthorized } from '../lib/errors';
import { asyncHandler } from '../lib/http';
import { prisma } from '../prisma';
import { verifyAccessToken } from './tokens';

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Verifies the bearer token, then re-reads the user so a deactivation or role change takes effect
 * immediately rather than when the access token expires.
 */
export const requireAuth: RequestHandler = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  let userId: string;
  try {
    userId = verifyAccessToken(header.slice(7)).sub;
  } catch {
    throw unauthorized('Session expired or invalid token');
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, isActive: true, canSeeRates: true },
  });
  if (!user || !user.isActive) throw unauthorized('Account is inactive or no longer exists');

  req.user = { id: user.id, name: user.name, email: user.email, role: user.role, canSeeRates: user.canSeeRates };
  next();
});

/** Role guard. ADMIN passes every guard ("Admin can also act as any role"). Use after requireAuth. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    const user = req.user;
    if (!user) return next(unauthorized());
    if (user.role === 'ADMIN' || roles.includes(user.role)) return next();
    next(forbidden(`This action requires role ${roles.join(' or ')}; your role is ${user.role}.`));
  };

export const requireAdmin = requireRole('ADMIN');

/** For handlers: the authenticated user, or a 401 if the route forgot requireAuth. */
export function currentUser(req: { user?: AuthUser }): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
