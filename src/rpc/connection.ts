/**
 * Per-connection identity for the bridge's REST surface. Each WebSocket gets
 * a connection id from the bridge; REST calls carry it so cwd-scoped
 * endpoints (files, skills, branches, scratch, cwd switching) resolve against
 * the calling tab's agent working directory instead of a process-global one.
 *
 * Single-client invariant: exactly one OmpRpcClient exists per page (the
 * store's module singleton) and it owns the id below. A second client would
 * clobber it on every connection frame.
 */
import { getStoredToken } from "../lib/auth";

let connectionId: string | null = null;

export function setConnectionId(id: string | null): void {
  connectionId = id;
}

export function getConnectionId(): string | null {
  return connectionId;
}

/** fetch with the bridge connection header and access token attached. */
export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  if (connectionId) headers.set("x-omp-web-connection", connectionId);
  // An explicit token header (e.g. the token gate's validation probe) wins
  // over the stored one.
  if (!headers.has("x-omp-web-token")) {
    const token = getStoredToken();
    if (token) headers.set("x-omp-web-token", token);
  }
  return fetch(path, { ...init, headers });
}
