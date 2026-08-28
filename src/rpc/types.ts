/**
 * Wire types mirrored from oh-my-pi's RPC protocol
 * (packages/coding-agent/src/modes/rpc/rpc-types.ts and pi-ai/pi-agent-core).
 *
 * Fields the web UI does not consume are omitted; optional typing stays
 * tolerant because older/newer agent runtimes may add fields.
 */

// ── Content blocks ──────────────────────────────────────────────────────────

export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  /** base64-encoded image data */
  data: string;
  mimeType: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
}

export interface RedactedThinkingContent {
  type: "redactedThinking";
  data: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  intent?: string;
}

// ── Messages ────────────────────────────────────────────────────────────────

export interface UsageCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  reasoningTokens?: number;
  premiumRequests?: number;
  cost: UsageCost;
}

export type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp?: number;
  synthetic?: boolean;
  steering?: boolean;
  attribution?: string;
}

export interface AssistantMessage {
  role: "assistant";
  content: (
    | TextContent
    | ThinkingContent
    | RedactedThinkingContent
    | ImageContent
    | ToolCall
    | { type: string; [k: string]: unknown }
  )[];
  api?: string;
  provider?: string;
  model?: string;
  usage?: Usage;
  stopReason?: StopReason;
  errorMessage?: string;
  timestamp?: number;
  duration?: number;
  ttft?: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError?: boolean;
  timestamp?: number;
  details?: unknown;
}

export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

/** Streaming sub-event carried on `message_update`; the partial message is authoritative. */
export type AssistantStreamDelta =
  | { type: "start" }
  | { type: "text_start" | "text_delta" | "text_end"; contentIndex: number; delta?: string }
  | { type: "thinking_start" | "thinking_delta" | "thinking_end"; contentIndex: number; delta?: string }
  | { type: "toolcall_start" | "toolcall_delta" | "toolcall_end"; contentIndex: number; delta?: string }
  | { type: "done" | "error"; reason?: string };

// ── Session state / stats ───────────────────────────────────────────────────

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export interface ModelInfo {
  provider: string;
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  /** Model accepts image inputs. */
  vision?: boolean;
  [k: string]: unknown;
}

export interface ContextUsage {
  tokens: number;
  contextWindow: number;
  percent: number;
}

