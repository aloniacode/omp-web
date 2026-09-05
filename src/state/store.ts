import { create } from "zustand";
import { OmpRpcClient, type ConnStatus } from "../rpc/client";
import { apiFetch } from "../rpc/connection";
import { setComposerText } from "./composerText";
import { storeT } from "../i18n";
import { consumeUrlToken, getStoredToken, storeToken } from "../lib/auth";
import { buildExecutePrompt, stripPlanContract, wrapPlanPrompt } from "../lib/planMode";
import { stripGoalContract } from "../lib/goalMode";
import { assistantText, stderrTailSummary, userText } from "../lib/format";
import { notifyTurnEnd } from "../lib/notify";
import type { BridgeHealth } from "@omp-web/protocol";
import { isDuplicatePendingMessage } from "../lib/idempotency";
import {
  buildOversizeBubble,
  buildOversizePrompt,
  isOversizePrompt,
  stripOversizeContract,
  truncateToolOutput,
} from "../lib/oversize";
import type {
  AgentEndFrame,
  AvailableCommand,
  ImageContent,
  AgentMessage,
  AssistantMessage,
  ExtensionUiRequest,
  Goal,
  GoalUpdatedFrame,
  ModelInfo,
  NoticeFrame,
  ProjectInfo,
  RpcFrame,
  RpcResponseFrame,
  RpcSessionState,
  SessionEventFrame,
  SessionMeta,
  SessionStats,
  ToolExecutionFrame,
  ThinkingLevel,
  TodoPhase,
  ToolResultLike,
  RpcHandoffResult,
  Usage,
  UserMessage,
} from "../rpc/types";
import { normalizeTodoPhases } from "../lib/todos";

// ── View models ─────────────────────────────────────────────────────────────

/** A locally-appended user message awaiting reconciliation from the agent. */
export interface OptimisticUserMessage extends UserMessage {
  pending?: boolean;
  failed?: boolean;
  /** Exact stdin prompt sent for this bubble — reused verbatim by retry. */
  wire?: string;
}

export type ChatEntry = AgentMessage | OptimisticUserMessage;

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  outputText: string;
  startedAt: number;
}

export interface UiNotice {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
  source?: string;
}

export type { BridgeHealth } from "@omp-web/protocol";

/** Outcome of the token gate's submit: unlocked, rejected, or unpersistable. */
export type TokenSubmitResult = "ok" | "invalid" | "storage";

export interface AppState {
  connStatus: ConnStatus;
  agentReady: boolean;
  health: BridgeHealth | null;
  /** Bridge rejected the access token; the token gate blocks the UI until unlocked. */
  authRequired: boolean;
  sessions: SessionMeta[];
  sessionId: string | null;
  sessionName: string | null;
  activePath: string | null;
  /** Session the user asked to open whose `switch_session` response has not
   *  arrived yet (the agent can take seconds to load a long transcript).
   *  Drives the sidebar highlight and the transcript loading state. */
  pendingSessionPath: string | null;
  /** A prompt typed while a session switch was in flight; dispatched as soon
   *  as the switch lands, or handed back to the composer if it fails. */
  queuedPrompt: { text: string; images?: ImageContent[] } | null;
  messages: ChatEntry[];
  /** In-flight assistant turn rendered live from message_update partials. */
  streamingMsg: AssistantMessage | null;
  toolRuns: ToolRun[];
  agentState: RpcSessionState | null;
  stats: SessionStats | null;
  models: ModelInfo[];
  /** Known agent working directories, aggregated by the bridge. */
  projects: ProjectInfo[];
  /** Current agent working directory (bridge-side, switchable). */
  projectCwd: string | null;
  notices: UiNotice[];
  extStack: ExtensionUiRequest[];
  stopping: boolean;
  /** Prompt accepted; waiting for the agent's first event (working indicator). */
  awaitingAgent: boolean;
  modelsLoaded: boolean;
  /** Plan mode: prompts are wrapped in a plan-only contract; replies get a review bar. */
  planMode: boolean;
  /** Message index where plan mode was enabled; the review bar only considers later turns. */
  planModeFromIndex: number | null;
  /** Active session goal (goal mode), pushed by `goal_updated` events. */
  goal: Goal | null;
  /** Session todo list (todo tool), from get_state snapshots and todo-tool runs. */
  todos: TodoPhase[];
  /** Agent-pushed slash commands (`available_commands_update`), for the palette. */
  agentCommands: AvailableCommand[];
  /** Handoff generation in flight (native RPC `handoff` command). */
  handoffInFlight: boolean;
}

export interface StoreActions {
  sendPrompt(text: string, images?: ImageContent[]): void;
  /** Drop a failed (local-only) bubble and re-dispatch its content. */
  retryPrompt(entry: ChatEntry): void;
  stop(): void;
  newChat(): void;
  openSession(path: string): void;
  renameSession(name: string): void;
  deleteSession(path: string): Promise<void>;
  compact(customInstructions?: string): void;
  setPlanMode(enabled: boolean): void;
  /** Approve a reviewed plan: leave plan mode and send the implement prompt. */
  approvePlan(plan: string): void;
  /** Generate a handoff document and continue the session compacted from it. */
  handoff(customInstructions?: string): void;
  respondExtUi(request: ExtensionUiRequest, outcome: ExtOutcome): void;
  dismissNotice(id: number): void;
  /** Surface a toast to the user (e.g. rejected paste feedback). */
  notify(level: UiNotice["level"], message: string, source?: string): void;
  recheckHealth(): Promise<boolean>;
  /**
   * Store an access token and re-probe. "invalid" covers rejected tokens and
   * unreachable bridges; "storage" means the token was accepted but the
   * browser refused to keep it (strict private mode).
   */
  submitToken(token: string): Promise<TokenSubmitResult>;
  refreshSessions(): void;
  setModel(provider: string, modelId: string): void;
  setThinkingLevel(level: string): void;
  refreshProjects(): void;
  switchProject(cwd: string): void;
  setFastMode(enabled: boolean): void;
  setSteeringMode(mode: "all" | "one-at-a-time"): void;
  setFollowUpMode(mode: "all" | "one-at-a-time"): void;
  setInterruptMode(mode: "immediate" | "wait"): void;
  setAutoCompaction(enabled: boolean): void;
  setAutoRetry(enabled: boolean): void;
  exportHtml(): void;
}

