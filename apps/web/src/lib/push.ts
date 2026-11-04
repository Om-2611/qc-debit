import type { PushSubscriptionInput } from '@dalmia/types';
import { api } from '../api/client';

/**
 * Browser push: the service worker (public/sw.js) shows the notification; the server keeps one subscription
 * per browser, linked to whoever is signed in there.
 */

export type PushState = 'unsupported' | 'insecure' | 'default' | 'granted' | 'denied';
/** 'on' = this browser is subscribed; permission alone ('granted') is not enough. */
export type DevicePushState = Exclude<PushState, 'granted'> | 'granted-not-subscribed' | 'on';

/** iPhone/iPad Safari only allows push for a site added to the home screen (iOS 16.4+). */
export const isIosBrowserTab = (): boolean =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window.matchMedia?.('(display-mode: standalone)').matches ?? false);

export function pushState(): PushState {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (!window.isSecureContext) return 'insecure';
  return Notification.permission;
}

export async function devicePushState(): Promise<DevicePushState> {
  const state = pushState();
  if (state !== 'granted') return state;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return (await reg?.pushManager.getSubscription()) ? 'on' : 'granted-not-subscribed';
}

const registration = (): Promise<ServiceWorkerRegistration> => navigator.serviceWorker.register('/sw.js');

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = (value + '='.repeat((4 - (value.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

const sameKey = (a: ArrayBuffer, b: Uint8Array): boolean => {
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
};

const toInput = (s: PushSubscription): PushSubscriptionInput => s.toJSON() as PushSubscriptionInput;

/** Asks for permission (must run from a click) and registers this browser for the signed-in user. */
export async function enablePush(publicKey: string): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const serverKey = base64UrlToBytes(publicKey);
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with a different server key (keys rotated) cannot receive; replace it.
  const current = subscription?.options.applicationServerKey;
  if (subscription && current && !sameKey(current, serverKey)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey as BufferSource });
  await api<void>('/notifications/push-subscriptions', { method: 'POST', body: toInput(subscription) });
  return 'granted';
}

/** After sign-in: a browser that already allowed notifications is re-linked to the new user without asking again. */
export async function relinkPush(): Promise<void> {
  if (pushState() !== 'granted') return;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const subscription = await reg?.pushManager.getSubscription();
  if (subscription) await api<void>('/notifications/push-subscriptions', { method: 'POST', body: toInput(subscription) });
}

/** Before sign-out: stop this browser receiving the signed-out user's notifications. Best effort. */
export async function unlinkPush(): Promise<void> {
  try {
    if (pushState() === 'unsupported') return;
    const reg = await navigator.serviceWorker.getRegistration('/');
    const subscription = await reg?.pushManager.getSubscription();
    if (subscription) await api<void>('/notifications/push-subscriptions', { method: 'DELETE', body: { endpoint: subscription.endpoint } });
  } catch {
    // Signing out must never fail because of push.
  }
}
