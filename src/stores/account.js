/**
 * Account store: Google login state and the JSON API client (docs/sdd/01-login-google.md §6).
 * Accounts only exist when the page is served by the game server itself (same-origin cookie);
 * the GitHub Pages build sets VITE_ACCOUNTS=0 and stays guest-only.
 */
import { reactive, readonly } from 'vue';

const ENABLED = import.meta.env.VITE_ACCOUNTS !== '0';

const state = reactive({ enabled: false, loaded: false, user: null, features: [], privacy: { controller: '', contact: '' } });
let csrfToken = '';
let markReady;
/** Resolves once the first loadAccount() finished (route guards wait for it). */
export const accountReady = new Promise((resolve) => { markReady = resolve; });

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

/**
 * JSON request to /api. Mutations carry the CSRF token and an idempotency key.
 * opts.headers adds headers (e.g. If-Match); opts.text returns the body as text (CSV export);
 * opts.cache is passed to fetch (the public catalog is cacheable for 60 s).
 */
export async function api(method, path, body, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET') {
    headers['X-CSRF-Token'] = csrfToken;
    headers['Idempotency-Key'] = crypto.randomUUID();
  }
  const res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: opts.cache || 'default' });
  if (opts.text && res.ok) return res.text();
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && state.user) state.user = null; // session expired or revoked elsewhere
    const err = new ApiError(res.status, data.error || `http_${res.status}`, data.message);
    err.data = data;
    throw err;
  }
  return data;
}

export async function loadAccount() {
  if (!ENABLED) {
    state.loaded = true;
    markReady();
    return;
  }
  try {
    const { features, privacy } = await api('GET', '/features');
    state.features = features;
    if (privacy) state.privacy = privacy;
    state.enabled = features.includes('accounts');
    if (state.enabled) await refreshMe();
  } catch {
    state.enabled = false; // static hosting without the API
  } finally {
    state.loaded = true;
    markReady();
  }
}

export async function refreshMe() {
  try {
    const me = await api('GET', '/me');
    csrfToken = me.csrfToken;
    const { csrfToken: _token, features, ...user } = me;
    state.user = user;
    state.features = features;
  } catch (err) {
    if (err.status !== 401) throw err;
    state.user = null;
  }
}

/** Leaves the SPA for Google; the server brings the player back to the same route. */
export function login({ stepUp = false } = {}) {
  const returnTo = window.location.hash || '#/';
  window.location.assign(`/api/auth/google/start?return_to=${encodeURIComponent(returnTo)}${stepUp ? '&step_up=1' : ''}`);
}

export async function logout(all = false) {
  try {
    await api('POST', all ? '/auth/logout-all' : '/auth/logout');
  } finally {
    state.user = null;
    csrfToken = '';
  }
}

export async function updateProfile(changes) {
  const user = await api('PATCH', '/me', changes);
  state.user = { ...state.user, ...user };
  return state.user;
}

export const hasFeature = (name) => state.features.includes(name);
export const isStaff = () => ['moderator', 'admin', 'owner'].includes(state.user?.role);

export const account = readonly(state);
