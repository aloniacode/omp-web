import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssistantMessage, ToolResultMessage } from "../rpc/types";
import { useActions, useAppStore } from "../state/store";
import type { ChatEntry } from "../state/store";
import { setComposerText } from "../state/composerText";
import { useI18n } from "../i18n";
import { assistantText } from "../lib/format";
import { extractPlan } from "../lib/planMode";
import { MessageView, TurnRow } from "./MessageView";
import { Bot as IconBot, Check as IconCheck, ClipboardList as IconPlan, Copy as IconCopy } from "lucide-react";
import { ScrollArea } from "./ScrollArea";

const SUGGESTION_KEYS = ["chat.suggestion.1", "chat.suggestion.2", "chat.suggestion.3"] as const;

function EmptyState() {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-lg">
        <IconBot size={28} />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">{t("app.title")}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t("app.subtitle")}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTION_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setComposerText(t(key))}
            className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] text-zinc-600 shadow-sm transition-colors hover:border-accent hover:text-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-accent dark:hover:text-accent"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentWorkingRow() {
  const { t } = useI18n();
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
        <IconBot size={15} />
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 pt-1">
        <span className="flex gap-1">
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
          <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
        </span>
        <span className="text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("chat.agentWorking")}</span>
      </div>
    </div>
  );
}

/** Live assistant turn; isolates per-token updates to this subtree only. */
function StreamingRow({ resultsByCallId }: { resultsByCallId: Map<string, ToolResultMessage> }) {
  const streamingMsg = useAppStore((s) => s.streamingMsg);
  if (!streamingMsg) return null;
  return <MessageView message={streamingMsg} resultsByCallId={resultsByCallId} isStreamingTurn />;
}

function WorkingRow() {
  const active = useAppStore((s) => s.awaitingAgent && s.streamingMsg === null && s.toolRuns.length === 0);
  if (!active) return null;
  return <AgentWorkingRow />;
}

/**
 * Plan-mode review bar: when plan mode is on and the latest turn's reply
 * carries a `plan` block, offer approve-to-implement (exits plan mode) and a
 * copy shortcut. Mirrors oh-my-pi's plan review step.
 */
function PlanReviewBar({ plan }: { plan: string }) {
  const { t } = useI18n();
  const actions = useActions();
  const connected = useAppStore((s) => s.connStatus === "connected" && s.agentReady);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plan);
      setCopied(true);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — ignore
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-accent/40 bg-accent/5 px-4 py-3">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-accent">
        <IconPlan size={14} />
        {t("plan.reviewTitle")}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!connected}
          onClick={() => actions.approvePlan(plan)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <IconCheck size={13} />
          {t("plan.approve")}
        </button>
        <button
          type="button"
          disabled={!connected}
          onClick={() => void copy()}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[12.5px] text-zinc-600 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          <IconCopy size={13} />
          {copied ? t("plan.copied") : t("plan.copy")}
        </button>
      </div>
    </div>
  );
}

export function ChatList() {
  const messages = useAppStore((s) => s.messages);
  const activePath = useAppStore((s) => s.activePath);
  const planMode = useAppStore((s) => s.planMode);
  const planModeFromIndex = useAppStore((s) => s.planModeFromIndex);
  const hasLiveContent = useAppStore((s) => s.streamingMsg !== null || s.toolRuns.length > 0 || s.awaitingAgent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Pair committed tool results with their calls for card rendering.
  const resultsByCallId = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const entry of messages) {
      if (entry.role === "toolResult") map.set(entry.toolCallId, entry);
    }
    return map;
  }, [messages]);

  // A freshly opened session starts pinned to the bottom.
  useEffect(() => {
    stickToBottom.current = true;
  }, [activePath]);

  // Committed messages arrive async after the path change (loadAllMessages);
  // a layout effect scrolls after the DOM commit, when scrollHeight is real.
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, hasLiveContent]);

  // Follow-the-bottom scroll driven by a store subscription: streaming tokens
  // update the DOM without re-rendering the whole committed message list.
  // rAF defers the scroll until after React has committed the DOM update.
  useEffect(() => {
    let prev = useAppStore.getState();
    let raf = 0;
    return useAppStore.subscribe((state) => {
      const changed =
        state.streamingMsg !== prev.streamingMsg || state.toolRuns !== prev.toolRuns;
      prev = state;
      if (!changed || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = scrollRef.current;
        if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
      });
    });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const hasContent = messages.length > 0 || hasLiveContent;

  // Plan review candidate: the `plan` block in the trailing assistant turn.
  // Scans backwards across the turn's assistant messages (a turn may hold
  // several); only turns begun after plan mode was enabled are considered.
  const planCandidate = useMemo(() => {
    if (!planMode || hasLiveContent) return null;
    let text = "";
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const entry = messages[i];
      if (entry.role === "assistant") {
        if (planModeFromIndex != null && i < planModeFromIndex) return null;
        text = `${assistantText(entry.content)}\n${text}`;
        continue;
      }
      if (entry.role === "toolResult") continue; // interleaved tool output
      break; // user message opens the turn
    }
    return extractPlan(text);
  }, [messages, planMode, planModeFromIndex, hasLiveContent]);

  // Group committed messages into turns: a user message opens a turn, and all
  // following assistant messages (thinking / tool calls / partial answers)
  // fold into one summary row once the turn is history.
  const turns = useMemo(() => {
    const groups: { key: string; user: ChatEntry | null; assistants: AssistantMessage[] }[] = [];
    for (const entry of messages) {
      if (entry.role === "user") {
        groups.push({ key: `u${groups.length}`, user: entry, assistants: [] });
      } else if (entry.role === "assistant") {
        if (groups.length === 0) groups.push({ key: `u${groups.length}`, user: null, assistants: [] });
        groups[groups.length - 1].assistants.push(entry);
      }
      // toolResult rows render inside assistant tool cards (resultsByCallId).
    }
    return groups;
  }, [messages]);

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="px-4 py-5 sm:px-6" onScroll={onScroll} viewportRef={scrollRef}>
      {!hasContent ? (
        <EmptyState />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {turns.map((turn) => (
            <TurnRow key={turn.key} user={turn.user} assistants={turn.assistants} resultsByCallId={resultsByCallId} />
          ))}

          <StreamingRow resultsByCallId={resultsByCallId} />
          <WorkingRow />
          {planCandidate && <PlanReviewBar plan={planCandidate} />}
        </div>
      )}
    </ScrollArea>
  );
}
