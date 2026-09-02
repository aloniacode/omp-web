import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  Bot as IconBot,
  Check as IconCheck,
  ChevronRight,
  RotateCcw as IconRotateCcw,
} from "lucide-react";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from "../rpc/types";
import type { ChatEntry } from "../state/store";
import { assistantText, fmtCost, fmtTokPerSec, fmtTokens, truncate, userText } from "../lib/format";
import { useI18n } from "../i18n";
import { Markdown } from "./Markdown";
import { CopyButton } from "./CopyButton";
import { useActions, useAppStore } from "../state/store";
import { Collapsible as CollapsibleRoot, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

// ── Collapsible shell ───────────────────────────────────────────────────────

function Collapsible({
  title,
  defaultOpen = false,
  open,
  onOpenChange,
  tone = "neutral",
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  /** Controlled variant (auto-collapse-on-done behaviour). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: "neutral" | "dim" | "error";
  children: ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-red-300/60 bg-red-50 dark:border-red-500/40 dark:bg-red-950/30"
      : tone === "dim"
        ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <CollapsibleRoot defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className={`overflow-hidden rounded-xl border ${toneClass}`}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">
        <ChevronRight
          size={14}
          className="shrink-0 text-zinc-400 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90"
        />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </CollapsibleTrigger>
      {/* Padding lives on an inner wrapper: Radix collapses the content via
          height animation + overflow hidden, and padding on the panel itself
          would still occupy space — leaving a dead strip the trigger hover
          can't cover. */}
      <CollapsibleContent>
        <div className="px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </CollapsibleRoot>
  );
}

// ── Tool card ───────────────────────────────────────────────────────────────

interface ToolView {
  name: string;
  args?: Record<string, unknown>;
  status: "running" | "done" | "error";
  outputText: string;
}

function argsPreview(args: Record<string, unknown> | undefined): string {
  if (!args) return "";
  for (const key of ["command", "path", "pattern", "query", "url", "file", "name"]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return truncate(value.replaceAll(/\s+/g, " ").trim(), 90);
  }
  return "";
}

function ToolCard({ tool }: { tool: ToolView }) {
  const argsJson = useMemo(() => JSON.stringify(tool.args ?? {}, null, 2), [tool.args]);
  const preview = argsPreview(tool.args);
  return (
    <Collapsible
      tone={tool.status === "error" ? "error" : "neutral"}
      title={
        <span className="flex min-w-0 items-center gap-2">
          {tool.status === "running" && (
            <span className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          )}
          {tool.status === "done" && <IconCheck size={13} className="shrink-0 text-emerald-500" />}
          {tool.status === "error" && <span className="shrink-0 font-semibold text-red-500">✕</span>}
          <code className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[11.5px] font-semibold text-accent dark:bg-accent/15">
            {tool.name}
          </code>
          {preview && <span className="truncate text-zinc-500 dark:text-zinc-400">{preview}</span>}
        </span>
      }
    >
      <div className="space-y-2">
        {argsJson !== "{}" && (
          <pre className="max-h-44 overflow-auto rounded-lg bg-zinc-950/90 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-200">
            {argsJson}
          </pre>
        )}
        {tool.outputText && (
          <div className="group relative">
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200">
              {truncate(tool.outputText, 20_000)}
            </pre>
            <CopyButton
              text={() => tool.outputText}
              className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
        )}
      </div>
    </Collapsible>
  );
}

function ConnectedToolCard({
  call,
  resultsByCallId,
}: {
  call: ToolCall;
  resultsByCallId: Map<string, ToolResultMessage>;
}) {
  const liveRun = useAppStore((s) => s.toolRuns.find((run) => run.toolCallId === call.id));
  const committedResult = resultsByCallId.get(call.id);
  const view: ToolView = liveRun
    ? {
        name: liveRun.toolName,
        args: liveRun.args ?? call.arguments,
        status: liveRun.status,
        outputText: liveRun.outputText,
      }
    : {
        name: call.name,
        args: call.arguments,
        status: committedResult ? (committedResult.isError ? "error" : "done") : "running",
        outputText:
          committedResult?.content
            .filter((b): b is TextContent => b.type === "text")
            .map((b) => b.text)
            .join("\n") ?? "",
      };
  return <ToolCard tool={view} />;
}

// ── Thinking block ──────────────────────────────────────────────────────────

/** Render cap for thinking text: opening a fold with tens of thousands of
 *  characters in one <p> blocks layout for a visible moment. */
const THINKING_PREVIEW_CHARS = 4_000;

/**
 * assistant-ui-style reasoning: open while the model is actively thinking,
 * auto-collapses the moment it finishes. The user's manual toggle wins until
 * the next streaming phase.
 */
