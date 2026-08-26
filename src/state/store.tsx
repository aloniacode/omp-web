import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import type { ReactNode } from "react";
import { OmpRpcClient, type ConnStatus } from "../rpc/client";
import type {
  AgentEndFrame,
  AgentMessage,
  AssistantMessage,
  ExtensionUiRequest,
  ImageContent,
  ModelInfo,
  NoticeFrame,
  RpcFrame,
  RpcResponseFrame,
  RpcSessionState,
  SessionEventFrame,
  SessionMeta,
  SessionStats,
  ToolExecutionFrame,
  ThinkingLevel,
  ToolResultLike,
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
  images: ImageContent[];
  startedAt: number;
}

export interface UiNotice {
  id: number;
  level: "info" | "warning" | "error";
  message: string;
  source?: string;
}

export interface BridgeHealth {
  ok: boolean;
  ompResolved: string | null;
  ompCwd: string;
}

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
  notices: UiNotice[];
  extStack: ExtensionUiRequest[];
  composerText: string;
  stopping: boolean;
  modelsLoaded: boolean;
}

export interface StoreActions {
  sendPrompt(text: string): void;
  stop(): void;
  newChat(): void;
  openSession(path: string): void;
  renameSession(name: string): void;
  deleteSession(path: string): Promise<void>;
  compact(): void;
  setModel(provider: string, modelId: string): void;
  setThinkingLevel(level: string): void;
  respondExtUi(request: ExtensionUiRequest, outcome: ExtOutcome): void;
  setComposerText(text: string): void;
  dismissNotice(id: number): void;
  refreshSessions(): void;
  recheckHealth(): Promise<boolean>;
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
  notices: [],
  extStack: [],
  composerText: "",
  stopping: false,
};

type Action =
  | { type: "conn_status"; status: ConnStatus }
  | { type: "agent_ready" }
  | { type: "health"; health: BridgeHealth }
  | { type: "sessions"; sessions: SessionMeta[] }
  | { type: "agent_state"; state: RpcSessionState }
  | { type: "stats"; stats: SessionStats }
  | { type: "models"; models: ModelInfo[] }
  | { type: "messages"; messages: ChatEntry[] }
  | { type: "append_entry"; entry: ChatEntry }
  | { type: "patch_pending"; failed: boolean }
  | { type: "streaming"; message: AssistantMessage | null }
  | { type: "upsert_tool_run"; run: ToolRun }
  | { type: "clear_tool_runs" }
  | { type: "reset_transcript" }
  | { type: "notice"; notice: UiNotice }
  | { type: "dismiss_notice"; id: number }
  | { type: "push_ext_ui"; request: ExtensionUiRequest }
  | { type: "pop_ext_ui"; id: string }
  | { type: "composer_text"; text: string }
  | { type: "session_name"; name: string }
  | { type: "stopping"; value: boolean };

let noticeSeq = 1;

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "conn_status":
      // Fresh child process after every reconnect until `agent_ready`.
      return action.status === "connected"
        ? { ...initialState, connStatus: action.status, health: state.health }
        : { ...state, connStatus: action.status };
    case "agent_ready":
      return { ...state, agentReady: true };
    case "health":
      return { ...state, health: action.health };
    case "sessions":
      return { ...state, sessions: action.sessions };
    case "agent_state": {
      const s = action.state;
      return {
        ...state,
        agentState: s,
        sessionId: s.sessionId ?? state.sessionId,
        sessionName: s.sessionName ?? state.sessionName,
        activePath: s.sessionFile ?? state.activePath,
        stopping: s.isStreaming ? state.stopping : false,
      };
    }
    case "stats":
      return { ...state, stats: action.stats };
    case "models":
      return { ...state, models: action.models, modelsLoaded: true };
    case "messages":
      return { ...state, messages: action.messages };
    case "append_entry":
      return { ...state, messages: [...state.messages, action.entry] };
    case "patch_pending":
      return {
        ...state,
        messages: state.messages.map((entry) =>
          isOptimistic(entry) && entry.pending
            ? { ...entry, pending: false, failed: action.failed || entry.failed }
            : entry,
        ),
      };
    case "streaming":
      return { ...state, streamingMsg: action.message };
    case "upsert_tool_run": {
      const exists = state.toolRuns.some((r) => r.toolCallId === action.run.toolCallId);
      return {
        ...state,
        toolRuns: exists
          ? state.toolRuns.map((r) => (r.toolCallId === action.run.toolCallId ? action.run : r))
          : [...state.toolRuns, action.run],
      };
    }
    case "clear_tool_runs":
      return { ...state, toolRuns: [] };
    case "reset_transcript":
      return {
        ...state,
        messages: [],
        streamingMsg: null,
        toolRuns: [],
        stats: null,
        stopping: false,
      };
    case "notice":
      return { ...state, notices: [...state.notices.slice(-49), action.notice] };
    case "dismiss_notice":
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };
    case "push_ext_ui":
      return { ...state, extStack: [...state.extStack, action.request] };
    case "pop_ext_ui":
      return { ...state, extStack: state.extStack.filter((r) => r.id !== action.id) };
    case "composer_text":
      return { ...state, composerText: action.text };
    case "session_name":
      return { ...state, sessionName: action.name };
    case "stopping":
      return { ...state, stopping: action.value };
    default:
      return state;
  }
}

