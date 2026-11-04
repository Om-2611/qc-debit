import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';

/** Express 4 does not forward rejected promises to the error handler; this does. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Parse with zod; a ZodError becomes a 400 in the error handler. */
export const parseBody = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> => schema.parse(req.body);
export const parseQuery = <S extends ZodTypeAny>(schema: S, req: Request): z.infer<S> => schema.parse(req.query);
