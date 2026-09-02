import type { RpcCommand, RpcFrame, RpcResponseFrame } from "./types";
import { coalesceKey, isReplayable } from "../lib/idempotency";
import { getStoredToken } from "../lib/auth";
import { setConnectionId } from "./connection";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "closed";

type FrameSink = (frame: RpcFrame) => void;
type StatusSink = (status: ConnStatus) => void;

interface PendingRequest {
  command: RpcCommand;
  timeoutMs: number;
  resolve: (response: RpcResponseFrame) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function isResponseFrame(value: unknown): value is RpcResponseFrame {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "response"
  );
}

const MAX_BACKOFF_MS = 15_000;
/** A connection must stay open this long to count as "stable" and reset backoff. */
const STABLE_CONN_MS = 10_000;
/**
 * Browser-side RPC channel. One WebSocket (`/ws`, proxied to the bridge) maps
 * to one `omp --mode rpc` child process owned by the bridge. Frames pass
 * through transparently; protocol v2 chunk reassembly already happened
 * bridge-side.
 */
export class OmpRpcClient {
  #ws: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<string, PendingRequest>();
  /** In-flight idempotent commands by coalesce key: duplicates share one request. */
  #inflight = new Map<string, Promise<RpcResponseFrame>>();
  #frameSinks = new Set<FrameSink>();
  #statusSinks = new Set<StatusSink>();
  #attempt = 0;
  #openedAt = 0;
  #userClosed = false;
  #disposed = false;
  #retryTimer?: ReturnType<typeof setTimeout>;

  status: ConnStatus = "connecting";

  onFrame(sink: FrameSink): () => void {
    this.#frameSinks.add(sink);
    return () => this.#frameSinks.delete(sink);
  }

  onStatus(sink: StatusSink): () => void {
    this.#statusSinks.add(sink);
    return () => this.#statusSinks.delete(sink);
  }

