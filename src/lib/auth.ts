/**
 * Bridge access token plumbing (mirrors server/auth-token.mjs). The page
 * presents the token on /api calls as the `x-omp-web-token` header and on
 * the WebSocket as `?token=`. The first visit carries `?token=` in the URL —
 * consumed into localStorage once, then stripped so it never lingers in the
 * address bar, history, or referrers.
 */
const TOKEN_KEY = "omp-web.token";

export function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } catch {
    // Storage unavailable (private mode): the header just won't be sent;
    // the URL token keeps working for this session.
  }
}

/** Persist a `?token=` URL param and scrub it from the address bar. */
export function consumeUrlToken(): boolean {
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token");
  if (!token) return false;
  storeToken(token);
  url.searchParams.delete("token");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  return true;
}