export type ExtOutcome =
  | { kind: "value"; value: string }
  | { kind: "confirmed"; confirmed: boolean }
  | { kind: "cancelled" }
  | { kind: "dismissed" };

const initialState: AppState = {
  connStatus: "connecting",
  agentReady: false,
  health: null,
  authRequired: false,
  sessions: [],
  sessionId: null,
  sessionName: null,
  activePath: null,
  pendingSessionPath: null,
  queuedPrompt: null,
  messages: [],
  streamingMsg: null,
  toolRuns: [],
  agentState: null,
  stats: null,
  models: [],
  modelsLoaded: false,
  projects: [],
  projectCwd: null,
  notices: [],
  extStack: [],
  stopping: false,
  awaitingAgent: false,
  planMode: false,
  planModeFromIndex: null,
  goal: null,
  todos: [],
  agentCommands: [],
  handoffInFlight: false,
};

export function isOptimistic(entry: ChatEntry): entry is OptimisticUserMessage {
  return "pending" in entry || "failed" in entry;
}

const IS_WINDOWS = /^win/i.test(navigator.platform);

/** Loose directory equality: Windows paths differ trivially in separators and case. */
function sameDirectory(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[\\/]+/g, "/").replace(/\/+$/, "");
  return IS_WINDOWS ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
}

/** Shared streaming predicate: agent-reported state or a live streaming bubble. */
export function selectIsStreaming(state: AppState): boolean {
  return Boolean(state.agentState?.isStreaming) || state.streamingMsg !== null;
}

function textOfToolResult(result: ToolResultLike | undefined): string {
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return "";
  let text = "";
  for (const block of blocks) {
    if (block.type === "text") text += block.text;
  }
  return text;
}

/**
 * The agent transcript stores what went over the wire; plan-mode prompts were
 * wrapped with the planning contract and goal prompts with the goal contract.
 * Strip those back off so committed history and reloaded sessions show the
 * user's original wording.
 */
function unwrapUiContract(entry: AgentMessage): AgentMessage {
  if (entry.role === "user" && typeof entry.content === "string") {
    const stripped = stripOversizeContract(stripGoalContract(stripPlanContract(entry.content)));
    if (stripped !== entry.content) return { ...entry, content: stripped };
  }
  return entry;
}

let noticeSeq = 1;
let loadEpoch = 0;
/** One compaction at a time: a second click shares the in-flight request. */
let compactBusy = false;
/** One oversized-prompt offload at a time: covers accidental double submits. */
let oversizeBusy = false;

/**
 * Optimistic switch bookkeeping: when a click flips the transcript straight
 * from the session file, remember what was on screen before so a refused or
 * failed agent switch can put it back. The first optimistic flip in a burst
 * wins — later clicks target whatever is already displayed.
 */
let optimisticFrom: string | null = null;
let optimisticMessages: ChatEntry[] | null = null;

/**
 * Structural sharing between consecutive streaming frames. Frames re-send the
 * full accumulated message on every token; swapping in the previous frame's
 * (deep-equal) block objects keeps prop identities stable so unchanged
 * subtrees skip re-rendering entirely.
 */
function reconcileStream(prev: AssistantMessage | null, next: AssistantMessage): AssistantMessage {
  if (!prev || prev === next || !Array.isArray(prev.content) || !Array.isArray(next.content)) return next;
  if (next.content.length < prev.content.length) return next;
  let shared = false;
  const merged = next.content.map((block, index) => {
    const old = prev.content[index];
    if (old === block) return block;
    if (old && old.type === block.type) {
      try {
        if (JSON.stringify(old) === JSON.stringify(block)) {
          shared = true;
          return old;
        }
      } catch {
        // non-serializable block: fall through and keep the new object
      }
    }
    return block;
  });
  return shared ? { ...next, content: merged } : next;
}

/** Module-scope singleton: one bridge connection for the whole app. */
const client = new OmpRpcClient();

// ── Store ───────────────────────────────────────────────────────────────────

/**
 * Global app store (zustand). State and actions live together; actions are
 * created once and keep a stable identity, so `useAppStore((s) => s.actions)`
 * never re-renders. Components select the slices they need — unrelated state
 * changes no longer re-render them.
 */
