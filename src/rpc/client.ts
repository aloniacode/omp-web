import type { RpcCommand, RpcFrame, RpcResponseFrame } from "./types";
import { coalesceKey } from "../lib/idempotency";

export type ConnStatus = "connecting" | "connected" | "reconnecting" | "closed";

type FrameSink = (frame: RpcFrame) => void;
type StatusSink = (status: ConnStatus) => void;

interface PendingRequest {
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
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      reject(new Error(`RPC "${command.type}" timed out`));
    }, timeoutMs);
    // The wire resolves with an unparameterized frame; the caller owns TData.
    const entry: PendingRequest = {
      resolve: resolve as (response: RpcResponseFrame) => void,
      reject,
      timer,
    };
    this.#pending.set(id, entry);
    try {
      this.#sendRaw(frame);
    } catch (err) {
      clearTimeout(timer);
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
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/ws`);
    this.#ws = ws;
    this.#setStatus(this.#attempt === 0 ? "connecting" : "reconnecting");

    ws.onopen = () => {
      this.#openedAt = Date.now();
      this.#setStatus("connected");
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
      // Tolerant wire union: runtime payloads outrun the static surface.
      const rpcFrame = frame as RpcFrame;
      for (const sink of this.#frameSinks) sink(rpcFrame);
    };

    ws.onerror = () => {
      // onclose always follows; reconnection handled there.
    };

    ws.onclose = () => {
      this.#ws = null;
      this.#failAllPending(new Error("connection to agent bridge lost"));
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

  #sendRaw(frame: Record<string, unknown>) {
    if (this.#ws?.readyState !== WebSocket.OPEN) {
      throw new Error("not connected");
    }
    this.#ws.send(JSON.stringify(frame));
  }

  #failAllPending(error: Error) {
    for (const [, entry] of this.#pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.#pending.clear();
  }
}
