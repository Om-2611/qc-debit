import { Router, type RequestHandler } from 'express';
import multer from 'multer';
import { IMPORT_MAX_FILE_BYTES, importCommitSchema } from '@dalmia/types';
import { currentUser } from '../auth/middleware';
import { HttpError, badRequest } from '../lib/errors';
import { asyncHandler, parseBody } from '../lib/http';
import { commitImport, createPreview, listBatches, undoBatch } from './import.service';

/** Mounted at /api/admin/import behind requireAuth + requireAdmin: loading old workbooks is ADMIN only. */
export const importRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMPORT_MAX_FILE_BYTES, files: 1 } }).single('file');

/** Multer's own errors would surface as 500s; they are the user's to fix, so they become 4xx. */
const receiveFile: RequestHandler = (req, res, next) => {
  upload(req, res, (err: unknown) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      return next(
        err.code === 'LIMIT_FILE_SIZE'
          ? new HttpError(413, 'FILE_TOO_LARGE', `The file is larger than ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB.`)
          : badRequest('Upload one Excel file in the field “file”.'),
      );
    }
    next(err);
  });
};

importRouter.post(
  '/preview',
  receiveFile,
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Choose an Excel file (.xlsx) to upload.');
    // Browsers send the name as latin1 bytes; this restores names such as "गाड़ी.xlsx".
    const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const fileName = (decoded.includes('�') ? file.originalname : decoded).slice(0, 200);
    // An .xlsx is a zip archive ("PK"); the old binary .xls format is not supported.
    if (!/\.xlsx$/i.test(fileName) || file.buffer.subarray(0, 2).toString('latin1') !== 'PK') {
      throw badRequest('Only .xlsx workbooks can be imported. Save older .xls files as .xlsx in Excel first.');
    }
    res.json(await createPreview(currentUser(req), fileName, file.buffer));
  }),
);

importRouter.post(
  '/commit',
  asyncHandler(async (req, res) => {
    res.json(await commitImport(currentUser(req), parseBody(importCommitSchema, req)));
  }),
);

importRouter.get(
  '/batches',
  asyncHandler(async (_req, res) => {
    res.json(await listBatches());
  }),
);

importRouter.delete(
  '/batches/:id',
  asyncHandler(async (req, res) => {
    res.json(await undoBatch(currentUser(req), req.params.id!));
  }),
);
