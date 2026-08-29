/**
 * Cross-origin guard for the bridge's HTTP and WebSocket surfaces.
 *
 * The bridge is localhost-only but the browser is the real boundary: any web
 * page can send no-preflight requests (text/plain POSTs pass through
 * readJsonBody) and open WebSockets to it. The rule:
 * - no Origin header → allow (curl, scripts, non-browser clients);
 * - Origin hostname is loopback (localhost / 127.0.0.1 / ::1 / *.localhost,
 *   any port) → allow — covers the served UI, the vite dev proxy, and
 *   same-machine access;
 * - Origin hostname equals the request Host (port-insensitive) → allow —
 *   covers the bridge bound to a non-loopback address and accessed
 *   same-origin. A DNS-rebinding request carries an attacker Host equal to
 *   its Origin, so this rule accepts such pages; browsers cannot be
 *   cross-site in any other way (Host is a forbidden header).
 * - anything else → reject (403 / socket destroy).
 */

function hostnameOf(origin) {
  try {
    // WHATWG URL keeps IPv6 brackets in hostname ("[::1]"); normalize away.
    return new URL(origin).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname) {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost")
  );
}

/** Host header hostname, bracket-aware for IPv6 literals ("[::1]:8787" → "::1"). */
function hostHostname(host) {
  const value = String(host).toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value.slice(1) : value.slice(1, end);
  }
  return value.split(":")[0];
}

export function isAllowedOrigin(origin, host) {
  if (!origin) return true; // non-browser client: no Origin to judge
  const originHost = hostnameOf(origin);
  if (!originHost) return false; // malformed (e.g. the string "null")
  if (isLoopbackHost(originHost)) return true;
  if (host && originHost === hostHostname(host)) return true;
  return false;
}
