import { Router } from 'express';
import { z } from 'zod';
import { currentUser } from '../auth/middleware';
import { asyncHandler, parseBody } from '../lib/http';
import { preflightReport } from './load';
import { continueToSubmit, createPush, getReportView, getScreenshot, resetPush, retryPush } from './push.service';

/** Mounted at /api/ion behind requireAuth + requireAdmin. */
export const ionRouter = Router();

/** What is missing or wrong before this report can be loaded on TCS iON; the payload is included once nothing blocks. */
ionRouter.get(
  '/reports/:id/preflight',
  asyncHandler(async (req, res) => {
    res.json(await preflightReport(req.params.id!));
  }),
);

/** The push of a report (status, DN number, last error, step log, screenshots), plus what is still missing. */
ionRouter.get(
  '/reports/:id',
  asyncHandler(async (req, res) => {
    res.json(await getReportView(req.params.id!));
  }),
);

const createSchema = z
  .object({
    itemCodeOverride: z.string().trim().max(50).nullable().optional(),
    /** "I have checked the amount": needed when an imported report's total differs from the sheet's. */
    mismatchConfirmed: z.boolean().optional(),
    runMode: z.enum(['dry_run', 'draft_only', 'full']).optional(),
  })
  .strict();

/** Clicking "Load on TCS iON": validates, stores the job and returns at once. Playwright never runs in this request. */
ionRouter.post(
  '/reports/:id/push',
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req);
    res.status(201).json(await createPush(req.params.id!, currentUser(req), body));
  }),
);

ionRouter.post(
  '/reports/:id/retry',
  asyncHandler(async (req, res) => {
    res.json(await retryPush(req.params.id!, currentUser(req)));
  }),
);

ionRouter.post(
  '/reports/:id/continue',
  asyncHandler(async (req, res) => {
    res.json(await continueToSubmit(req.params.id!, currentUser(req)));
  }),
);

const resetSchema = z.object({ confirm: z.string().min(1), note: z.string().min(1).max(500) }).strict();

ionRouter.post(
  '/reports/:id/reset',
  asyncHandler(async (req, res) => {
    const body = parseBody(resetSchema, req);
    const { warning } = await resetPush(req.params.id!, currentUser(req), body);
    res.json({ view: await getReportView(req.params.id!), warning });
  }),
);

ionRouter.get(
  '/screenshots/:id',
  asyncHandler(async (req, res) => {
    const shot = await getScreenshot(req.params.id!);
    res.setHeader('Content-Type', shot.mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(shot.data);
  }),
);