function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [open, setOpen] = useState(streaming);
  const userToggled = useRef(false);

  useEffect(() => {
    if (!userToggled.current) setOpen(streaming);
  }, [streaming]);

  const handleOpenChange = (next: boolean) => {
    userToggled.current = true;
    setOpen(next);
  };

  const clipped = !expanded && text.length > THINKING_PREVIEW_CHARS;
  const shown = clipped ? text.slice(0, THINKING_PREVIEW_CHARS) : text;
  return (
    <Collapsible
      tone="dim"
      open={open}
      onOpenChange={handleOpenChange}
      title={
        <span className="flex items-center gap-2">
          <span className="text-[13px] leading-none">☁️</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {streaming ? t("message.thinking") : t("message.thoughtDone")}
          </span>
        </span>
      }
    >
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{shown}</p>
      {text.length > THINKING_PREVIEW_CHARS && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-[11.5px] font-medium text-accent hover:underline"
        >
          {expanded
            ? t("message.showLess")
            : t("message.showAll", { chars: text.length.toLocaleString() })}
        </button>
      )}
    </Collapsible>
  );
}

// ── Usage chips ─────────────────────────────────────────────────────────────

function UsageChips({ message }: { message: AssistantMessage }) {
  const { t } = useI18n();
  if (!message.usage) return null;
  const usage = message.usage;
  const tps = fmtTokPerSec(usage.output, message.duration);
  const modelLabel = message.model ?? null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
      <span title={t("message.usageTooltip", { input: usage.input, output: usage.output })}>
        ↑ {fmtTokens(usage.input)} ↓ {fmtTokens(usage.output)}
      </span>
      {(usage.cacheRead > 0 || usage.cacheWrite > 0) && (
        <span title={t("message.cacheTooltip", { read: usage.cacheRead, write: usage.cacheWrite })}>
          cache {fmtTokens(usage.cacheRead)} / {fmtTokens(usage.cacheWrite)}
        </span>
      )}
      {usage.reasoningTokens ? <span>reasoning {fmtTokens(usage.reasoningTokens)}</span> : null}
      <span title={`cost ${fmtCost(usage.cost.total)}`}>{fmtCost(usage.cost.total)}</span>
      {tps && <span>{tps}</span>}
      {modelLabel && <span className="truncate opacity-75">{modelLabel}</span>}
      {message.stopReason === "aborted" && <span className="text-amber-500">{t("message.aborted")}</span>}
      {message.stopReason === "error" && <span className="text-red-500">{t("message.error")}</span>}
    </div>
  );
}

// ── Block rendering (shared by the live view and turn folds) ────────────────

function isProcessBlock(block: AssistantMessage["content"][number]): boolean {
  return block.type === "thinking" || block.type === "redactedThinking" || block.type === "toolCall";
}

function AssistantBlock({
  block,
  streaming,
  resultsByCallId,
}: {
  block: AssistantMessage["content"][number];
  streaming: boolean;
  resultsByCallId: Map<string, ToolResultMessage>;
}) {
  const { t } = useI18n();
  switch (block.type) {
    case "text":
      return <Markdown text={(block as TextContent).text} />;
    case "thinking":
      return <ThinkingBlock text={(block as ThinkingContent).thinking} streaming={streaming} />;
    case "redactedThinking":
      return <ThinkingBlock text={t("message.reasoningWithheld")} streaming={false} />;
    case "toolCall": {
      const call = block as ToolCall;
      return <ConnectedToolCard call={call} resultsByCallId={resultsByCallId} />;
    }
    case "image": {
      const image = block as ImageContent;
      return (
        // Data URLs decode locally — eager keeps heights stable right after
        // history expansion (no late image growth above the viewport).
        <img
          src={`data:${image.mimeType};base64,${image.data}`}
          alt="attachment"
          decoding="async"
          className="max-h-72 rounded-xl border border-zinc-200 dark:border-zinc-800"
        />
      );
    }
    default:
      return null;
  }
}

// ── Message rows ────────────────────────────────────────────────────────────

export interface ChatEntryUser {
  role: "user";
  content: string | Array<TextContent | ImageContent>;
  pending?: boolean;
  failed?: boolean;
}

