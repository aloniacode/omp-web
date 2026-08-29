import { create } from "zustand";
import { OmpRpcClient, type ConnStatus } from "../rpc/client";
import { setComposerText } from "./composerText";
import { storeT } from "../i18n";
import { buildExecutePrompt, stripPlanContract, wrapPlanPrompt } from "../lib/planMode";
import { stripGoalContract } from "../lib/goalMode";
import { assistantText } from "../lib/format";
import { notifyTurnEnd } from "../lib/notify";
import type { BridgeHealth } from "@omp-web/protocol";
import { isDuplicatePendingMessage } from "../lib/idempotency";
import type {
  AgentEndFrame,
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
  ToolResultLike,
  RpcHandoffResult,
  Usage,
  UserMessage,
} from "../rpc/types";

// ── View models ─────────────────────────────────────────────────────────────

/** A locally-appended user message awaiting reconciliation from the agent. */
export interface OptimisticUserMessage extends UserMessage {
  pending?: boolean;
  failed?: boolean;
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

export interface AppState {
  connStatus: ConnStatus;
  agentReady: boolean;
  health: BridgeHealth | null;
  sessions: SessionMeta[];
  sessionId: string | null;
  sessionName: string | null;
  activePath: string | null;
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
  /** Handoff generation in flight (native RPC `handoff` command). */
  handoffInFlight: boolean;
}

export interface StoreActions {
  sendPrompt(text: string, images?: ImageContent[]): void;
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
  sessions: [],
  sessionId: null,
  sessionName: null,
  activePath: null,
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
  handoffInFlight: false,
};

export function isOptimistic(entry: ChatEntry): entry is OptimisticUserMessage {
  return "pending" in entry || "failed" in entry;
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
    const stripped = stripGoalContract(stripPlanContract(entry.content));
    if (stripped !== entry.content) return { ...entry, content: stripped };
  }
  return entry;
}

