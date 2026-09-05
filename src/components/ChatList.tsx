import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AssistantMessage, ToolResultMessage } from "../rpc/types";
import { useActions, useAppStore } from "../state/store";
import type { ChatEntry, ToolRun } from "../state/store";
import { setComposerText } from "../state/composerText";
import { useI18n } from "../i18n";
import { assistantText, userText } from "../lib/format";
import { extractPlan } from "../lib/planMode";
import { MessageView, ToolCard, TurnRow } from "./MessageView";
import {
  Bot as IconBot,
  Check as IconCheck,
  ChevronUp as IconChevronUp,
  ClipboardList as IconPlan,
  Copy as IconCopy,
} from "lucide-react";
import { ScrollArea } from "./ScrollArea";
import { ConversationNav, type TurnNavItem } from "./ConversationNav";

const SUGGESTION_KEYS = ["chat.suggestion.1", "chat.suggestion.2", "chat.suggestion.3"] as const;

/** Windowed history: render the tail of the turn list, grow on demand. */
const INITIAL_VISIBLE_TURNS = 40;
const TURN_WINDOW_STEP = 40;

/** How close to the top (px) auto-expands the history window. */
const EXPAND_SCROLL_THRESHOLD = 80;

interface Turn {
  /** Stable key: index of the turn's opening message in the full array. */
  key: string;
  user: ChatEntry | null;
  assistants: AssistantMessage[];
}

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

/**
 * Optimistic agent reply: appears the instant a prompt is dispatched and
 * bridges the gap until the agent's first real event. Live tool runs that
 * started before any assistant text (the common first move) render here so
 * there is never a window with zero feedback.
 */
