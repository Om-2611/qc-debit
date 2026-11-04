import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { materialsRouter } from './admin/materials.routes';
import { parametersRouter } from './admin/parameters.routes';
import { settingsRouter } from './admin/settings.routes';
import { suppliersRouter } from './admin/suppliers.routes';
import { usersRouter } from './admin/users.routes';
import { authRouter, meRouter } from './auth/auth.routes';
import { requireAdmin, requireAuth } from './auth/middleware';
import { dashboardRouter } from './dashboard/dashboard.routes';
import { env } from './env';
import { importRouter } from './import/import.routes';
import { errorHandler, notFoundHandler } from './lib/errors';
import { lookupsRouter } from './lookups.routes';
import { notificationsRouter } from './notifications/notifications.routes';
import { previewCalcRouter } from './reports/preview-calc.routes';
import { reportsRouter } from './reports/reports.routes';
import { serveWebApp } from './static';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/me', meRouter);

  // Every route below requires a signed-in user; role guards are applied per router/route.
  app.use('/api', requireAuth);
  app.use('/api/lookups', lookupsRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/reports/preview-calc', previewCalcRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/admin', requireAdmin);
  app.use('/api/admin/users', usersRouter);
  app.use('/api/admin/suppliers', suppliersRouter);
  app.use('/api/admin/materials', materialsRouter);
  app.use('/api/admin/parameters', parametersRouter);
  app.use('/api/admin/settings', settingsRouter);
  app.use('/api/admin/import', importRouter);
  app.use('/api/dashboard', dashboardRouter);

  serveWebApp(app, env.WEB_DIST);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
