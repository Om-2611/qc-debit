import { createHash, timingSafeEqual } from 'node:crypto';
import express, { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import { CHECKPOINTS } from './state-machine';
import { env } from '../env';
import { HttpError, unauthorized } from '../lib/errors';
import { asyncHandler, parseBody, parseQuery } from '../lib/http';
import { claimNext, finishJob, heartbeat, recordMilestone, recordStep, saveScreenshot } from './push.service';

const digest = (s: string): Buffer => createHash('sha256').update(s).digest();

/**
 * The worker PC is not a user: it proves itself with ION_WORKER_TOKEN. Without a configured token the whole
 * API answers 503, so a forgotten setting can never leave it open.
 */
export const requireWorkerToken: RequestHandler = (req, _res, next) => {
  const expected = env.ION_WORKER_TOKEN;
  if (!expected) return next(new HttpError(503, 'WORKER_API_OFF', 'The iON worker API is not configured (ION_WORKER_TOKEN).'));
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized('Worker token required'));
  if (!timingSafeEqual(digest(header.slice(7)), digest(expected))) return next(unauthorized('Wrong worker token'));
  next();
};

/** Mounted at /api/ion-worker, before the user-login guard. */
export const ionWorkerRouter = Router();
ionWorkerRouter.use(requireWorkerToken);

const workerId = z.string().trim().min(1).max(100);

ionWorkerRouter.post(
  '/claim',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ workerId, env: z.enum(['training', 'live']) }).strict(), req);
    const job = await claimNext(body.workerId, body.env);
    if (!job) return res.status(204).end();
    res.json(job);
  }),
);

ionWorkerRouter.post(
  '/pushes/:id/heartbeat',
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ workerId }).strict(), req);
    await heartbeat(req.params.id!, body.workerId);
    res.status(204).end();
  }),
);

ionWorkerRouter.post(
  '/pushes/:id/steps',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z
        .object({
          workerId,
          step: z.string().trim().min(1).max(100),
          outcome: z.enum(['ok', 'error', 'info']),
          message: z.string().max(2000).nullable().optional(),
          screenshotId: z.string().max(60).nullable().optional(),
        })
        .strict(),
      req,
    );
    const { workerId: wid, ...step } = body;
    await recordStep(req.params.id!, wid, step);
    res.status(204).end();
  }),
);

/** The answer must arrive before the worker presses the button: draft_click and submit_click are recorded first. */
ionWorkerRouter.post(
  '/pushes/:id/milestone',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z
        .object({
          workerId,
          name: z.enum(['draft_click', 'draft_created', 'checkpoint', 'submit_click', 'submitted']),
          dnNo: z.string().trim().min(1).max(60).optional(),
          checkpoint: z.enum(CHECKPOINTS).optional(),
          ionStatus: z.string().max(100).optional(),
        })
        .strict(),
      req,
    );
    const { workerId: wid, ...milestone } = body;
    await recordMilestone(req.params.id!, wid, milestone);
    res.status(204).end();
  }),
);

ionWorkerRouter.post(
  '/pushes/:id/screenshots',
  express.raw({ type: ['image/jpeg', 'image/png'], limit: '2mb' }),
  asyncHandler(async (req, res) => {
    const q = parseQuery(z.object({ workerId, label: z.string().trim().min(1).max(100) }), req);
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send the screenshot as image/jpeg.');
    const id = await saveScreenshot(req.params.id!, q.workerId, q.label, req.headers['content-type']!.split(';')[0]!, req.body);
    res.status(201).json({ id });
  }),
);

ionWorkerRouter.post(
  '/pushes/:id/finish',
  asyncHandler(async (req, res) => {
    const body = parseBody(
      z
        .object({
          workerId,
          outcome: z.enum(['completed', 'failed']),
          kind: z.enum(['transient', 'session_expired', 'invoice_not_found', 'duplicate_found', 'verification', 'dialog', 'ion_error', 'unexpected']).optional(),
          error: z.string().max(2000).optional(),
          errorStep: z.string().max(100).optional(),
          dnNumbersFound: z.array(z.string().max(60)).max(50).optional(),
        })
        .strict(),
      req,
    );
    const { workerId: wid, ...result } = body;
    const row = await finishJob(req.params.id!, wid, result);
    res.json({ status: row.status, ionDnNo: row.ionDnNo });
  }),
);
