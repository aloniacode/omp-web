import { useEffect, useMemo, useRef } from "react";
import type { ToolResultMessage } from "../rpc/types";
import { useStore } from "../state/store";
import { setComposerText } from "../state/composerText";
import { useI18n } from "../i18n";
import { MessageView, UserRow, type ChatEntryUser } from "./MessageView";
import { IconBot } from "./icons";
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

export function ChatList() {
  const { state } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  // Pair committed tool results with their calls for card rendering.
  const resultsByCallId = useMemo(() => {
    const map = new Map<string, ToolResultMessage>();
    for (const entry of state.messages) {
      if (entry.role === "toolResult") map.set(entry.toolCallId, entry);
    }
    return map;
  }, [state.messages]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [state.messages, state.streamingMsg, state.toolRuns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  };

  const hasContent =
    state.messages.length > 0 || state.streamingMsg !== null || state.toolRuns.length > 0;

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="px-4 py-5 sm:px-6" onScroll={onScroll} viewportRef={scrollRef}>
      {!hasContent ? (
        <EmptyState />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {state.messages.map((entry, index) => {
            if (entry.role === "user") {
              return <UserRow key={`u${index}`} entry={entry as unknown as ChatEntryUser} />;
            }
            if (entry.role === "assistant") {
              // A new turn begins right after a user message; continuation
              // messages (thinking / tools / answer) render without avatar.
              const previous = state.messages[index - 1];
              const isTurnStart = index === 0 || previous?.role === "user";
              return (
                <MessageView
                  key={`a${index}`}
                  message={entry}
                  resultsByCallId={resultsByCallId}
                  isStreamingTurn={false}
                  showAvatar={isTurnStart}
                />
              );
            }
            return null; // toolResult rows render inside assistant tool cards
          })}

          {state.streamingMsg && (
            <MessageView
              message={state.streamingMsg}
              resultsByCallId={resultsByCallId}
              isStreamingTurn
            />
          )}

          {state.awaitingAgent && !state.streamingMsg && state.toolRuns.length === 0 && (
            <AgentWorkingRow />
          )}
        </div>
      )}
    </ScrollArea>
  );
}