export function UserRow({ entry }: { entry: ChatEntryUser }) {
  const { t } = useI18n();
  const actions = useActions();
  return (
    <div className="flex justify-end">
      <div
        className={`max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-foreground shadow-sm ${
          entry.pending ? "opacity-80" : ""
        } ${entry.failed ? "ring-2 ring-red-400" : ""}`}
      >
        <p className="whitespace-pre-wrap break-words text-[14.5px] leading-relaxed">{userText(entry.content)}</p>
        {entry.pending && (
          <p className="mt-1 text-right text-[10.5px] uppercase tracking-wide text-white/70">{t("message.sending")}</p>
        )}
        {entry.failed && (
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="text-[10.5px] uppercase tracking-wide text-red-200">{t("message.failed")}</span>
            <button
              type="button"
              onClick={() => actions.retryPrompt(entry as ChatEntry)}
              className="flex cursor-pointer items-center gap-1 rounded-md bg-white/15 px-1.5 py-0.5 text-[10.5px] font-medium text-white transition-colors hover:bg-white/25"
            >
              <IconRotateCcw size={10} />
              {t("message.retry")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Live assistant turn; renders every block as it streams in. */
export function MessageView({
  message,
  resultsByCallId,
  isStreamingTurn,
  showAvatar = true,
}: {
  message: AssistantMessage;
  resultsByCallId: Map<string, ToolResultMessage>;
  isStreamingTurn: boolean;
  /** Render the agent avatar only at the start of a turn. */
  showAvatar?: boolean;
}) {
  const blocks = message.content;
  let lastThinkingIndex = -1;
  blocks.forEach((block, index) => {
    if (block.type === "thinking") lastThinkingIndex = index;
  });

  return (
    <div className={`flex gap-3 ${showAvatar ? "" : "pl-10"}`}>
      {showAvatar && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
          <IconBot size={15} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        {blocks.map((block, index) => (
          <div key={index} className={isStreamingTurn && index === blocks.length - 1 ? "stream-caret" : undefined}>
            <AssistantBlock
              block={block}
              streaming={isStreamingTurn && index === lastThinkingIndex}
              resultsByCallId={resultsByCallId}
            />
          </div>
        ))}
        {message.errorMessage && (
          <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
            {message.errorMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Turn summary (completed turns) ──────────────────────────────────────────

function fmtDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${Math.round(s % 60)}s`;
}

/**
 * One fold per finished turn: the entire execution flow (thinking, tool
 * calls, intermediate texts) collapses into a single summary row — only the
 * final conclusion stays visible below it.
 */
export function TurnRow({
  user,
  assistants,
  resultsByCallId,
}: {
  user: ChatEntry | null;
  assistants: AssistantMessage[];
  resultsByCallId: Map<string, ToolResultMessage>;
}) {
  const { t } = useI18n();

  // Conclusion = text/image blocks of the last assistant message that has
  // any; everything else (including that message's thinking/tools) folds.
  let conclusionIndex = -1;
  for (let i = assistants.length - 1; i >= 0; i -= 1) {
    if (assistants[i].content.some((b) => b.type === "text" || b.type === "image")) {
      conclusionIndex = i;
      break;
    }
  }
  const conclusion = conclusionIndex >= 0 ? assistants[conclusionIndex] : null;

  const processBlocks: AssistantMessage["content"] = [];
  let totalDuration = 0;
  let stepCount = 0;
  assistants.forEach((message, index) => {
    if (message.duration != null) totalDuration += message.duration;
    message.content.forEach((block) => {
      if (index === conclusionIndex && !isProcessBlock(block)) return;
      processBlocks.push(block);
      if (isProcessBlock(block)) stepCount += 1;
    });
  });
  const lastError = assistants.filter((m) => m.errorMessage).at(-1) ?? null;

  return (
    <>
      {user && user.role === "user" && <UserRow entry={user as ChatEntryUser} />}
      {assistants.length > 0 && (
        <div className="flex gap-3">
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
            <IconBot size={15} />
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            {processBlocks.length > 0 && (
              <Collapsible
                tone="dim"
                title={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="text-[12px] leading-none">⚡</span>
                    <span className="text-zinc-500 dark:text-zinc-400">
                      {t("message.turnSummary", { steps: stepCount })}
                    </span>
                    {totalDuration > 0 && (
                      <span className="shrink-0 text-[11.5px] tabular-nums text-zinc-400">
                        {fmtDuration(totalDuration)}
                      </span>
                    )}
                  </span>
                }
              >
                <div className="space-y-2">
                  {processBlocks.map((block, index) => (
                    <AssistantBlock key={index} block={block} streaming={false} resultsByCallId={resultsByCallId} />
                  ))}
                </div>
              </Collapsible>
            )}
            {conclusion && (
              <div className="group/conclusion relative space-y-2">
                {conclusion.content
                  .filter((block) => !isProcessBlock(block))
                  .map((block, index) => <AssistantBlock key={index} block={block} streaming={false} resultsByCallId={resultsByCallId} />)}
                {assistantText(conclusion.content) && (
                  <CopyButton
                    text={() => assistantText(conclusion.content)}
                    className="absolute -top-1 right-0 opacity-0 transition-opacity group-hover/conclusion:opacity-100"
                  />
                )}
              </div>
            )}
            {conclusion && <UsageChips message={conclusion} />}
            {lastError && (
              <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
                {lastError.errorMessage}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
