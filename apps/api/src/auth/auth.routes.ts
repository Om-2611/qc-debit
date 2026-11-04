import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, type AuthUser, type LoginResponse } from '@dalmia/types';
import { env } from '../env';
import { writeAudit } from '../lib/audit';
import { unauthorized } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { prisma } from '../prisma';
import { currentUser, requireAuth } from './middleware';
import {
  REFRESH_COOKIE,
  issueRefreshToken,
  refreshCookieOptions,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokens';

export const BCRYPT_ROUNDS = 12;

// Compared against when the email is unknown, so response time does not reveal which emails exist.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: 'TOO_MANY_REQUESTS', message: 'Too many login attempts. Try again in 15 minutes.' },
});

const clearCookieOptions = () => {
  const { maxAge: _maxAge, ...rest } = refreshCookieOptions();
  return rest;
};

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const { email, password } = parseBody(loginSchema, req);
    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !passwordOk) throw unauthorized('Incorrect email or password');
    if (!user.isActive) throw unauthorized('This account has been deactivated. Contact your administrator.');

    const authUser: AuthUser = { id: user.id, name: user.name, email: user.email, role: user.role, canSeeRates: user.canSeeRates };
    const refresh = await issueRefreshToken(user.id, undefined, req.get('user-agent'));
    await writeAudit({ userId: user.id, action: 'LOGIN' });

    res.cookie(REFRESH_COOKIE, refresh, refreshCookieOptions());
    res.json({ accessToken: signAccessToken({ sub: user.id, role: user.role }), user: authUser } satisfies LoginResponse);
  }),
);

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token !== 'string' || !token) throw unauthorized('No refresh token');

    const result = await rotateRefreshToken(token, req.get('user-agent'));
    if (!result.ok) {
      res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
      throw unauthorized(
        result.reason === 'REUSED'
          ? 'Session was used from another place and has been closed. Please sign in again.'
          : 'Session expired. Please sign in again.',
      );
    }

    const user = await prisma.user.findUnique({ where: { id: result.userId } });
    if (!user || !user.isActive) {
      await revokeRefreshToken(result.token);
      res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
      throw unauthorized('Account is inactive or no longer exists');
    }

    const authUser: AuthUser = { id: user.id, name: user.name, email: user.email, role: user.role, canSeeRates: user.canSeeRates };
    res.cookie(REFRESH_COOKIE, result.token, refreshCookieOptions());
    res.json({ accessToken: signAccessToken({ sub: user.id, role: user.role }), user: authUser } satisfies LoginResponse);
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    const token: unknown = req.cookies?.[REFRESH_COOKIE];
    if (typeof token === 'string' && token) await revokeRefreshToken(token);
    res.clearCookie(REFRESH_COOKIE, clearCookieOptions());
    res.status(204).end();
  }),
);

export const meRouter = Router();
meRouter.get('/', requireAuth, (req, res) => {
  res.json(currentUser(req));
});
