import type { RpcCommand, RpcFrame, RpcResponseFrame } from "./types";

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
  #frameSinks = new Set<FrameSink>();
  #statusSinks = new Set<StatusSink>();
  #attempt = 0;
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

  /** Send an RPC command and correlate its response by generated id. */
  request<TData = unknown>(
    command: RpcCommand,
    timeoutMs = 300_000,
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
      this.#attempt = 0;
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
      this.#setStatus("reconnecting");
      const delay = Math.min(1000 * 2 ** this.#attempt, MAX_BACKOFF_MS);
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
