import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession, isActive, readSession, revokeSession, SESSION_COOKIE, sessionCookieOptions } from './session.js';
import { upsertGoogleUser } from './users.js';
import { grantSignup } from '../economy/grants.js';

const OAUTH_COOKIE = 'mop_oauth';
const OAUTH_COOKIE_PATH = '/api/auth/google';
const RETURN_TO = /^#\/[A-Za-z0-9\-._~/?=&%]{0,200}$/;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sameString = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Only an in-app hash route may be the destination after login (no open redirect). */
export function safeReturnTo(value) {
  return typeof value === 'string' && RETURN_TO.test(value) && !value.includes('//') ? value : '#/';
}

/**
 * Google sign-in: OAuth 2.0 authorization code + PKCE, OpenID Connect ID token verified here
 * (docs/sdd/01-login-google.md). No Google script runs in the page.
 *   GET /api/auth/google/start?return_to=#/decks
 *   GET /api/auth/google/callback
 */
export function registerGoogleAuth(app, { db, config, starter = [] }) {
  const { oidc } = config;
  const jwks = createRemoteJWKSet(new URL(oidc.jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
  const redirectUri = () => `${config.publicUrl}${OAUTH_COOKIE_PATH}/callback`;
  const site = (hash) => `${config.siteBase}${hash}`;
  const oauthCookie = { path: OAUTH_COOKIE_PATH, httpOnly: true, sameSite: 'lax', secure: config.publicUrl.startsWith('https://'), signed: true };

  app.get(`${OAUTH_COOKIE_PATH}/start`, async (req, reply) => {
    const state = b64url(randomBytes(24));
    const nonce = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(32));
    const returnTo = safeReturnTo(req.query.return_to);
    reply.setCookie(OAUTH_COOKIE, JSON.stringify({ state, nonce, verifier, returnTo }), { ...oauthCookie, maxAge: 600 });
    const url = new URL(oidc.authUrl);
    url.search = new URLSearchParams({
      client_id: config.googleClientId,
      redirect_uri: redirectUri(),
      response_type: 'code',
      scope: 'openid email profile',
      state,
      nonce,
      code_challenge: b64url(createHash('sha256').update(verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
      // Step-up for sensitive admin actions (00-arquitetura S4): force a fresh login.
      ...(req.query.step_up === '1' ? { max_age: '0' } : {}),
    }).toString();
    return reply.redirect(url.toString(), 302);
  });

  app.get(`${OAUTH_COOKIE_PATH}/callback`, async (req, reply) => {
    const fail = (reason, hash = '#/?login=erro') => {
      if (reason) console.warn(`[mop-server] login Google recusado: ${reason}`);
      return reply.redirect(site(hash), 302);
    };
    const raw = req.cookies?.[OAUTH_COOKIE];
    reply.clearCookie(OAUTH_COOKIE, { path: OAUTH_COOKIE_PATH });
    const unsigned = raw ? req.unsignCookie(raw) : null;
    let saved = null;
    try {
      saved = unsigned?.valid ? JSON.parse(unsigned.value) : null;
    } catch {
      saved = null;
    }
    if (!saved) return fail('cookie de estado ausente ou inválido');
    if (req.query.error) return fail(null, '#/?login=cancelado');
    if (!sameString(req.query.state, saved.state)) return fail('state não confere');
    if (typeof req.query.code !== 'string' || req.query.code.length > 2048) return fail('code ausente');

    let idToken;
    try {
      const res = await fetch(oidc.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: req.query.code,
          redirect_uri: redirectUri(),
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          code_verifier: saved.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || typeof body.id_token !== 'string') return fail(`token endpoint respondeu ${res.status}`);
      idToken = body.id_token; // the access token is not used and not kept
    } catch (err) {
      return fail(`falha ao falar com o Google (${err.name})`);
    }

    let claims;
    try {
      ({ payload: claims } = await jwtVerify(idToken, jwks, {
        issuer: oidc.issuers,
        audience: config.googleClientId,
        algorithms: ['RS256'],
        clockTolerance: 30,
      }));
    } catch (err) {
      return fail(`ID token inválido (${err.code || err.name})`);
    }
    if (!sameString(claims.nonce, saved.nonce)) return fail('nonce não confere');
    if (claims.azp !== undefined && claims.azp !== config.googleClientId) return fail('azp não confere');
    if (typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255) return fail('sub inválido');

    const { user } = upsertGoogleUser(db, claims, config, req.clientIp, (created) => grantSignup(db, created, starter));
    if (!isActive(user)) return fail(`conta ${user.status}`, '#/?login=suspensa');

    // A new login always gets a new session id (no fixation through an old cookie).
    const previous = readSession(db, req.cookies?.[SESSION_COOKIE]);
    if (previous) revokeSession(db, previous.idHash);
    const authTime = Number.isInteger(claims.auth_time) ? claims.auth_time * 1000 : Date.now();
    const token = createSession(db, user, { authTime, ip: req.clientIp, userAgent: req.headers['user-agent'] });
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(config, user.role));
    return reply.redirect(site(saved.returnTo), 302);
  });
}
