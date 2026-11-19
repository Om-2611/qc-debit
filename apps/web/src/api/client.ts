import type { ApiError, LoginResponse } from '@dalmia/types';

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

// The access token lives in memory only; the refresh token is an httpOnly cookie the script cannot read.
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;
let refreshInFlight: Promise<LoginResponse | null> | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const setSessionLostHandler = (handler: (() => void) | null): void => {
  onSessionLost = handler;
};

async function toError(res: Response): Promise<ApiRequestError> {
  let body: Partial<ApiError> = {};
  try {
    body = (await res.json()) as Partial<ApiError>;
  } catch {
    // non-JSON error body (e.g. the API is down and the dev proxy answered)
  }
  return new ApiRequestError(
    res.status,
    body.error ?? 'ERROR',
    body.message ?? (res.status >= 500 ? 'The server is not responding. Please try again.' : res.statusText),
    body.details,
  );
}

/** Single-flight: concurrent 401s share one refresh, because refresh tokens are one-time-use. */
export function refreshSession(): Promise<LoginResponse | null> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (!res.ok) return null;
      const data = (await res.json()) as LoginResponse;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      signal: options.signal,
      headers: {
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await send();
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await send();
    } else {
      accessToken = null;
      onSessionLost?.();
    }
  }
  if (!res.ok) throw await toError(res);
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

/**
 * Downloads a file from an authenticated endpoint. A plain <a href> cannot send the bearer token,
 * so the file is fetched as a blob and handed to the browser under the server's file name.
 */
export async function downloadFile(path: string): Promise<void> {
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });

  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw await toError(res);

  const disposition = res.headers.get('Content-Disposition') ?? '';
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  const plain = /filename="([^"]+)"/i.exec(disposition)?.[1];
  const name = encoded ? decodeURIComponent(encoded) : (plain ?? 'download');

  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Fetches an authenticated file (an image, say) and returns an object URL for it. The caller revokes it when done. */
export async function fetchBlobUrl(path: string): Promise<string> {
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, { credentials: 'include', headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });

  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw await toError(res);
  return URL.createObjectURL(await res.blob());
}

/**
 * POSTs a multipart form (file upload) with the same token and refresh handling as `api()`.
 * No Content-Type header is set: the browser adds it together with the multipart boundary.
 */
export async function apiUpload<T>(path: string, formData: FormData): Promise<T> {
  const send = (): Promise<Response> =>
    fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      body: formData,
    });

  let res = await send();
  if (res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) {
      res = await send();
    } else {
      accessToken = null;
      onSessionLost?.();
    }
  }
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}
