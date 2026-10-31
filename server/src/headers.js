/**
 * Security headers (docs/sdd/00-arquitetura.md S6, pentest N-4). Pages get a CSP that only allows
 * this origin; JSON, media and other data get `default-src 'none'; sandbox`. CSP_MODE=report sends
 * the page policy as Report-Only, as an escape hatch while a new asset type is being checked.
 */
const cache = new WeakMap();

function build(config) {
  const https = config.publicUrl.startsWith('https://');
  const common = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  };
  // Only the exact host: other names under the same domain may not be on HTTPS.
  if (https) common['Strict-Transport-Security'] = 'max-age=31536000';
  const wsOrigins = [config.publicUrl, ...config.allowedOrigins]
    .filter((o) => /^https?:\/\//.test(o))
    .map((o) => new URL(o).origin.replace(/^http/, 'ws'));
  if (config.publicWsUrl) wsOrigins.push(new URL(config.publicWsUrl).origin);
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self'",
    // Google profile pictures (avatar_url from the login).
    "img-src 'self' data: blob: https://lh3.googleusercontent.com",
    "media-src 'self' blob:",
    `connect-src 'self' ${[...new Set(wsOrigins)].join(' ')}`.trim(),
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const pageCsp = config.cspMode === 'report' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  return {
    common,
    page: { ...common, 'Cross-Origin-Opener-Policy': 'same-origin', [pageCsp]: csp },
    data: { ...common, 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox" },
  };
}

/** kind: 'page' (HTML), 'data' (JSON, media, SVG) or 'common' (scripts, styles, fonts, images). */
export function securityHeaders(config, kind = 'data') {
  if (!cache.has(config)) cache.set(config, build(config));
  return cache.get(config)[kind];
}
