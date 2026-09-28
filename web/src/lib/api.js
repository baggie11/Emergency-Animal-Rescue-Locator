/**
 * Thin fetch wrapper.
 *
 * Two jobs beyond calling fetch:
 *  1. Normalise API errors into a real Error with a `.status` and a message a
 *     human can read, so components never show "[object Object]".
 *  2. Serve the last successful response from localStorage when the network is
 *     unavailable, so the results list still renders on a dead 3G connection.
 */

const CACHE_PREFIX = 'rescue-nearby:v1:';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Base URL for API calls.
 *
 * Empty in the normal deployment: the Express server serves both the SPA and
 * /api, so relative paths are correct and avoid CORS entirely. Set
 * VITE_API_BASE=https://api.example.org only when the frontend is hosted
 * separately from the API.
 */
export const API_BASE = (import.meta.env?.VITE_API_BASE || '').replace(/\/$/, '');

const url = (path) => `${API_BASE}${path}`;

export class ApiError extends Error {
  constructor(message, { status = 0, details = null, offline = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    this.offline = offline;
  }
}

const cacheKey = (path) => `${CACHE_PREFIX}${path}`;

export function readCache(path) {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || Date.now() - entry.at > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(path));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function writeCache(path, data) {
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Private mode / quota exceeded. Caching is best-effort, never fatal.
  }
}

async function request(path, { method = 'GET', body, form, signal, cache = true } = {}) {
  const init = { method, signal, credentials: 'same-origin' };
  if (form) {
    init.body = form;
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  const href = url(path);
  let res;
  try {
    res = await fetch(href, init);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    const cached = method === 'GET' && cache ? readCache(href) : null;
    if (cached) {
      return { ...cached.data, __fromCache: true, __cachedAt: cached.at };
    }
    throw new ApiError(
      navigator.onLine
        ? 'Could not reach the server. Check your connection and try again.'
        : 'You appear to be offline and no saved results are available yet.',
      { offline: true },
    );
  }

  if (res.status === 204) return null;

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    throw new ApiError(data?.error || `Request failed (${res.status})`, {
      status: res.status,
      details: data?.details,
    });
  }

  if (method === 'GET' && cache && res.ok) writeCache(href, data);
  return data;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    if (Array.isArray(value)) {
      if (value.length) search.set(key, value.join(','));
    } else {
      search.set(key, String(value));
    }
  }
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  health: () => request('/api/health', { cache: false }),

  meta: () => request('/api/meta'),

  config: () => request('/api/config'),

  updateConfig: (patch) => request('/api/config', { method: 'PUT', body: patch }),

  nearby: (params) => request(`/api/orgs/nearby${qs(params)}`),

  searchLocalities: (q) => request(`/api/orgs/search${qs({ q })}`),

  getOrg: (id) => request(`/api/orgs/${id}`, { cache: false }),

  listOrgs: () => request('/api/orgs', { cache: false }),

  // --- public community signals ---
  // Never cached: a stale "thanks, reported" is worse than no answer, and these
  // are one-shot actions that must never replay from the offline cache.

  flagOrg: (id, payload) =>
    request(`/api/orgs/${id}/flag`, { method: 'POST', body: payload, cache: false }),

  confirmOrg: (id) => request(`/api/orgs/${id}/confirm`, { method: 'POST', cache: false }),

  // --- admin ---
  session: () => request('/api/auth/session', { cache: false }),

  login: (username, password) =>
    request('/api/auth/login', { method: 'POST', body: { username, password }, cache: false }),

  logout: () => request('/api/auth/logout', { method: 'POST', cache: false }),

  createOrg: (org) => request('/api/orgs/admin', { method: 'POST', body: org, cache: false }),

  updateOrg: (id, org) => request(`/api/orgs/admin/${id}`, { method: 'PUT', body: org, cache: false }),

  deleteOrg: (id) => request(`/api/orgs/admin/${id}`, { method: 'DELETE', cache: false }),

  requestQueue: (status) => request(`/api/requests/admin/queue${qs({ status })}`, { cache: false }),

  setRequestStatus: (id, payload) =>
    request(`/api/requests/admin/${id}/status`, { method: 'POST', body: payload, cache: false }),

  // --- public reporting ---
  createRequest: (payload) => request('/api/requests', { method: 'POST', body: payload, cache: false }),

  shareMessage: (payload) => request('/api/share-message', { method: 'POST', body: payload, cache: false }),

  uploadPhoto: (file, { onProgress, signal } = {}) => {
    if (!file) throw new ApiError('No file selected');
    if (file.size > 8 * 1024 * 1024) throw new ApiError('Photo is too large (max 8 MB)');

    // XHR rather than fetch: upload progress matters on a phone connection, and
    // the user needs to know it is actually progressing before they walk away.
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('photo', file);

      const xhr = new XMLHttpRequest();
      xhr.open('POST', url('/api/upload'));
      xhr.withCredentials = true;
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        let data = null;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          data = null;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          // The server returns a root-relative path. In a split deployment the
          // image lives on the API origin, not the page origin.
          resolve(
            data?.url?.startsWith('/')
              ? { ...data, url: url(data.url) }
              : data,
          );
        } else {
          reject(new ApiError(data?.error || `Upload failed (${xhr.status})`, { status: xhr.status }));
        }
      });
      xhr.addEventListener('error', () =>
        reject(new ApiError('Upload failed. Check your connection and try again.', { offline: true })),
      );
      xhr.addEventListener('abort', () => {
        const err = new ApiError('Upload cancelled');
        err.name = 'AbortError';
        reject(err);
      });
      signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(form);
    });
  },
};