export interface TodoTask {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface TodoPhase {
  id: string;
  name: string;
  tasks: TodoTask[];
}

export interface RpcSessionState {
  model?: ModelInfo;
  thinkingLevel?: ThinkingLevel;
  isStreaming: boolean;
  isCompacting: boolean;
  steeringMode?: "all" | "one-at-a-time";
  followUpMode?: "all" | "one-at-a-time";
  interruptMode?: "immediate" | "wait";
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  fastModeEnabled?: boolean;
  fastModeActive?: boolean;
  autoCompactionEnabled?: boolean;
  tokensPerSecond?: number | null;
  messageCount: number;
  queuedMessageCount: number;
  todoPhases?: TodoPhase[];
  contextUsage?: ContextUsage;
}

export interface SessionStats {
  sessionFile?: string;
  sessionId: string;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  toolResults: number;
  totalMessages: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
  cost: number;
  premiumRequests?: number;
  contextUsage?: ContextUsage;
}

// ── Frames ──────────────────────────────────────────────────────────────────

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

export interface AvailableCommand {
  name: string;
  description?: string;
  aliases?: string[];
  source: string;
  input?: { hint?: string };
}

export type ExtensionUiMethod =
  | "select"
  | "confirm"
  | "input"
  | "editor"
  | "cancel"
  | "notify"
  | "setStatus"
  | "setWidget"
  | "setTitle"
  | "set_editor_text"
  | "open_url";

export interface ExtensionUiRequest {
  type: "extension_ui_request";
  id: string;
  method: ExtensionUiMethod;
  title?: string;
  message?: string;
  placeholder?: string;
  prefill?: string;
  options?: string[];
  optionDetails?: Array<{ description?: string }>;
  url?: string;
  launchUrl?: string;
  instructions?: string;
  timeout?: number;
  targetId?: string;
  text?: string;
  widgetLines?: string[];
  statusKey?: string;
  statusText?: string;
  notifyType?: "info" | "warning" | "error";
}

export interface BridgeEventFrame {
  type: "bridge_event";
  event: "spawn_error" | "agent_exit" | "frame_error" | "bad_frame";
  error?: string;
  hint?: string;
  code?: number | null;
  signal?: string | null;
}

export interface NoticeFrame {
  type: "notice";
  level: "info" | "warning" | "error";
  message: string;
  source?: string;
}

/**
 * Every stdout frame category the UI understands, plus a tolerant fallback —
 * the protocol evolves independently of this client.
 */
export type RpcFrame =
  | RpcReadyFrame
  | RpcChunkFrame
  | RpcResponseFrame
  | PromptResultFrame
  | CommandOutputFrame
  | ExtensionUiRequest
  | BridgeEventFrame
  | NoticeFrame
  | ({ type: string } & Record<string, unknown>);

// ── Commands (stdin) ────────────────────────────────────────────────────────

export type RpcCommand =
  | { id?: string; type: "prompt"; message: string; images?: ImageContent[]; streamingBehavior?: "steer" | "followUp" }
  | { id?: string; type: "steer"; message: string }
  | { id?: string; type: "follow_up"; message: string }
  | { id?: string; type: "abort" }
  | { id?: string; type: "abort_and_prompt"; message: string }
  | { id?: string; type: "new_session" }
  | { id?: string; type: "get_state" }
  | { id?: string; type: "compact"; customInstructions?: string }
  | { id?: string; type: "set_model"; provider: string; modelId: string }
  | { id?: string; type: "cycle_model" }
  | { id?: string; type: "get_available_models" }
  | { id?: string; type: "set_fast_mode"; enabled: boolean }
  | { id?: string; type: "set_steering_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "set_follow_up_mode"; mode: "all" | "one-at-a-time" }
  | { id?: string; type: "set_interrupt_mode"; mode: "immediate" | "wait" }
  | { id?: string; type: "set_auto_compaction"; enabled: boolean }
  | { id?: string; type: "set_auto_retry"; enabled: boolean }
  | { id?: string; type: "export_html"; outputPath?: string }
  | { id?: string; type: "set_thinking_level"; level: ThinkingLevel }
  | { id?: string; type: "cycle_thinking_level" }
  | { id?: string; type: "switch_session"; sessionPath: string }
  | { id?: string; type: "set_session_name"; name: string }
  | { id?: string; type: "get_messages" }
  | { id?: string; type: "get_messages_page"; cursor?: string; limit?: number }
  | { id?: string; type: "get_session_stats" };

// ── Events (subset consumed by the UI) ──────────────────────────────────────

export interface AgentStartFrame {
  type: "agent_start";
  [k: string]: unknown;
}

export interface AgentEndFrame {
  type: "agent_end";
  messages?: AgentMessage[];
  isTerminal?: boolean;
  [k: string]: unknown;
}

export interface ToolExecutionFrame {
  type: "tool_execution_start" | "tool_execution_update" | "tool_execution_end";
  toolCallId: string;
  toolName: string;
  args?: Record<string, unknown>;
  /** update/end */
  partialResult?: ToolResultLike;
  /** end */
  result?: ToolResultLike;
  isError?: boolean;
  [k: string]: unknown;
}

export interface ToolResultLike {
  content?: (TextContent | ImageContent)[];
  isError?: boolean;
  [k: string]: unknown;
}

export type MessageStreamFrame =
  | { type: "message_start"; message: AssistantMessage }
  | { type: "message_update"; message: AssistantMessage; assistantMessageEvent?: AssistantStreamDelta }
  | { type: "message_end"; message: AssistantMessage };

export type SessionEventFrame =
  | AgentStartFrame
  | AgentEndFrame
  | MessageStreamFrame
  | ToolExecutionFrame
  | { type: "model_changed"; [k: string]: unknown }
  | { type: "thinking_level_changed"; thinkingLevel?: ThinkingLevel; [k: string]: unknown }
  | { type: "turn_start" | "turn_end"; [k: string]: unknown }
  | { type: string; [k: string]: unknown };

// ── Bridge REST ─────────────────────────────────────────────────────────────

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
