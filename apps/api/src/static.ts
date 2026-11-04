import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';

/**
 * Production only: serves the built web app (apps/web/dist) from the API's own origin when the
 * WEB_DIST environment variable points at it. In development Vite serves the web app and proxies /api.
 */
export function serveWebApp(app: Express, webDist: string | undefined): void {
  if (!webDist) return;
  const root = path.resolve(webDist);
  const indexHtml = path.join(root, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    console.warn(`WEB_DIST is set to ${root}, but there is no index.html there; the web app will not be served.`);
    return;
  }

  // Hashed build assets never change, so they can be cached for a year; index.html must always be fresh.
  app.use('/assets', express.static(path.join(root, 'assets'), { immutable: true, maxAge: '365d' }));
  // The push service worker must never be served stale, or a fix to it would take hours to reach browsers.
  app.get('/sw.js', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(root, 'sw.js'));
  });
  app.use(express.static(root, { index: false, maxAge: '1h' }));

  // Client-side routes (/reports/abc, /settings/users …) all load the single-page app.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