let noticeSeq = 1;
let loadEpoch = 0;
/** One compaction at a time: a second click shares the in-flight request. */
let compactBusy = false;

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
    fetch("/api/sessions?limit=80")
      .then((res) => res.json())
      .then((body: { sessions?: SessionMeta[] }) => {
        if (Array.isArray(body.sessions)) set({ sessions: body.sessions });
      })
      .catch(() => undefined);
  };

  const refreshProjects = () => {
    fetch("/api/projects")
      .then((res) => res.json())
      .then((body: { projects?: ProjectInfo[]; current?: string }) => {
        if (Array.isArray(body.projects)) {
          set((state) => ({ projects: body.projects!, projectCwd: body.current ?? state.projectCwd }));
        }
      })
      .catch(() => undefined);
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

  const initSession = async () => {
    const epoch = ++loadEpoch;
    try {
      const stateResp = await client.request<RpcSessionState>({ type: "get_state" });
      if (stateResp.success && stateResp.data) applyAgentState(stateResp.data);
      const entries = await loadAllMessages();
      if (loadEpoch !== epoch) return;
      set({ messages: entries });
      void client.request({ type: "get_session_stats" });
      void client.request({ type: "get_available_models" });
    } catch (err) {
      addNotice("error", err instanceof Error ? err.message : "failed to initialize session");
    }
  };

  const applyAgentState = (data: RpcSessionState) => {
    set((state) => ({
      agentState: data,
      sessionId: data.sessionId ?? state.sessionId,
      sessionName: data.sessionName ?? state.sessionName,
      activePath: data.sessionFile ?? state.activePath,
      stopping: data.isStreaming ? state.stopping : false,
    }));
  };

  // ── Frame routing ────────────────────────────────────────────────────────

  const handleFrame = (frame: RpcFrame) => {
    switch (frame.type) {
      case "ready":
        set({ agentReady: true });
        void initSession();
        refreshSessions();
        refreshProjects();
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
        const text = textOfToolResult(payload);
        const done = frame.type === "tool_execution_end";
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
        const event = frame as { event?: string; error?: string; hint?: string; code?: number | null };
        if (event.event === "agent_exit") {
          addNotice("warning", `Agent process exited (${event.code ?? "?"}). Reconnecting…`);
        } else if (event.event === "spawn_error") {
          addNotice("error", `${event.error ?? "spawn failed"}${event.hint ? ` — ${event.hint}` : ""}`);
        } else if (event.event === "frame_error" || event.event === "bad_frame") {
          addNotice("warning", event.error ?? "protocol frame error");
        }
        break;
      }

      default:
        break; // tolerated: available_commands_update, subagent frames, todo reminders, …
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
      case "switch_session":
        if (resp.success) {
          set({
            messages: [],
            streamingMsg: null,
            toolRuns: [],
            stats: null,
            stopping: false,
            awaitingAgent: false,
            planMode: false,
            planModeFromIndex: null,
            goal: null,
            handoffInFlight: false,
          });
          void initSession();
        }
        break;
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

  const actions: StoreActions = {
    sendPrompt(text: string, images?: ImageContent[]) {
      const trimmed = text.trim();
      if (!trimmed && (!images || images.length === 0)) return;
      const state = get();
      // Fast double-Enter / double-click: an identical prompt still pending
      // is a duplicate, not a queued follow-up.
      if (isDuplicatePendingMessage(state.messages, trimmed, images?.length ?? 0)) {
        addNotice("info", storeT("notice.duplicatePrompt"));
        return;
      }
      const streaming = state.agentState?.isStreaming || state.streamingMsg !== null;
      const hasImages = Boolean(images && images.length > 0);
      set((current) => ({
        messages: [
          ...current.messages,
          {
            role: "user",
            content: hasImages && trimmed ? [{ type: "text", text: trimmed }, ...(images ?? [])] : trimmed,
            timestamp: Date.now(),
            pending: true,
          },
        ],
        awaitingAgent: true,
      }));
      // Plan mode wraps what goes on the wire; the visible bubble keeps the
      // user's original wording.
      const wire = state.planMode ? wrapPlanPrompt(trimmed) : trimmed;
      const command = streaming
        ? ({ type: "prompt", message: wire, images, streamingBehavior: "followUp" } as const)
        : ({ type: "prompt", message: wire, images } as const);
      client
        .request<{ agentInvoked?: boolean }>(command)
        .then((resp) => {
          if (!resp.success) throw new Error(resp.error ?? "prompt rejected");
          if (resp.data?.agentInvoked === true) return; // turn lifecycle takes over
          patchPending(false);
          set({ awaitingAgent: false });
          void client.request({ type: "get_state" });
        })
        .catch((err: unknown) => {
          patchPending(true);
          fail(err, "prompt");
        });
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
      client.request({ type: "switch_session", sessionPath: path }).catch((err: unknown) => fail(err, "open session"));
    },

    renameSession(name: string) {
      set({ sessionName: name });
      client.request({ type: "set_session_name", name }).catch((err: unknown) => fail(err, "rename"));
    },

    async deleteSession(path: string) {
      try {
        const res = await fetch(`/api/sessions?path=${encodeURIComponent(path)}`, { method: "DELETE" });
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
      fetch("/api/cwd", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cwd }),
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as { ok?: boolean; cwd?: string; changed?: boolean; error?: string };
          if (!res.ok || !body.ok) throw new Error(body.error ?? `switch failed (${res.status})`);
          set({ projectCwd: body.cwd ?? cwd });
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
      try {
        const res = await fetch("/api/health");
        const body = (await res.json()) as {
          ok?: boolean;
          omp?: { resolved?: string | null; cwd?: string };
        };
        set({
          health: {
            ok: Boolean(body.ok),
            ompResolved: body.omp?.resolved ?? null,
            ompCwd: body.omp?.cwd ?? "",
          },
        });
        const available = Boolean(body.omp?.resolved);
        // First time the binary shows up: recycle the socket so the bridge
        // spawns a fresh agent child immediately.
        if (available && !get().health?.ompResolved) client.reconnect();
        return available;
      } catch {
        return false;
      }
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
    set((state) =>
      status === "connected"
        ? // Fresh child process after every reconnect until `agent_ready`.
          // projects/projectCwd come from the bridge (not the agent child), so
          // they survive the reset; they are re-synced on `ready`.
          {
            ...initialState,
            connStatus: status,
            health: state.health,
            projects: state.projects,
            projectCwd: state.projectCwd,
            actions: state.actions,
          }
        : { connStatus: status },
    );
  });
  client.start();
  fetch("/api/health")
    .then((res) => res.json())
    .then((body: { ok?: boolean; omp?: { resolved?: string | null; cwd?: string } }) => {
      set({
        health: {
          ok: Boolean(body.ok),
          ompResolved: body.omp?.resolved ?? null,
          ompCwd: body.omp?.cwd ?? "",
        },
      });
    })
    .catch(() => undefined);
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
