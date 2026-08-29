/**
 * Shared type surface of the omp-web wire contract, consumed by the browser
 * UI (src/rpc) and produced/consumed by the bridge (server/*.mjs, which is
 * plain JavaScript and reads these via editors/JSDoc). Only the
 * bridge<->browser envelope and REST shapes live here — agent-message and
 * rendering-domain types stay in the UI.
 */

// ── RPC envelope (agent stdout -> bridge -> browser) ────────────────────────

export interface RpcReadyFrame {
  type: "ready";
  protocolVersion: number;
  supportedProtocolVersions?: number[];
  maxFrameBytes?: number;
  maxReassembledFrameBytes?: number;
}

export interface RpcChunkFrame {
  type: "rpc_chunk";
  chunkId: string;
  index: number;
  count: number;
  byteLength: number;
  data: string;
}

export interface RpcResponseFrame<TData = unknown> {
  id?: string;
  type: "response";
  command: string;
  success: boolean;
  data?: TData;
  error?: string;
  code?: string;
}

export interface PromptResultFrame {
  type: "prompt_result";
  id?: string;
  agentInvoked: boolean;
}

export interface CommandOutputFrame {
  type: "command_output";
  /** Tolerant: runtimes have used several field names across versions. */
  output?: string;
  text?: string;
  content?: unknown;
  command?: string;
  [k: string]: unknown;
}

export interface NoticeFrame {
  type: "notice";
  level: "info" | "warning" | "error";
  message: string;
  source?: string;
}

/** Events the bridge itself emits (not the agent). */
export interface BridgeEventFrame {
  type: "bridge_event";
  event: "spawn_error" | "agent_exit" | "frame_error" | "bad_frame";
  error?: string;
  hint?: string;
  code?: number | null;
  signal?: string | null;
}

// ── Bridge REST shapes (server/bridge.mjs -> UI fetches) ────────────────────

export interface SessionMeta {
  path: string;
  id: string;
  cwd: string | null;
  title: string | null;
  preview: string;
  mtimeMs: number;
  size: number;
  startedAt: string | null;
}

/** Known agent working directory, aggregated from session files. */
export interface ProjectInfo {
  cwd: string;
  sessions: number;
  lastUsedMs: number;
}

/**
 * The store's view model of GET /api/health — the endpoint itself returns
 * `{ ok, omp: { bin, resolved, cwd } }` and the store flattens it.
 */
export interface BridgeHealth {
  ok: boolean;
  ompResolved: string | null;
  ompCwd: string;
}

export interface BranchListResult {
  repo: boolean;
  current: string | null;
  branches: Array<{ name: string; current: boolean }>;
}