  start(): void {
    this.#userClosed = false;
    if (this.#ws && (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING)) return;
    this.#open();
  }

  dispose(): void {
    this.#disposed = true;
    this.#userClosed = true;
    clearTimeout(this.#retryTimer);
    this.#failAllPending(new Error("client disposed"));
    this.#ws?.close();
  }

  /** Drop the current socket (fresh child on next connect) and reset backoff. */
  reconnect(): void {
    this.#attempt = 0;
    clearTimeout(this.#retryTimer);
    if (this.#ws) this.#ws.close();
    else this.#open();
  }

  /**
   * Send an RPC command and correlate its response by generated id.
   * Idempotent commands with identical arguments are coalesced while in
   * flight: concurrent duplicates (double clicks, re-picks) share one
   * request instead of doubling agent work. Sharers inherit the first
   * caller's timeout — per-call timeout overrides do not apply to duplicates.
   */
  request<TData = unknown>(
    command: RpcCommand,
    timeoutMs = 300_000,
  ): Promise<RpcResponseFrame<TData>> {
    const key = coalesceKey(command);
    if (key) {
      const existing = this.#inflight.get(key) as Promise<RpcResponseFrame<TData>> | undefined;
      if (existing) return existing;
    }
    const promise = this.#doRequest<TData>(command, timeoutMs);
    if (key) {
      this.#inflight.set(key, promise as Promise<RpcResponseFrame>);
      // Cleanup registers on the request promise itself so it runs before any
      // caller continuation: a follow-up request right after a settle must
      // send, not silently coalesce with the just-settled entry.
      const cleanup = () => {
        if (this.#inflight.get(key) === promise) this.#inflight.delete(key);
      };
      void promise.then(cleanup, cleanup).catch(() => undefined);
    }
    return promise;
  }

  #doRequest<TData = unknown>(
    command: RpcCommand,
    timeoutMs: number,
  ): Promise<RpcResponseFrame<TData>> {
    const id = `web-${this.#nextId++}`;
    const frame = { ...command, id };
    const { promise, resolve, reject } = Promise.withResolvers<RpcResponseFrame<TData>>();
    // The wire resolves with an unparameterized frame; the caller owns TData.
    const entry: PendingRequest = {
      command,
      timeoutMs,
      resolve: resolve as (response: RpcResponseFrame) => void,
      reject,
      timer: setTimeout(() => undefined, 0),
    };
    this.#armTimer(id, entry);
    this.#pending.set(id, entry);
    try {
      this.#sendRaw(frame);
    } catch (err) {
      clearTimeout(entry.timer);
      this.#pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    return promise;
  }

  /** Send any stdin frame without correlation (extension UI responses, etc.). */
  send(frame: Record<string, unknown>): void {
    this.#sendRaw(frame);
  }

  // ── internals ─────────────────────────────────────────────────────────────

  #setStatus(status: ConnStatus) {
    if (this.status !== status) {
      this.status = status;
      for (const sink of this.#statusSinks) sink(status);
    }
  }

  #open() {
    if (this.#disposed) return;
    // A scheduled retry or a reconnect() call can land while a socket is
    // already open/connecting — opening twice would double-wire handlers and
    // double-replay pending requests.
    if (this.#ws && this.#ws.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    // The bridge access token rides the query string (WebSocket requests
    // cannot carry custom headers); read at connect time so a token entered
    // after boot is picked up by the next retry.
    const token = getStoredToken();
    const auth = token ? `?token=${encodeURIComponent(token)}` : "";
    const ws = new WebSocket(`${proto}//${location.host}/ws${auth}`);
    this.#ws = ws;
    this.#setStatus(this.#attempt === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      this.#openedAt = Date.now();
      this.#setStatus("connected");
      // A fresh agent child knows nothing of requests the dropped socket had
      // in flight; read-only ones are re-sent on the new socket under their
      // original ids with a fresh deadline, so the awaiting callers resolve
      // as if nothing happened.
      for (const [id, entry] of this.#pending) {
        if (!isReplayable(entry.command)) continue;
        try {
          this.#armTimer(id, entry);
          this.#sendRaw({ ...entry.command, id });
        } catch {
          break; // socket died again — the close handler takes over
        }
      }
    };

    ws.onmessage = (ev) => {
      let frame: unknown;
      try {
        frame = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (isResponseFrame(frame)) {
        const pending = frame.id !== undefined ? this.#pending.get(frame.id) : undefined;
        if (pending) {
          clearTimeout(pending.timer);
          this.#pending.delete(frame.id!);
          pending.resolve(frame);
        }
      }
      // The bridge tags each connection so REST calls can be routed to this
      // tab's agent working directory.
      const bridgeFrame = frame as { type?: string; event?: string; id?: string };
      if (bridgeFrame.type === "bridge_event" && bridgeFrame.event === "connection" && typeof bridgeFrame.id === "string") {
        setConnectionId(bridgeFrame.id);
      }
      // Tolerant wire union: runtime payloads outrun the static surface.
      const rpcFrame = frame as RpcFrame;
      for (const sink of this.#frameSinks) sink(rpcFrame);
    };

    ws.onerror = () => {
      // onclose always follows; reconnection handled there.
    };

    ws.onclose = () => {
      this.#ws = null;
      setConnectionId(null);
      // Read-only in-flight requests survive the drop (replayed on reopen);
      // everything else fails its caller now — prompts must not silently
      // re-send.
      this.#failPending(
        new Error("connection to agent bridge lost"),
        (entry) => !isReplayable(entry.command),
      );
      if (this.#userClosed || this.#disposed) {
        this.#setStatus("closed");
        return;
      }
      // Reset the backoff only when the connection proved stable; otherwise
      // flapping connections (socket opens, agent dies, bridge closes) would
      // loop forever at the initial 1s delay.
      if (Date.now() - this.#openedAt >= STABLE_CONN_MS) this.#attempt = 0;
      this.#setStatus("reconnecting");
      // Exponential backoff with jitter: 1s → 2s → 4s → … capped at 15s.
      const base = Math.min(1000 * 2 ** this.#attempt, MAX_BACKOFF_MS);
      const delay = base * (0.75 + Math.random() * 0.5);
      this.#attempt += 1;
      this.#retryTimer = setTimeout(() => this.#open(), delay);
    };
  }

  /** (Re)arm a pending entry's timeout — replayed requests get a fresh one. */
  #armTimer(id: string, entry: PendingRequest) {
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      this.#pending.delete(id);
      entry.reject(new Error(`RPC "${entry.command.type}" timed out`));
    }, entry.timeoutMs);
  }

  #sendRaw(frame: Record<string, unknown>) {
    if (this.#ws?.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }
    this.#ws.send(JSON.stringify(frame));
  }

  #failAllPending(error: Error) {
    this.#failPending(error, () => true);
  }

  #failPending(error: Error, predicate: (entry: PendingRequest) => boolean) {
    for (const [id, entry] of this.#pending) {
      if (!predicate(entry)) continue;
      clearTimeout(entry.timer);
      entry.reject(error);
      this.#pending.delete(id);
    }
  }
}
