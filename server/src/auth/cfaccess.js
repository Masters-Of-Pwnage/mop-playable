import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * Cloudflare Access in front of /api/admin/* (pentest N-2, public hosting behind a Cloudflare
 * Tunnel). Cloudflare already blocks the request at the edge; checking the JWT it adds here too
 * means a route left out of the Access application, or a request that reaches the server some
 * other way, still gets nothing. Off unless CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are set.
 * Returns verify(req) -> true | false, or null when Access is not configured.
 */
export function cfAccessVerifier(config) {
  const { teamDomain, aud, certsUrl } = config.cfAccess;
  if (!teamDomain || !aud) return null;
  const issuer = teamDomain.startsWith('https://') ? teamDomain.replace(/\/+$/, '') : `https://${teamDomain}`;
  const jwks = createRemoteJWKSet(new URL(certsUrl || `${issuer}/cdn-cgi/access/certs`), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
  return async (req) => {
    const token = req.headers['cf-access-jwt-assertion'];
    if (typeof token !== 'string' || token.length > 8192) return false;
    try {
      await jwtVerify(token, jwks, { issuer, audience: aud, algorithms: ['RS256'] });
      return true;
    } catch {
      return false;
    }
  };
}