export function isOptimistic(entry: ChatEntry): entry is OptimisticUserMessage {
  return "pending" in entry || "failed" in entry;
}

function textOfToolResult(result: ToolResultLike | undefined): { text: string; images: ImageContent[] } {
  const blocks = result?.content;
  if (!Array.isArray(blocks)) return { text: "", images: [] };
  const images: ImageContent[] = [];
  let text = "";
  for (const block of blocks) {
    if (block.type === "text") text += block.text;
    else if (block.type === "image") images.push(block);
  }
  return { text, images };
}

// ── Context wiring ──────────────────────────────────────────────────────────

interface StoreValue {
  state: AppState;
  actions: StoreActions;
}

const StoreContext = createContext<StoreValue | null>(null);

/** Module-scope singleton: survives StrictMode remounts so exactly one bridge connection exists. */
const client = new OmpRpcClient();

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const loadEpoch = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const addNotice = useCallback(
    (level: UiNotice["level"], message: string, source?: string) => {
      dispatch({ type: "notice", notice: { id: noticeSeq++, level, message, source } });
    },
    [dispatch],
  );

  const refreshSessions = useCallback(() => {
    fetch("/api/sessions?limit=80")
      .then((res) => res.json())
      .then((body: { sessions?: SessionMeta[] }) => {
        if (Array.isArray(body.sessions)) dispatch({ type: "sessions", sessions: body.sessions });
      })
      .catch(() => undefined);
  }, []);

  const applyAgentState = useCallback((data: RpcSessionState) => dispatch({ type: "agent_state", state: data }), []);

  const loadAllMessages = useCallback(async (): Promise<ChatEntry[]> => {
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
        acc.push(...(resp.data.messages ?? []));
        if (!resp.data.nextCursor) return acc;
        cursor = resp.data.nextCursor;
      }
      return acc;
    } catch {
      // Legacy/v1 fallback or transient busy: best-effort monolithic snapshot.
      const resp = await client.request<{ messages: AgentMessage[] }>({ type: "get_messages" });
      if (resp.success && Array.isArray(resp.data?.messages)) return resp.data.messages;
      return acc;
    }
  }, []);

  const initSession = useCallback(async () => {
    const epoch = ++loadEpoch.current;
    try {
      const stateResp = await client.request<RpcSessionState>({ type: "get_state" });
      if (stateResp.success && stateResp.data) applyAgentState(stateResp.data);
      const entries = await loadAllMessages();
      if (loadEpoch.current !== epoch) return;
      dispatch({ type: "messages", messages: entries });
      void client.request({ type: "get_session_stats" });
      void client.request({ type: "get_available_models" });
    } catch (err) {
      addNotice("error", err instanceof Error ? err.message : "failed to initialize session");
    }
  }, [applyAgentState, loadAllMessages, addNotice]);

  // ── Frame routing ──────────────────────────────────────────────────────────

  const handleFrame = (frame: RpcFrame) => {
      switch (frame.type) {
        case "ready":
          dispatch({ type: "agent_ready" });
          void initSession();
          refreshSessions();
          break;

        case "agent_end": {
          const end = frame as AgentEndFrame;
          if (end.isTerminal === false) break; // maintenance pause, more work scheduled
          const committed = Array.isArray(end.messages) ? end.messages : null;
          if (committed) dispatch({ type: "messages", messages: committed });
          dispatch({ type: "streaming", message: null });
          dispatch({ type: "clear_tool_runs" });
          dispatch({ type: "stopping", value: false });
          void client.request({ type: "get_session_stats" });
          void client.request({ type: "get_state" });
          refreshSessions();
          break;
        }

        case "message_start":
        case "message_update":
        case "message_end": {
          const stream = frame as SessionEventFrame & { message?: AssistantMessage };
          if (stream.message && stream.message.role === "assistant") {
            dispatch({ type: "streaming", message: stream.message });
          }
          break;
        }

        case "tool_execution_start":
        case "tool_execution_update":
        case "tool_execution_end": {
          const tool = frame as ToolExecutionFrame;
          const payload = tool.result ?? tool.partialResult;
          const { text, images } = textOfToolResult(payload);
          const done = frame.type === "tool_execution_end";
          dispatch({
            type: "upsert_tool_run",
            run: {
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              args: tool.args,
              status: done ? (tool.isError ? "error" : "done") : "running",
              outputText: text,
              images,
              startedAt: Date.now(),
            },
          });
          break;
        }

        case "model_changed":
          void client.request({ type: "get_state" });
          void client.request({ type: "get_available_models" });
          break;

        case "thinking_level_changed":
          void client.request({ type: "get_state" });
          break;

        case "notice": {
          const notice = frame as NoticeFrame;
          addNotice(notice.level, notice.message, notice.source);
          break;
        }

        case "prompt_result":
          // Local-only prompts resolve here without an agent turn.
          dispatch({ type: "patch_pending", failed: false });
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
          dispatch({ type: "patch_pending", failed: false });
          break;
        }

        case "extension_ui_request": {
          const request = frame as ExtensionUiRequest;
          switch (request.method) {
            case "notify":
              addNotice(request.notifyType ?? "info", request.message ?? "", "extension");
              break;
            case "set_editor_text":
              dispatch({ type: "composer_text", text: request.text ?? "" });
              break;
            case "setTitle":
              if (request.title) dispatch({ type: "session_name", name: request.title });
              break;
            case "cancel":
              if (request.targetId) dispatch({ type: "pop_ext_ui", id: request.targetId });
              break;
            case "setStatus":
            case "setWidget":
              break; // no terminal-style surfaces in this UI
            default:
              dispatch({ type: "push_ext_ui", request });
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

  const routeResponse = (resp: RpcResponseFrame) => {
      if (resp.id !== undefined && String(resp.id).startsWith("protocol-")) return;
      switch (resp.command) {
        case "get_state":
          if (resp.success && resp.data) dispatch({ type: "agent_state", state: resp.data as RpcSessionState });
          break;
        case "get_session_stats":
          if (resp.success && resp.data) dispatch({ type: "stats", stats: resp.data as SessionStats });
          break;
        case "get_available_models": {
          if (!resp.success || !resp.data) break;
          const models = (resp.data as { models?: ModelInfo[] }).models ?? [];
          models.sort(
            (a, b) =>
              a.provider.localeCompare(b.provider) ||
              String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)),
          );
          dispatch({ type: "models", models });
          break;
        }
        case "new_session":
        case "switch_session":
          if (resp.success) {
            dispatch({ type: "reset_transcript" });
            void initSession();
          }
          break;
        case "set_model":
          if (resp.success) {
            void client.request({ type: "get_state" });
            void client.request({ type: "get_session_stats" });
          }
          break;
        case "set_session_name":
          if (resp.success) refreshSessions();
          break;
        default:
          break;
      }
  };

  // The sink identity must be stable across renders; routeResponse is defined
  // after handleFrame but both close over the same stable deps.
  const handleFrameRef = useRef(handleFrame);
  const routeResponseRef = useRef(routeResponse);
  handleFrameRef.current = (frame: RpcFrame) => {
    if (frame.type === "response") {
      routeResponseRef.current(frame as RpcResponseFrame);
      return;
    }
    handleFrame(frame);
  };

  useEffect(() => {
    const unsubFrames = client.onFrame((frame) => handleFrameRef.current(frame));
    const unsubStatus = client.onStatus((status) => dispatch({ type: "conn_status", status }));
    client.start();
    fetch("/api/health")
      .then((res) => res.json())
      .then((body: { ok?: boolean; omp?: { resolved?: string | null; cwd?: string } }) => {
        dispatch({
          type: "health",
          health: {
            ok: Boolean(body.ok),
            ompResolved: body.omp?.resolved ?? null,
            ompCwd: body.omp?.cwd ?? "",
          },
        });
      })
      .catch(() => undefined);
    refreshSessions();
    return () => {
      unsubFrames();
      unsubStatus();
    };
  }, [refreshSessions]);

  // ── Actions ────────────────────────────────────────────────────────────────

  const actions = useMemo<StoreActions>(() => {
    const fail = (err: unknown, what: string) =>
      addNotice("error", err instanceof Error ? err.message : `${what} failed`);

    return {
      sendPrompt(text: string) {
        const trimmed = text.trim();
        if (!trimmed) return;
        const streaming = stateRef.current.agentState?.isStreaming || stateRef.current.streamingMsg !== null;
        dispatch({
          type: "append_entry",
          entry: { role: "user", content: trimmed, timestamp: Date.now(), pending: true },
        });
        const command = streaming
          ? ({ type: "prompt", message: trimmed, streamingBehavior: "followUp" } as const)
          : ({ type: "prompt", message: trimmed } as const);
        client
          .request<{ agentInvoked?: boolean }>(command)
          .then((resp) => {
            if (!resp.success) throw new Error(resp.error ?? "prompt rejected");
            if (resp.data?.agentInvoked === true) return; // turn lifecycle takes over
            dispatch({ type: "patch_pending", failed: false });
            void client.request({ type: "get_state" });
          })
          .catch((err: unknown) => {
            dispatch({ type: "patch_pending", failed: true });
            fail(err, "prompt");
          });
      },

      stop() {
        dispatch({ type: "stopping", value: true });
        client.request({ type: "abort" }).catch((err: unknown) => {
          dispatch({ type: "stopping", value: false });
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
        dispatch({ type: "session_name", name });
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

      compact() {
        client.request({ type: "compact" }).then((resp) => {
          if (!resp.success) throw new Error(resp.error ?? "compact failed");
          addNotice("info", "Context compacted");
          void client.request({ type: "get_state" });
          void client.request({ type: "get_session_stats" });
        }).catch((err: unknown) => fail(err, "compact"));
      },

      setModel(provider: string, modelId: string) {
        client.request({ type: "set_model", provider, modelId }).catch((err: unknown) => fail(err, "model switch"));
      },

      setThinkingLevel(level: string) {
        client
          .request({ type: "set_thinking_level", level: level as ThinkingLevel })
          .catch((err: unknown) => fail(err, "thinking level"));
      },

      respondExtUi(request: ExtensionUiRequest, outcome: ExtOutcome) {
        dispatch({ type: "pop_ext_ui", id: request.id });
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

      setComposerText(text: string) {
        dispatch({ type: "composer_text", text });
      },

      dismissNotice(id: number) {
        dispatch({ type: "dismiss_notice", id });
      },

      refreshSessions,

      async recheckHealth() {
        try {
          const res = await fetch("/api/health");
          const body = (await res.json()) as {
            ok?: boolean;
            omp?: { resolved?: string | null; cwd?: string };
          };
          dispatch({
            type: "health",
            health: {
              ok: Boolean(body.ok),
              ompResolved: body.omp?.resolved ?? null,
              ompCwd: body.omp?.cwd ?? "",
            },
          });
          const available = Boolean(body.omp?.resolved);
          // First time the binary shows up: recycle the socket so the bridge
          // spawns a fresh agent child immediately.
          if (available && !stateRef.current.health?.ompResolved) client.reconnect();
          return available;
        } catch {
          return false;
        }
      },
    };
  }, [addNotice, refreshSessions]);

  const value = useMemo<StoreValue>(() => ({ state, actions }), [state, actions]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore outside StoreProvider");
  return ctx;
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
