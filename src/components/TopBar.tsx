import { useState } from "react";
import { useI18n } from "../i18n";
import { useStore } from "../state/store";
import { SettingsDialog } from "./SettingsDialog";
import { IconPanelLeft } from "./icons";

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { t } = useI18n();
  const { state } = useStore();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const streaming = Boolean(state.agentState?.isStreaming) || state.streamingMsg !== null;
  const queued = state.agentState?.queuedMessageCount ?? 0;

  const title =
    state.sessionName ??
    (state.sessionId ? t("topbar.session", { id: state.sessionId.slice(0, 8) }) : t("topbar.untitled"));

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/80">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
        title={t("topbar.toggleSidebar")}
      >
        <IconPanelLeft size={16} />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-800 dark:text-zinc-100">
        {title}
        {queued > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {t("topbar.queued", { n: queued })}
          </span>
        )}
        {streaming && (
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {t("topbar.streaming")}
            {state.agentState?.tokensPerSecond ? ` · ${Math.round(state.agentState.tokensPerSecond)} tok/s` : ""}
          </span>
        )}
      </h1>

      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title={t("topbar.settings")}
        className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.01a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
        </svg>
      </button>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
