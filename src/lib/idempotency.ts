/**
 * Idempotency helpers: accidental double submissions (double clicks, fast
 * double-Enter, palette re-picks) must not duplicate agent work or tool
 * calls.
 */
import type { RpcCommand } from "../rpc/types";

/**
 * Stable coalescing key for an RPC command: commands with the same type and
 * arguments share one in-flight request. Prompt-like commands return null —
 * repeated submissions are chat, never duplicates.
 */
export function coalesceKey(command: RpcCommand): string | null {
  if (NON_IDEMPOTENT_COMMANDS.has(command.type)) return null;
  const args: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(command)) {
    if (key !== "id" && value !== undefined) args[key] = value;
  }
  const sorted = Object.keys(args)
    .sort()
    .map((key) => `${key}:${stableStringify(args[key])}`)
    .join("|");
  return `${command.type}#${sorted}`;
}

/** Commands whose repetition is meaningful user input, never a duplicate. */
export const NON_IDEMPOTENT_COMMANDS: ReadonlySet<string> = new Set([
  "prompt",
  "steer",
  "follow_up",
  "abort_and_prompt",
  // State-advancing cycles: a repeat must advance the state again.
  "cycle_model",
  "cycle_thinking_level",
]);

/**
 * Read-only commands safe to re-send after a reconnect: a fresh agent child
 * knows nothing of the dropped socket's in-flight requests, and these answer
 * identically from the reloaded session. `switch_session` is also replayed:
 * it targets a session under the connection's (already switched) cwd, so
 * re-issuing it to the fresh agent child is exactly the recovery the caller
 * wants — dropping it would roll back an in-flight session switch. Anything
 * else state-advancing is NOT replayed.
 */
export const REPLAYABLE_COMMANDS: ReadonlySet<string> = new Set([
  "get_state",
  "get_session_stats",
  "get_available_models",
  "get_messages",
  "get_messages_page",
  "switch_session",
]);

export function isReplayable(command: RpcCommand): boolean {
  return REPLAYABLE_COMMANDS.has(command.type);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

/** Plain text of a user-message content union (string or content blocks). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: "text"; text: string } => typeof b === "object" && b !== null && b.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return "";
}

function countImages(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  return content.filter((b) => typeof b === "object" && b !== null && b.type === "image").length;
}

/**
 * Whether `text` (+ `imageCount`) duplicates a pending (unacknowledged) user
 * message at the end of the transcript — e.g. Enter pressed twice before the
 * first send was accepted. Only trailing pending messages count: an
 * acknowledged identical prompt is legitimate chat.
 */
export function isDuplicatePendingMessage(
  messages: Array<{ role: string; content?: unknown; pending?: boolean }>,
  text: string,
  images = 0,
): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const entry = messages[i];
    if (entry.role !== "user") continue;
    if (!entry.pending) return false; // last user prompt already accepted
    return messageText(entry.content) === text && countImages(entry.content) === images;
  }
  return false;
}
