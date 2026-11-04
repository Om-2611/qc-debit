import { Router } from 'express';
import { calculateReport } from '@dalmia/calc';
import { loadEngineConfig } from '../config/engine-config';
import { asyncHandler, parseBody } from '../lib/http';
import { calcInputSchema } from './calc-input.schema';

/** POST /api/reports/preview-calc — stateless: input → engine output, using the server's current config. */
export const previewCalcRouter = Router();

previewCalcRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = parseBody(calcInputSchema, req);
    const config = await loadEngineConfig();
    res.json({ config, output: calculateReport({ ...input, config }) });
  }),
);