function AgentWorkingRow({ toolRuns }: { toolRuns: ToolRun[] }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-sm">
        <IconBot size={15} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="inline-flex items-center gap-2 rounded-2xl rounded-tl-md border border-zinc-200 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <span className="flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:300ms]" />
          </span>
          <span className="text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("chat.agentWorking")}</span>
        </div>
        {toolRuns.map((run) => (
          <ToolCard
            key={run.toolCallId}
            tool={{ name: run.toolName, args: run.args, status: run.status, outputText: run.outputText }}
          />
        ))}
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
  // Waiting agent state alone is enough — tool runs that begin before any
  // assistant text must stay visible, not blank the row out.
  const awaiting = useAppStore((s) => s.awaitingAgent && s.streamingMsg === null);
  const toolRuns = useAppStore((s) => s.toolRuns);
  if (!awaiting) return null;
  return <AgentWorkingRow toolRuns={toolRuns} />;
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
  const { t } = useI18n();
  const messages = useAppStore((s) => s.messages);
  const activePath = useAppStore((s) => s.activePath);
  const planMode = useAppStore((s) => s.planMode);
  const planModeFromIndex = useAppStore((s) => s.planModeFromIndex);
  const hasLiveContent = useAppStore((s) => s.streamingMsg !== null || s.toolRuns.length > 0 || s.awaitingAgent);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  /** Turn wrapper elements keyed by turn key — scroll targets for the nav. */
  const turnEls = useRef(new Map<string, HTMLDivElement>());
  /** Nav target waiting for the window to render it before scrolling. */
  const pendingNavKey = useRef<string | null>(null);
  const [activeTurnKey, setActiveTurnKey] = useState<string | null>(null);

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
    const el = scrollRef.current;
    if (stickToBottom.current && el) el.scrollTop = el.scrollHeight;
    computeActiveTurn();
  }, [messages, hasLiveContent]);

  // Scroll spy: the nav highlights the turn whose top is nearest the viewport
  // top (a ~100px band below it), defaulting to the first turn at the very top.
  const computeActiveTurn = () => {
    const el = scrollRef.current;
    if (!el) return;
    const vpTop = el.getBoundingClientRect().top;
    let current: string | null = null;
    let first: string | null = null;
    let last: string | null = null;
    for (const [key, node] of turnEls.current) {
      if (first === null) first = key;
      last = key;
      if (node.getBoundingClientRect().top <= vpTop + 100) current = key;
    }
    if (current !== null && el.scrollHeight - el.scrollTop - el.clientHeight < 16) {
      // Pinned to the bottom: a short trailing turn may not have reached the
      // spy band yet — highlight it so the bottom position is never nowhere.
      current = last;
    }
    setActiveTurnKey(current ?? first);
  };

  /** Scroll a mounted turn's wrapper to the top of the viewport. */
  const scrollToTurn = (key: string) => {
    const el = scrollRef.current;
    const node = turnEls.current.get(key);
    if (!el || !node) return;
    const rect = node.getBoundingClientRect();
    const vpRect = el.getBoundingClientRect();
    el.scrollTo({ top: rect.top - vpRect.top + el.scrollTop - 16, behavior: "smooth" });
  };

  // Nav click: jump to the turn's wrapper, detaching from follow-the-bottom
  // so streaming doesn't yank the viewport straight back down. A target the
  // history window is still holding back gets the window widened first — the
  // scroll itself runs from the layout effect below, once the turn is mounted.
  const onNavigate = (key: string) => {
    stickToBottom.current = false;
    const index = turns.findIndex((turn) => turn.key === key);
    if (index < 0) return;
    if (index < turns.length - visibleTurns) {
      pendingNavKey.current = key;
      setVisibleTurns(turns.length - index);
      return;
    }
    scrollToTurn(key);
  };

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
  // fold into one summary row once the turn is history. Keys derive from the
  // opening message's index in the full array so a widened window never
  // remounts rendered turns.
  const turns = useMemo(() => {
    const groups: Turn[] = [];
    let openIndex = 0;
    for (let index = 0; index < messages.length; index += 1) {
      const entry = messages[index];
      if (entry.role === "user") {
        openIndex = index;
        groups.push({ key: `m${openIndex}`, user: entry, assistants: [] });
      } else if (entry.role === "assistant") {
        if (groups.length === 0) {
          openIndex = index;
          groups.push({ key: `m${openIndex}`, user: null, assistants: [] });
        }
        groups[groups.length - 1].assistants.push(entry);
      }
      // toolResult rows render inside assistant tool cards (resultsByCallId).
    }
    return groups;
  }, [messages]);

  // Nav outline: one node per turn opened by a user message; the title is the
  // user's own text, whitespace-collapsed and truncated in the node itself.
  const navItems = useMemo<TurnNavItem[]>(() => {
    const items: TurnNavItem[] = [];
    for (const turn of turns) {
      if (!turn.user) continue;
      const label = userText(turn.user.content).replace(/\s+/g, " ").trim();
      if (!label) continue;
      items.push({ key: turn.key, label });
    }
    return items;
  }, [turns]);

  // ── History windowing ────────────────────────────────────────────────────
  // Long sessions keep every message in memory but render only the most
  // recent turns; scrolling toward the top (or the explicit button) grows the
  // window by a step, with scroll anchoring so the viewport doesn't jump.
  const [visibleTurns, setVisibleTurns] = useState(INITIAL_VISIBLE_TURNS);
  const anchorRef = useRef<number | null>(null);

  // Render-time reset: switching sessions rewinds the window in the same
  // commit that swaps the transcript (a post-paint effect could let one frame
  // render the new session with the previous one's expanded window).
  const [prevPath, setPrevPath] = useState(activePath);
  if (prevPath !== activePath) {
    setPrevPath(activePath);
    setVisibleTurns(INITIAL_VISIBLE_TURNS);
  }

  const hiddenTurns = Math.max(0, turns.length - visibleTurns);
  const windowStart = hiddenTurns;
  // The expander speaks in messages, not turns (multi-message turns would
  // understate a turn count).
  const hiddenMessages = turns
    .slice(0, hiddenTurns)
    .reduce((count, turn) => count + (turn.user ? 1 : 0) + turn.assistants.length, 0);

  const expandWindow = () => {
    if (hiddenTurns === 0) return;
    anchorRef.current = scrollRef.current?.scrollHeight ?? null;
    setVisibleTurns((value) => value + TURN_WINDOW_STEP);
  };

  // Anchor compensation runs before paint: prepended turns increased
  // scrollHeight; shift scrollTop by the same delta to hold the viewport.
  // Skipped when pinned to the bottom — there the pin effect owns scrolling.
  useLayoutEffect(() => {
    if (stickToBottom.current) return;
    const anchor = anchorRef.current;
    anchorRef.current = null;
    const el = scrollRef.current;
    if (anchor === null || !el) return;
    el.scrollTop += el.scrollHeight - anchor;
  }, [visibleTurns]);

  // A nav click on a turn the window was holding back lands here once the
  // widened window has committed it to the DOM.
  useLayoutEffect(() => {
    const key = pendingNavKey.current;
    if (!key) return;
    pendingNavKey.current = null;
    scrollToTurn(key);
  }, [visibleTurns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    // Scroll spy: keep the nav highlight tracking the in-view turn.
    computeActiveTurn();
    if (el.scrollTop < EXPAND_SCROLL_THRESHOLD) expandWindow();
  };

  const hasContent = messages.length > 0 || hasLiveContent;

  const renderedTurns = turns.slice(windowStart);

  return (
    <div className="relative min-h-0 flex-1">
      <ScrollArea className="h-full" viewportClassName="px-4 py-5 sm:px-6" onScroll={onScroll} viewportRef={scrollRef}>
        {!hasContent ? (
          <EmptyState />
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-5">
            {hiddenMessages > 0 && (
              <button
                type="button"
                onClick={expandWindow}
                className="mx-auto flex cursor-pointer items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[12px] text-zinc-500 shadow-sm transition-colors hover:border-accent hover:text-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-accent dark:hover:text-accent"
              >
                <IconChevronUp size={13} />
                {t("chat.earlier", { n: hiddenMessages })}
              </button>
            )}
            {renderedTurns.map((turn) => (
              <div
                key={turn.key}
                ref={
                  turn.user
                    ? (node) => {
                        if (node) turnEls.current.set(turn.key, node);
                        else turnEls.current.delete(turn.key);
                      }
                    : undefined
                }
                className="flex flex-col gap-5"
              >
                <TurnRow user={turn.user} assistants={turn.assistants} resultsByCallId={resultsByCallId} />
              </div>
            ))}
            <StreamingRow resultsByCallId={resultsByCallId} />
            <WorkingRow />
            {planCandidate && <PlanReviewBar plan={planCandidate} />}
          </div>
        )}
      </ScrollArea>
      <ConversationNav items={navItems} activeKey={activeTurnKey} onNavigate={onNavigate} />
    </div>
  );
}
