import { useEffect, useMemo, useRef } from "react";
import type { ToolResultMessage } from "../rpc/types";
import { useStore } from "../state/store";
import { MessageView, UserRow, type ChatEntryUser } from "./MessageView";
import { IconBot } from "./icons";

const SUGGESTIONS = ["Explain this codebase", "Find and fix failing tests", "Review uncommitted changes"];

function EmptyState() {
  const { actions } = useStore();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-accent-foreground shadow-lg">
        <IconBot size={28} />
      </div>
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">omp web</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Chat with your oh-my-pi coding agent
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => actions.setComposerText(suggestion)}
            className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-[13px] text-zinc-600 shadow-sm transition-colors hover:border-accent hover:text-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-accent dark:hover:text-accent"
          >
            {suggestion}
          </button>
        ))}
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
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6"
    >
      {!hasContent ? (
        <EmptyState />
      ) : (
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {state.messages.map((entry, index) => {
            if (entry.role === "user") {
              return <UserRow key={`u${index}`} entry={entry as unknown as ChatEntryUser} />;
            }
            if (entry.role === "assistant") {
              return (
                <MessageView
                  key={`a${index}`}
                  message={entry}
                  resultsByCallId={resultsByCallId}
                  isStreamingTurn={false}
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
        </div>
      )}
    </div>
  );
}
