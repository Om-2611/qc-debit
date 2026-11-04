import crypto from 'node:crypto';
import type { CookieOptions } from 'express';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@dalmia/types';
import { env, isProduction } from '../env';
import { prisma } from '../prisma';

export const REFRESH_COOKIE = 'dqc_refresh';

export interface AccessClaims {
  sub: string;
  role: Role;
}

interface RefreshClaims {
  sub: string;
  fam: string;
  jti: string;
}

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign({ role: claims.role }, env.JWT_ACCESS_SECRET, {
    subject: claims.sub,
    expiresIn: env.JWT_ACCESS_TTL as SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
  return { sub: String(payload.sub), role: payload.role as Role };
}

export const refreshCookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: isProduction,
  sameSite: 'strict',
  path: '/api/auth',
  maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
});

/** Issues a refresh token and records its hash. Pass familyId when rotating an existing session. */
export async function issueRefreshToken(userId: string, familyId?: string, userAgent?: string): Promise<string> {
  const fam = familyId ?? crypto.randomUUID();
  const jti = crypto.randomUUID();
  const token = jwt.sign({ fam } satisfies Partial<RefreshClaims>, env.JWT_REFRESH_SECRET, {
    subject: userId,
    jwtid: jti,
    expiresIn: `${env.JWT_REFRESH_TTL_DAYS}d`,
  });
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId: fam,
      tokenHash: sha256(token),
      userAgent: userAgent?.slice(0, 255),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

export type RotateResult =
  | { ok: true; userId: string; token: string }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REUSED' };

/**
 * One-time-use rotation. Presenting a token that was already rotated means it leaked (or was
 * replayed), so the whole login family is revoked and the user must sign in again.
 */
export async function rotateRefreshToken(token: string, userAgent?: string): Promise<RotateResult> {
  let claims: RefreshClaims;
  try {
    const payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as jwt.JwtPayload;
    claims = { sub: String(payload.sub), fam: String(payload.fam), jti: String(payload.jti) };
  } catch (err) {
    return { ok: false, reason: err instanceof jwt.TokenExpiredError ? 'EXPIRED' : 'INVALID' };
  }

  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.userId !== claims.sub) return { ok: false, reason: 'INVALID' };

  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: row.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: false, reason: 'REUSED' };
  }
  if (row.expiresAt < new Date()) return { ok: false, reason: 'EXPIRED' };

  // Conditional update so two concurrent refreshes cannot both win.
  const claimed = await prisma.refreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count !== 1) return { ok: false, reason: 'REUSED' };

  return { ok: true, userId: row.userId, token: await issueRefreshToken(row.userId, row.familyId, userAgent) };
}

export async function revokeRefreshToken(token: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: sha256(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
