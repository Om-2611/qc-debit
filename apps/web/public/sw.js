/*
 * Service worker for browser push notifications (hand-offs between desks).
 * Served from the site root with no caching, so a change here reaches browsers on the next visit.
 * It does not cache pages or work offline; it only shows notifications and opens the report on click.
 */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'QC Debit Notes';
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: data.body || '',
        icon: '/brand/favicon.png',
        badge: '/brand/favicon.png',
        tag: data.tag,
        renotify: Boolean(data.tag),
        data: { url: data.url || '/' },
      }),
      // Open tabs refresh their bell straight away instead of waiting for the next poll.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
        for (const tab of tabs) tab.postMessage({ type: 'notification' });
      }),
    ]),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (tabs) => {
      const tab = tabs.find((t) => new URL(t.url).origin === self.location.origin);
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: 'navigate', url: new URL(url).pathname });
        return;
      }
      await self.clients.openWindow(url);
    }),
  );
});
