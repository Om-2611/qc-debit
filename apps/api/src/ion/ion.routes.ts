import { Router } from 'express';
import { asyncHandler } from '../lib/http';
import { preflightReport } from './load';

/** Mounted at /api/ion behind requireAuth + requireAdmin. */
export const ionRouter = Router();

/** What is missing or wrong before this report can be loaded on TCS iON; the payload is included once nothing blocks. */
ionRouter.get(
  '/reports/:id/preflight',
  asyncHandler(async (req, res) => {
    res.json(await preflightReport(req.params.id!));
  }),
);
