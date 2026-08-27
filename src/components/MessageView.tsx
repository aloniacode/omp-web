import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
} from "../rpc/types";
import { fmtCost, fmtTokPerSec, fmtTokens, truncate, userText } from "../lib/format";
import { useI18n } from "../i18n";
import { Markdown } from "./Markdown";
import { useStore } from "../state/store";
import {
  IconBot,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
} from "./icons";

// ── Collapsible shell ───────────────────────────────────────────────────────

function Collapsible({
  title,
  defaultOpen = false,
  tone = "neutral",
  children,
}: {
  title: ReactNode;
  defaultOpen?: boolean;
  tone?: "neutral" | "dim" | "error";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const toneClass =
    tone === "error"
      ? "border-red-300/60 bg-red-50 dark:border-red-500/40 dark:bg-red-950/30"
      : tone === "dim"
        ? "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900/60"
        : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900";
  return (
    <div className={`overflow-hidden rounded-xl border ${toneClass}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        {open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
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
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-100 p-2.5 font-mono text-[11.5px] leading-relaxed text-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200">
            {truncate(tool.outputText, 20_000)}
          </pre>
        )}
      </div>
    </Collapsible>
  );
}

// ── Thinking block ──────────────────────────────────────────────────────────

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
  const { t } = useI18n();
  return (
    <Collapsible
      tone="dim"
      defaultOpen={false}
      title={
        <span className="flex items-center gap-2">
          <span className="text-[13px] leading-none">☁️</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            {streaming ? t("message.thinking") : t("message.thoughtDone")}
          </span>
        </span>
      }
    >
      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-zinc-500 dark:text-zinc-400">{text}</p>
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

// ── Message rows ────────────────────────────────────────────────────────────

export interface ChatEntryUser {
  role: "user";
  content: string | Array<TextContent | ImageContent>;
  pending?: boolean;
  failed?: boolean;
}

export function UserRow({ entry }: { entry: ChatEntryUser }) {
  const { t } = useI18n();
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
          <p className="mt-1 text-right text-[10.5px] uppercase tracking-wide text-red-200">{t("message.failed")}</p>
        )}
      </div>
    </div>
  );
}

function ConnectedToolCard({
  call,
  resultsByCallId,
}: {
  call: ToolCall;
  resultsByCallId: Map<string, ToolResultMessage>;
}) {
  const { state } = useStore();
  const liveRun = state.toolRuns.find((run) => run.toolCallId === call.id);
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

function isThinkingBlock(block: AssistantMessage["content"][number]): block is ThinkingContent {
  return block.type === "thinking";
}

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
  const { t } = useI18n();
  const blocks = message.content;
  let lastThinkingIndex = -1;
  blocks.forEach((block, index) => {
    if (isThinkingBlock(block)) lastThinkingIndex = index;
  });

  return (
    <div className={`flex gap-3 ${showAvatar ? "" : "pl-10"}`}>
      {showAvatar && (
        <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
          <IconBot size={15} />
        </div>
      )}
      <div className="min-w-0 flex-1 space-y-2">
        {blocks.map((block, index) => {
          switch (block.type) {
            case "text":
              return (
                <div
                  key={index}
                  className={isStreamingTurn && index === blocks.length - 1 ? "stream-caret" : undefined}
                >
                  <Markdown text={(block as TextContent).text} />
                </div>
              );
            case "thinking":
              return (
                <ThinkingBlock
                  key={index}
                  text={(block as ThinkingContent).thinking}
                  streaming={isStreamingTurn && index === lastThinkingIndex}
                />
              );
            case "redactedThinking":
              return (
                <ThinkingBlock key={index} text={t("message.reasoningWithheld")} streaming={false} />
              );
            case "toolCall": {
              const call = block as ToolCall;
              return <ConnectedToolCard key={call.id || index} call={call} resultsByCallId={resultsByCallId} />;
            }
            case "image": {
              const image = block as ImageContent;
              return (
                <img
                  key={index}
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt="attachment"
                  className="max-h-72 rounded-xl border border-zinc-200 dark:border-zinc-800"
                />
              );
            }
            default:
              return null;
          }
        })}
        {message.errorMessage && (
          <p className="rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-[12.5px] text-red-600 dark:border-red-500/40 dark:bg-red-950/30 dark:text-red-300">
            {message.errorMessage}
          </p>
        )}
        {!isStreamingTurn && <UsageChips message={message} />}
      </div>
    </div>
  );
}