export const useAppStore = create<AppState & { actions: StoreActions }>()((set, get) => {
  const addNotice = (level: UiNotice["level"], message: string, source?: string) => {
    set((state) => ({ notices: [...state.notices.slice(-49), { id: noticeSeq++, level, message, source }] }));
  };

  const fail = (err: unknown, what: string) =>
    addNotice("error", err instanceof Error ? err.message : `${what} failed`);

  const refreshSessions = () => {
    apiFetch("/api/sessions?limit=80")
      .then((res) => res.json())
      .then((body: { sessions?: SessionMeta[] }) => {
        if (Array.isArray(body.sessions)) set({ sessions: body.sessions });
      })
      .catch(() => undefined);
  };

  const refreshProjects = () => {
    apiFetch("/api/projects")
      .then((res) => res.json())
      .then((body: { projects?: ProjectInfo[]; current?: string }) => {
        if (Array.isArray(body.projects)) {
          set((state) => ({ projects: body.projects!, projectCwd: body.current ?? state.projectCwd }));
        }
      })
      .catch(() => undefined);
  };

  /** Move this connection (and its agent child) to a project directory. */
  const requestCwdSwitch = async (cwd: string) => {
    const res = await apiFetch("/api/cwd", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; cwd?: string; changed?: boolean; error?: string };
    if (!res.ok || !body.ok) throw new Error(body.error ?? `switch failed (${res.status})`);
    set({ projectCwd: body.cwd ?? cwd });
    return body;
  };

  /**
   * Wait for the agent child a cwd switch just recycled to come back: the
   * dispose closes the socket and the reconnect loop spawns the replacement.
   * Two phases, because `agentReady` stays stale-true during the drop — it is
   * only reset once the fresh socket reports "connected".
   * With the bridge's warm agent pool the socket never drops (the cwd swap
   * adopts an idle child) — nothing to wait for, resolves on first tick.
   */
  const waitAgentRestart = (timeoutMs = 20_000) =>
    new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let dropped = false;
      const tick = () => {
        const { connStatus, agentReady } = get();
        if (dropped) {
          if (connStatus === "connected" && agentReady) {
            resolve();
            return;
          }
        } else if (connStatus !== "connected" || !agentReady) {
          dropped = true;
        } else {
          // Warm swap: the agent stayed up across the cwd change.
          resolve();
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error("agent restart timed out"));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });

  /**
   * Shared health probe. A 401 flips `authRequired` (token gate) on. When a
   * tokenOverride is given it is sent as the explicit header — authoritative
   * over anything in storage — so token validation never depends on
   * localStorage being writable.
   */
  const probeHealth = async (
    tokenOverride?: string,
  ): Promise<{ probed: boolean; authRequired: boolean; ompResolved: boolean }> => {
    try {
      const init = tokenOverride !== undefined ? { headers: { "x-omp-web-token": tokenOverride } } : undefined;
      const res = await apiFetch("/api/health", init);
      if (res.status === 401) {
        set({ authRequired: true });
        return { probed: false, authRequired: true, ompResolved: false };
      }
      const body = (await res.json()) as {
        ok?: boolean;
        omp?: { resolved?: string | null; cwd?: string };
      };
      set({
        authRequired: false,
        health: {
          ok: Boolean(body.ok),
          ompResolved: body.omp?.resolved ?? null,
          ompCwd: body.omp?.cwd ?? "",
        },
      });
      return { probed: true, authRequired: false, ompResolved: Boolean(body.omp?.resolved) };
    } catch {
      return { probed: false, authRequired: false, ompResolved: false };
    }
  };

  const loadAllMessages = async (): Promise<ChatEntry[]> => {
    const acc: AgentMessage[] = [];
    let cursor: string | undefined;
    try {
      for (let page = 0; page < 64; page += 1) {
        const resp = await client.request<{ messages: AgentMessage[]; nextCursor?: string }>({
          type: "get_messages_page",
          cursor,
          limit: 256,
        });
        if (!resp.success || !resp.data) throw new Error(resp.error ?? "paged messages unavailable");
        acc.push(...(resp.data.messages ?? []).map(unwrapUiContract));
        if (!resp.data.nextCursor) return acc;
        cursor = resp.data.nextCursor;
      }
      return acc;
    } catch {
      // Legacy/v1 fallback or transient busy: best-effort monolithic snapshot.
      const resp = await client.request<{ messages: AgentMessage[] }>({ type: "get_messages" });
      if (resp.success && Array.isArray(resp.data?.messages)) return resp.data.messages.map(unwrapUiContract);
      return acc;
    }
  };

  const initSession = async (options?: { skipTranscript?: boolean }) => {
    const epoch = ++loadEpoch;
    try {
      const stateResp = await client.request<RpcSessionState>({ type: "get_state" });
      if (stateResp.success && stateResp.data) applyAgentState(stateResp.data);
      // The optimistic switch path has already rendered this transcript from
      // the session file — only the agent-side state sync is left to do.
      if (options?.skipTranscript) {
        void client.request({ type: "get_session_stats" });
        void client.request({ type: "get_available_models" });
        return;
      }
      const entries = await loadAllMessages();
      if (loadEpoch !== epoch) return;
      set((state) => ({
        messages: entries,
        // A shrinking reload (compaction/handoff committed by the previous
        // child) can leave the plan-mode anchor beyond the transcript — clamp
        // so the review bar isn't permanently suppressed.
        ...(state.planModeFromIndex != null
          ? { planModeFromIndex: Math.min(state.planModeFromIndex, entries.length) }
          : null),
      }));
      void client.request({ type: "get_session_stats" });
      void client.request({ type: "get_available_models" });
    } catch (err) {
      addNotice("error", err instanceof Error ? err.message : "failed to initialize session");
    }
  };

  /** Fire a prompt queued while a session switch was in flight. */
  const flushQueuedPrompt = () => {
    const queued = get().queuedPrompt;
    if (!queued) return;
    set({ queuedPrompt: null });
    get().actions.sendPrompt(queued.text, queued.images);
  };

  /** Put back the transcript an optimistic switch displaced (agent refused
   *  the switch or it failed) — no refetch needed, the old messages were
   *  stashed when the display flipped. Any prompt queued during the switch
   *  returns to the composer instead of auto-firing into the restored
   *  session, since it was written with the other one on screen. */
  const revertOptimisticSwitch = () => {
    const queued = get().queuedPrompt;
    if (queued) {
      set({ queuedPrompt: null });
      setComposerText(queued.text);
      addNotice("info", storeT("notice.queuedPromptBack"));
    }
    if (optimisticFrom === null) return;
    set({ activePath: optimisticFrom, messages: optimisticMessages ?? [] });
    optimisticFrom = null;
    optimisticMessages = null;
  };

  const applyAgentState = (data: RpcSessionState) => {
    set((state) => ({
      agentState: data,
      sessionId: data.sessionId ?? state.sessionId,
      sessionName: data.sessionName ?? state.sessionName,
      // While a switch is in flight the agent lags the UI (it may still be
      // on the previous session, or booting into the target) — hold the
      // displayed identity until the switch's own get_state lands.
      activePath: state.pendingSessionPath ?? (data.sessionFile ?? state.activePath),
      stopping: data.isStreaming ? state.stopping : false,
      ...(data.todoPhases !== undefined ? { todos: normalizeTodoPhases(data.todoPhases) } : null),
    }));
  };

  // ── Frame routing ────────────────────────────────────────────────────────

  const handleFrame = (frame: RpcFrame) => {
    switch (frame.type) {
      case "ready":
        set({ agentReady: true });
        refreshSessions();
        refreshProjects();
        // A switch is in flight: its own completion path re-initializes the
        // session. Running a full initSession here would race it and clobber
        // the optimistically displayed transcript with the agent's lagging
        // view (it may still be booting into the target session).
        if (get().pendingSessionPath !== null) break;
        void initSession();
        break;

      case "agent_end": {
        const end = frame as AgentEndFrame;
        if (end.isTerminal === false) break; // maintenance pause, more work scheduled
        const committed = Array.isArray(end.messages) ? end.messages.map(unwrapUiContract) : null;
        set(() => ({
          ...(committed ? { messages: committed } : null),
          streamingMsg: null,
          toolRuns: [],
          stopping: false,
          awaitingAgent: false,
        }));
        // Turn finished: browser notification when the page is in background
        // (lib/notify no-ops otherwise), with the final assistant text.
        const finalMessages = committed ?? get().messages;
        let lastReply: AssistantMessage | null = null;
        for (let i = finalMessages.length - 1; i >= 0; i -= 1) {
          const entry = finalMessages[i];
          if (entry.role === "assistant") {
            lastReply = entry;
            break;
          }
        }
        const replyText = lastReply ? assistantText(lastReply.content) : "";
        notifyTurnEnd(get().sessionName ?? storeT("topbar.untitled"), replyText || storeT("notice.turnDone"));
        void client.request({ type: "get_session_stats" });
        void client.request({ type: "get_state" });
        refreshSessions();
        refreshProjects();
        break;
      }

      case "message_start":
      case "message_update":
      case "message_end": {
        const stream = frame as SessionEventFrame & { message?: AssistantMessage };
        if (stream.message && stream.message.role === "assistant") {
          // Reuse unchanged block objects between frames: every update frame
          // carries the whole message, and without structural sharing each
          // token would re-render (and re-parse markdown for) every earlier
          // block of the streaming turn.
          set({ streamingMsg: reconcileStream(get().streamingMsg, stream.message), awaitingAgent: false });
        }
        break;
      }

      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        const tool = frame as ToolExecutionFrame;
        const payload = tool.result ?? tool.partialResult;
        // Live tool runs hold their output in memory for the whole turn; cap
        // pathological outputs (the agent transcript keeps the full text).
        const text = truncateToolOutput(textOfToolResult(payload));
        const done = frame.type === "tool_execution_end";
        // Completed todo-tool runs carry the fresh todo snapshot in details
        // (an empty phases array is a legit "dropped all" state).
        if (done && tool.toolName === "todo" && !tool.isError && payload && typeof payload === "object") {
          const details = (payload as ToolResultLike & { details?: { phases?: unknown } }).details;
          if (details && Array.isArray(details.phases)) set({ todos: normalizeTodoPhases(details.phases) });
        }
        const run: ToolRun = {
          toolCallId: tool.toolCallId,
          toolName: tool.toolName,
          args: tool.args,
          status: done ? (tool.isError ? "error" : "done") : "running",
          outputText: text,
          startedAt: Date.now(),
        };
        set((state) => ({
          toolRuns: state.toolRuns.some((r) => r.toolCallId === run.toolCallId)
            ? state.toolRuns.map((r) => (r.toolCallId === run.toolCallId ? run : r))
            : [...state.toolRuns, run],
        }));
        break;
      }

      case "model_changed":
        void client.request({ type: "get_state" });
        void client.request({ type: "get_available_models" });
        break;

      case "thinking_level_changed":
        void client.request({ type: "get_state" });
        break;

      case "goal_updated": {
        // Note: upstream does not replay goal state when a host attaches to an
        // existing session, so `goal` only reflects goals observed live.
        const update = frame as GoalUpdatedFrame;
        set({ goal: update.goal ?? null });
        break;
      }

      case "available_commands_update": {
        // Pushed at child startup and whenever command metadata changes
        // (switch_session included); a fresh child per connection re-emits it.
        const commands = (frame as { commands?: unknown }).commands;
        if (Array.isArray(commands)) {
          set({
            agentCommands: commands.filter(
              (command): command is AvailableCommand =>
                typeof command === "object" && command !== null && typeof (command as AvailableCommand).name === "string",
            ),
          });
        }
        break;
      }

      case "todo_auto_clear":
        set({ todos: [] });
        break;

      case "notice": {
        const notice = frame as NoticeFrame;
        addNotice(notice.level, notice.message, notice.source);
        break;
      }

      case "prompt_result":
        // Local-only prompts resolve here without an agent turn.
        patchPending(false);
        void client.request({ type: "get_state" });
        break;

      case "command_output": {
        const output = frame as { output?: string; text?: string; content?: unknown };
        const body =
          typeof output.output === "string"
            ? output.output
            : typeof output.text === "string"
              ? output.text
              : typeof output.content === "string"
                ? output.content
                : "";
        if (body.trim()) addNotice("info", body.trim(), "command");
        patchPending(false);
        break;
      }

      case "extension_ui_request": {
        const request = frame as ExtensionUiRequest;
        switch (request.method) {
          case "notify":
            addNotice(request.notifyType ?? "info", request.message ?? "", "extension");
            break;
          case "set_editor_text":
            setComposerText(request.text ?? "");
            break;
          case "setTitle":
            if (request.title) set({ sessionName: request.title });
            break;
          case "cancel":
            if (request.targetId) {
              set((state) => ({ extStack: state.extStack.filter((r) => r.id !== request.targetId) }));
            }
            break;
          case "setStatus":
          case "setWidget":
            break; // no terminal-style surfaces in this UI
          default:
            set((state) => ({ extStack: [...state.extStack, request] }));
        }
        break;
      }

      case "bridge_event": {
        const event = frame as {
          event?: string;
          error?: string;
          hint?: string;
          code?: number | null;
          stderrTail?: unknown;
        };
        if (event.event === "agent_exit") {
          // Surface the child's last stderr chunks: a crash's actual cause is
          // only ever visible there.
          addNotice(
            "warning",
            `Agent process exited (${event.code ?? "?"}). Reconnecting…${stderrTailSummary(event.stderrTail)}`,
          );
        } else if (event.event === "spawn_error") {
          addNotice("error", `${event.error ?? "spawn failed"}${event.hint ? ` — ${event.hint}` : ""}`);
        } else if (event.event === "frame_error" || event.event === "bad_frame") {
          addNotice("warning", event.error ?? "protocol frame error");
        }
        break;
      }

      default:
        break; // tolerated: subagent frames, todo reminders, session_info_update, …
    }
  };

  const patchPending = (failed: boolean) => {
    set((state) => ({
      messages: state.messages.map((entry) =>
        isOptimistic(entry) && entry.pending
          ? { ...entry, pending: false, failed: failed || entry.failed }
          : entry,
      ),
    }));
  };

  const routeResponse = (resp: RpcResponseFrame) => {
    if (resp.id !== undefined && String(resp.id).startsWith("protocol-")) return;
    switch (resp.command) {
      case "get_state":
        if (resp.success && resp.data) applyAgentState(resp.data as RpcSessionState);
        break;
      case "get_session_stats":
        if (resp.success && resp.data) set({ stats: resp.data as SessionStats });
        break;
      case "get_available_models": {
        if (!resp.success || !resp.data) break;
        const models = (resp.data as { models?: ModelInfo[] }).models ?? [];
        models.sort(
          (a, b) =>
            a.provider.localeCompare(b.provider) ||
            String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)),
        );
        set({ models, modelsLoaded: true });
        break;
      }
      case "new_session":
      case "switch_session": {
        // An optimistic transcript load may have already flipped the display
        // to the target session (read straight from the session file while
        // the agent was still switching). Keep it on success; on a refusal
        // (session_before_switch hook, cwd guard) or error, put the previous
        // transcript back — the agent never left it.
        const optimisticShown = optimisticFrom !== null && get().activePath !== optimisticFrom;
        if (resp.success) {
          set({
            streamingMsg: null,
            toolRuns: [],
            stats: null,
            stopping: false,
            awaitingAgent: false,
            planMode: false,
            planModeFromIndex: null,
            goal: null,
            todos: [],
            handoffInFlight: false,
            // Identity resets too: the fresh session's get_state fills these
            // back in, and an unnamed session must not inherit the previous
            // session's title in the top bar.
            sessionId: null,
            sessionName: null,
            ...(optimisticShown ? {} : { messages: [] }),
          });
          optimisticFrom = null;
          optimisticMessages = null;
          // The agent is on the new session — fire anything the user typed
          // while the switch was in flight.
          void initSession(optimisticShown ? { skipTranscript: true } : undefined).then(flushQueuedPrompt);
        } else {
          revertOptimisticSwitch();
        }
        set({ pendingSessionPath: null });
        if ((resp.data as { cancelled?: boolean } | undefined)?.cancelled === true) {
          addNotice(
            "warning",
            storeT(resp.command === "new_session" ? "notice.newSessionCancelled" : "notice.switchCancelled"),
          );
        }
        break;
      }
      case "set_model":
        if (resp.success) {
          void client.request({ type: "get_state" });
          void client.request({ type: "get_session_stats" });
        }
        break;
      case "set_fast_mode":
      case "set_thinking_level":
      case "set_steering_mode":
      case "set_follow_up_mode":
      case "set_interrupt_mode":
      case "set_auto_compaction":
      case "set_auto_retry":
        if (resp.success) void client.request({ type: "get_state" });
        break;
      case "set_session_name":
        if (resp.success) refreshSessions();
        break;
    }
  };

  // ── Actions ───────────────────────────────────────────────────────────────

  /**
   * Optimistic bubble + wire prompt dispatch. `bubble` is what the transcript
   * shows; `wire` is what goes to the agent (identical except for oversized
   * prompts, which reference a scratch file). Resolves when the prompt RPC
   * settles (accepted or rejected — turn lifecycle takes over after that).
   */
  const dispatchPrompt = (bubble: string, wire: string, images?: ImageContent[]) => {
    const streaming = get().agentState?.isStreaming || get().streamingMsg !== null;
    const hasImages = Boolean(images && images.length > 0);
    set((current) => ({
      messages: [
        ...current.messages,
        {
          role: "user",
          content: hasImages ? [{ type: "text", text: bubble }, ...(images ?? [])] : bubble,
          timestamp: Date.now(),
          pending: true,
          // Remembered verbatim so a retry re-dispatches byte-identical
          // content (plan/goal/oversize wrapping and all) instead of
          // re-deriving it from the displayed bubble.
          wire,
        },
      ],
      awaitingAgent: true,
    }));
    const command = streaming
      ? ({ type: "prompt", message: wire, images, streamingBehavior: "followUp" } as const)
      : ({ type: "prompt", message: wire, images } as const);
    return client
      .request<{ agentInvoked?: boolean }>(command)
      .then((resp) => {
        if (!resp.success) throw new Error(resp.error ?? "prompt rejected");
        if (resp.data?.agentInvoked === true) return; // turn lifecycle takes over
        patchPending(false);
        set({ awaitingAgent: false });
        void client.request({ type: "get_state" });
      })
      .catch((err: unknown) => {
        // Rejected prompt: release the optimistic agent row, mark the bubble.
        patchPending(true);
        set({ awaitingAgent: false });
        fail(err, "prompt");
      });
  };

  const actions: StoreActions = {
    retryPrompt(entry: ChatEntry) {
      // The failed bubble is local-only (the agent never committed it): drop
      // it and re-dispatch its original wire content verbatim — no re-running
      // of the plan/oversize wrapping, which may have changed since.
      if (entry.role !== "user" || !("failed" in entry) || !entry.failed) return;
      set((state) => ({ messages: state.messages.filter((message) => message !== entry) }));
      const images = Array.isArray(entry.content)
        ? entry.content.filter((block): block is ImageContent => block.type === "image")
        : [];
      const wire = "wire" in entry && typeof entry.wire === "string" ? entry.wire : userText(entry.content);
      dispatchPrompt(userText(entry.content), wire, images.length > 0 ? images : undefined);
    },

    sendPrompt(text: string, images?: ImageContent[]) {
      const trimmed = text.trim();
      if (!trimmed && (!images || images.length === 0)) return;
      const state = get();
      // A session switch is still in flight: the agent may not be on the
      // displayed session yet, so a prompt now would land in the wrong one.
      if (state.pendingSessionPath !== null) {
        // Queue instead of bouncing: the prompt dispatches automatically the
        // moment the switch lands (or returns to the composer if it fails).
        set({ queuedPrompt: { text: trimmed, images } });
        addNotice("info", storeT("notice.promptQueued"));
        return;
      }
      // Fast double-Enter / double-click: an identical prompt still pending
      // is a duplicate, not a queued follow-up.
      if (isDuplicatePendingMessage(state.messages, trimmed, images?.length ?? 0)) {
        addNotice("info", storeT("notice.duplicatePrompt"));
        return;
      }
      // Plan mode wraps what goes on the wire; the visible bubble keeps the
      // user's original wording.
      const wrapWire = (wire: string) => (state.planMode ? wrapPlanPrompt(wire) : wire);
      // Oversized prompts are offloaded to a scratch file and sent as a file
      // reference + preview; on transport failure fall back to inline. The
      // busy window lasts until the prompt RPC settles — the duplicate guard
      // above cannot match the compact bubble, so this closes the gap.
      if (isOversizePrompt(trimmed)) {
        if (oversizeBusy) {
          addNotice("info", storeT("notice.duplicatePrompt"));
          return;
        }
        oversizeBusy = true;
        const release = (promise: Promise<void>) => {
          void promise.then(
            () => {
              oversizeBusy = false;
            },
            () => {
              oversizeBusy = false;
            },
          );
        };
        apiFetch("/api/scratch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: trimmed }),
          signal: AbortSignal.timeout(10_000),
        })
          .then(async (res) => {
            const body = (await res.json()) as { path?: string; file?: string; error?: string };
            if (!res.ok || !body.path || !body.file) throw new Error(body.error ?? "scratch write failed");
            release(dispatchPrompt(buildOversizeBubble(trimmed, body.file), wrapWire(buildOversizePrompt(trimmed, body.path)), images));
          })
          .catch(() => {
            addNotice("warning", storeT("notice.oversizeFallback"));
            release(dispatchPrompt(trimmed, wrapWire(trimmed), images));
          });
        return;
      }
      dispatchPrompt(trimmed, wrapWire(trimmed), images);
    },

    stop() {
      set({ stopping: true });
      client.request({ type: "abort" }).catch((err: unknown) => {
        set({ stopping: false });
        fail(err, "abort");
      });
    },

    newChat() {
      client.request({ type: "new_session" }).catch((err: unknown) => fail(err, "new chat"));
    },

    openSession(path: string) {
      // Already there — nothing to switch, no RPC (omp hangs on same-session
      // switches anyway).
      if (path === get().activePath && get().pendingSessionPath === null) return;
      // The agent only switches into sessions recorded under its own working
      // directory — anything else it cancels silently (success:true, no
      // switch). Sessions from another project need the connection moved to
      // that project first, and the replacement agent up, before switching.
      const targetCwd = get().sessions.find((session) => session.path === path)?.cwd ?? null;
      const currentCwd = get().projectCwd;
      // Flag the target up front: the agent can take seconds to load a long
      // transcript, and without the flag the UI keeps showing the old session
      // with zero feedback until the switch_session response lands.
      set({ pendingSessionPath: path });
      // Optimistic transcript: read the .jsonl straight from the bridge (the
      // same records the agent's get_messages serves — the TUI's resume works
      // the same way) and render the conversation immediately. The agent
      // switch still runs below; prompting needs it, displaying doesn't.
      if (path !== get().activePath) {
        void apiFetch(`/api/sessions/transcript?path=${encodeURIComponent(path)}`)
          .then(async (resp) => {
            if (!resp.ok) throw new Error(`transcript ${resp.status}`);
            const body = (await resp.json()) as { messages?: AgentMessage[] };
            // A newer click superseded this load.
            if (get().pendingSessionPath !== path) return;
            const previous = get();
            if (optimisticFrom === null) {
              optimisticFrom = previous.activePath;
              optimisticMessages = previous.messages;
            }
            // Invalidate any in-flight initSession from a previous switch —
            // its late transcript must not overwrite this session's.
            loadEpoch += 1;
            set({
              activePath: path,
              messages: (body.messages ?? []).map(unwrapUiContract) as ChatEntry[],
              streamingMsg: null,
              toolRuns: [],
              stats: null,
              stopping: false,
              awaitingAgent: false,
              planMode: false,
              planModeFromIndex: null,
              goal: null,
              todos: [],
              handoffInFlight: false,
              sessionId: null,
              // Known title from the sessions list — get_state refines it
              // once the agent has switched.
              sessionName: previous.sessions.find((s) => s.path === path)?.title ?? null,
            });
          })
          .catch(() => {
            // Bridge read unavailable — the agent-driven path below still
            // swaps the transcript when its switch_session lands.
          });
      }
      if (!targetCwd || !currentCwd || sameDirectory(targetCwd, currentCwd)) {
        // omp never answers a switch into the session it already has — race
        // the RPC against a fallback that releases the UI (the transcript on
        // screen is the file-fresh optimistic read; the agent's buffered
        // copy processes whatever comes next whenever it unblocks).
        client
          .request({ type: "switch_session", sessionPath: path })
          .catch((err: unknown) => {
            revertOptimisticSwitch();
            set({ pendingSessionPath: null });
            fail(err, "open session");
          });
        setTimeout(() => {
          if (get().pendingSessionPath === path) {
            set({ pendingSessionPath: null });
            flushQueuedPrompt();
          }
        }, 15_000);
        return;
      }
      void requestCwdSwitch(targetCwd)
        .then(async (body) => {
          if (body.changed) {
            addNotice("info", storeT("notice.projectSwitched", { cwd: body.cwd ?? targetCwd }));
            await waitAgentRestart();
          }
          await client.request({ type: "switch_session", sessionPath: path });
          refreshProjects();
          refreshSessions();
        })
        .catch((err: unknown) => {
          revertOptimisticSwitch();
          set({ pendingSessionPath: null });
          fail(err, "open session");
        });
    },

    renameSession(name: string) {
      set({ sessionName: name });
      client.request({ type: "set_session_name", name }).catch((err: unknown) => fail(err, "rename"));
    },

    async deleteSession(path: string) {
      try {
        const res = await apiFetch(`/api/sessions?path=${encodeURIComponent(path)}`, { method: "DELETE" });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `delete failed (${res.status})`);
        }
        refreshSessions();
      } catch (err) {
        fail(err, "delete session");
      }
    },

    compact(customInstructions?: string) {
      if (compactBusy) return;
      compactBusy = true;
      client.request({ type: "compact", customInstructions }).then((resp) => {
        if (!resp.success) throw new Error(resp.error ?? "compact failed");
        addNotice("info", storeT("notice.compacted"));
        void client.request({ type: "get_state" });
        void client.request({ type: "get_session_stats" });
      }).catch((err: unknown) => fail(err, "compact")).finally(() => {
        compactBusy = false;
      });
    },

    setPlanMode(enabled: boolean) {
      if (enabled) {
        set({ planMode: true, planModeFromIndex: get().messages.length });
        return;
      }
      set({ planMode: false, planModeFromIndex: null });
    },

    approvePlan(plan: string) {
      set({ planMode: false, planModeFromIndex: null });
      actions.sendPrompt(buildExecutePrompt(plan));
    },

    handoff(customInstructions?: string) {
      const streaming = get().agentState?.isStreaming || get().streamingMsg !== null;
      if (streaming) {
        // Mirrors the TUI/RPC guard: handoff refuses mid-response.
        addNotice("warning", storeT("notice.handoffStreaming"));
        return;
      }
      if (get().handoffInFlight) {
        addNotice("info", storeT("notice.handoffRunning"), "handoff");
        return;
      }
      set({ handoffInFlight: true });
      client
        .request<RpcHandoffResult | null>({ type: "handoff", customInstructions })
        .then(async (resp) => {
          if (!resp.success) throw new Error(resp.error ?? "handoff failed");
          // The handoff document is committed as a compaction entry, so the
          // transcript changes shape: reload it and refresh usage stats before
          // reporting success.
          const epoch = ++loadEpoch;
          const entries = await loadAllMessages();
          if (loadEpoch !== epoch) return;
          set({ messages: entries });
          void client.request({ type: "get_state" });
          void client.request({ type: "get_session_stats" });
          const savedPath = resp.data?.savedPath;
          addNotice("info", savedPath ? storeT("notice.handoffSavedTo", { path: savedPath }) : storeT("notice.handoffDone"), "handoff");
        })
        .catch((err: unknown) => fail(err, "handoff"))
        .finally(() => set({ handoffInFlight: false }));
    },

    setModel(provider: string, modelId: string) {
      client.request({ type: "set_model", provider, modelId }).catch((err: unknown) => fail(err, "model switch"));
    },

    setThinkingLevel(level: string) {
      client
        .request({ type: "set_thinking_level", level: level as ThinkingLevel })
        .catch((err: unknown) => fail(err, "thinking level"));
    },

    refreshProjects,

    switchProject(cwd: string) {
      requestCwdSwitch(cwd)
        .then((body) => {
          if (body.changed) {
            // Bridge disposed the agent child; the socket drops and the
            // retry loop respawns it in the new directory.
            addNotice("info", storeT("notice.projectSwitched", { cwd: body.cwd ?? cwd }));
          }
          refreshProjects();
          refreshSessions();
        })
        .catch((err: unknown) => fail(err, "switch project"));
    },

    respondExtUi(request: ExtensionUiRequest, outcome: ExtOutcome) {
      set((state) => ({ extStack: state.extStack.filter((r) => r.id !== request.id) }));
      if (outcome.kind === "dismissed") return;
      if (outcome.kind === "cancelled") {
        client.send({ type: "extension_ui_response", id: request.id, cancelled: true });
        return;
      }
      if (outcome.kind === "confirmed") {
        client.send({ type: "extension_ui_response", id: request.id, confirmed: outcome.confirmed });
        return;
      }
      client.send({ type: "extension_ui_response", id: request.id, value: outcome.value });
    },

    setFastMode(enabled: boolean) {
      client.request({ type: "set_fast_mode", enabled }).catch((err: unknown) => fail(err, "fast mode"));
    },

    setSteeringMode(mode: "all" | "one-at-a-time") {
      client.request({ type: "set_steering_mode", mode }).catch((err: unknown) => fail(err, "steering mode"));
    },

    setFollowUpMode(mode: "all" | "one-at-a-time") {
      client.request({ type: "set_follow_up_mode", mode }).catch((err: unknown) => fail(err, "follow-up mode"));
    },

    setInterruptMode(mode: "immediate" | "wait") {
      client.request({ type: "set_interrupt_mode", mode }).catch((err: unknown) => fail(err, "interrupt mode"));
    },

    setAutoCompaction(enabled: boolean) {
      client.request({ type: "set_auto_compaction", enabled }).catch((err: unknown) => fail(err, "auto compaction"));
    },

    setAutoRetry(enabled: boolean) {
      client.request({ type: "set_auto_retry", enabled }).catch((err: unknown) => fail(err, "auto retry"));
    },

    exportHtml() {
      client
        .request<{ path?: string }>({ type: "export_html" })
        .then((resp) => {
          if (!resp.success) throw new Error(resp.error ?? "export failed");
          addNotice("info", resp.data?.path ? storeT("notice.exportedTo", { path: resp.data.path }) : storeT("notice.exported"), "export");
        })
        .catch((err: unknown) => fail(err, "export"));
    },

    dismissNotice(id: number) {
      set((state) => ({ notices: state.notices.filter((n) => n.id !== id) }));
    },

    notify(level: UiNotice["level"], message: string, source?: string) {
      addNotice(level, message, source);
    },

    refreshSessions,

    async recheckHealth() {
      const hadOmp = Boolean(get().health?.ompResolved);
      const result = await probeHealth();
      // First time the binary shows up: recycle the socket so the bridge
      // spawns a fresh agent child immediately.
      if (result.ompResolved && !hadOmp) client.reconnect();
      return result.ompResolved;
    },

    async submitToken(rawToken: string): Promise<TokenSubmitResult> {
      // Tolerate pasting the whole ready-made URL the bridge prints.
      const trimmed = rawToken.trim();
      let token = trimmed;
      if (trimmed.includes("token=")) {
        try {
          token = new URL(trimmed).searchParams.get("token") ?? trimmed;
        } catch {
          // not a URL — treat the input as a raw token
        }
      }
      if (!token) return "invalid";
      const result = await probeHealth(token);
      if (result.authRequired || !result.probed) return "invalid";
      storeToken(token);
      // Storage refused (strict private mode): the token works but cannot be
      // kept, so every later call would 401 again — keep the gate open with
      // an honest explanation instead of silently looping.
      if (getStoredToken() !== token) return "storage";
      // Fresh socket (it picks the new token up on connect) plus the REST
      // surfaces that were rejected alongside the failed health probe.
      client.reconnect();
      refreshSessions();
      refreshProjects();
      return "ok";
    },
  };

  // ── Bridge wiring (module singleton) ──────────────────────────────────────

  /** Module-scope singleton: survives StrictMode remounts so exactly one bridge connection exists. */
  client.onFrame((frame) => {
    if (frame.type === "response") {
      routeResponse(frame as RpcResponseFrame);
      return;
    }
    handleFrame(frame);
  });
  client.onStatus((status) => {
    if (status !== "connected") {
      set({ connStatus: status });
      return;
    }
    // Every reconnect is a fresh agent child. Committed history, plan mode,
    // goal, todos, models and the bridge-side surfaces (health, projects,
    // auth) survive — the fresh child's `ready` re-verifies them via a full
    // transcript reload. Only live-turn state died with the old child, along
    // with dialogs that could never be answered by anything else.
    set((state) => ({
      ...state,
      connStatus: status,
      agentReady: false,
      agentState: null,
      streamingMsg: null,
      toolRuns: [],
      stopping: false,
      awaitingAgent: false,
      handoffInFlight: false,
      extStack: [],
    }));
  });
  // Consume `?token=<access token>` before anything talks to the bridge —
  // including the socket below, which reads the token at connect time.
  consumeUrlToken();
  client.start();
  void probeHealth();
  refreshSessions();
  refreshProjects();

  return { ...initialState, actions };
});

/** Stable action handle — subscribing components never re-render for state changes. */
export function useActions(): StoreActions {
  return useAppStore((s) => s.actions);
}

/** Convenience selector for usage chips. */
export function usageTotals(usage: Usage | undefined) {
  if (!usage) return null;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    total: usage.totalTokens,
    cost: usage.cost.total,
    reasoningTokens: usage.reasoningTokens,
  };
}

// TEMP-DEBUG: remove after todo-panel animation review.
if (import.meta.env.DEV) {
  (window as unknown as { __ompStore: unknown }).__ompStore = useAppStore;
}
