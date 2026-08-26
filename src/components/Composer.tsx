import { useEffect, useRef } from "react";
import { useStore } from "../state/store";
import { IconSend, IconSquare } from "./icons";

export function Composer() {
  const { state, actions } = useStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const connected = state.connStatus === "connected" && state.agentReady;

  // Auto-grow with content, clamped.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [state.composerText]);

  const submit = () => {
    const text = state.composerText.trim();
    if (!text || !connected) return;
    actions.sendPrompt(text);
    actions.setComposerText("");
  };

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pb-3 pt-2.5 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-accent dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            ref={textareaRef}
            rows={1}
            value={state.composerText}
            onChange={(e) => actions.setComposerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              connected
                ? "Message the agent… (Enter to send, Shift+Enter for newline)"
                : "Waiting for agent connection…"
            }
            disabled={!connected}
            className="max-h-[220px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14.5px] leading-relaxed outline-none placeholder:text-zinc-400 disabled:opacity-50"
          />
          {state.stopping || state.agentState?.isStreaming ? (
            <button
              type="button"
              onClick={actions.stop}
              title={state.stopping ? "Stopping…" : "Stop the agent"}
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white transition-colors hover:bg-red-500"
            >
              <IconSquare size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!state.composerText.trim() || !connected}
              title="Send"
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconSend size={15} />
            </button>
          )}
        </div>
        <p className="mt-1.5 px-1 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          Messages sent while streaming are queued as follow-ups · tokens and cost update per turn
        </p>
      </div>
    </div>
  );
}
