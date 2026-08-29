import { useMemo, useState } from "react";
import {
  ArchiveRestore as IconCompress,
  ArrowRightLeft as IconHandoff,
  Ellipsis as IconDots,
  ExternalLink as IconExternalLink,
  PanelLeft as IconPanelLeft,
  Pencil as IconPencil,
  Pin as IconPin,
  Trash2 as IconTrash,
} from "lucide-react";
import { useI18n } from "../i18n";
import { useActions, useAppStore, selectIsStreaming } from "../state/store";
import type { SessionMeta } from "../rpc/types";
import { DeleteDialog, RenameDialog } from "./Sidebar";
import { isPinned, togglePin } from "../lib/pins";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

/** More-actions menu for the active session: rename, pin, compact, export, delete. */
function SessionMenu({ session }: { session: SessionMeta | null }) {
  const { t } = useI18n();
  const actions = useActions();
  const hasSession = useAppStore((s) => s.sessionId != null);
  const handoffInFlight = useAppStore((s) => s.handoffInFlight);
  const streaming = useAppStore(selectIsStreaming);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pinned = isPinned(session?.path ?? null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("topbar.more")}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <IconDots size={16} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!hasSession} onSelect={() => setRenaming(true)}>
            <IconPencil size={13} className="text-zinc-400" />
            {t("topbar.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!session?.path} onSelect={() => session?.path && togglePin(session.path)}>
            <IconPin size={13} className="text-zinc-400" fill={pinned ? "currentColor" : "none"} />
            {pinned ? t("sidebar.unpin") : t("sidebar.pin")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.compact()}>
            <IconCompress size={13} className="text-zinc-400" />
            {t("topbar.compact")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={handoffInFlight || streaming} onSelect={() => actions.handoff()}>
            <IconHandoff size={13} className="text-zinc-400" />
            {handoffInFlight ? t("topbar.handoffRunning") : t("topbar.handoff")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => actions.exportHtml()}>
            <IconExternalLink size={13} className="text-zinc-400" />
            {t("topbar.exportHtml")}
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" disabled={!session?.path} onSelect={() => setDeleting(true)}>
            <IconTrash size={13} />
            {t("topbar.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {renaming && session && <RenameDialog target={session} onClose={() => setRenaming(false)} />}
      {deleting && session && <DeleteDialog target={session} onClose={() => setDeleting(false)} />}
    </>
  );
}

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { t } = useI18n();
  const agentState = useAppStore((s) => s.agentState);
  const sessionName = useAppStore((s) => s.sessionName);
  const sessionId = useAppStore((s) => s.sessionId);
  const sessions = useAppStore((s) => s.sessions);
  const activePath = useAppStore((s) => s.activePath);
  const planMode = useAppStore((s) => s.planMode);
  const streaming = useAppStore(selectIsStreaming);
  const queued = agentState?.queuedMessageCount ?? 0;

  const title =
    sessionName ?? (sessionId ? t("topbar.session", { id: sessionId.slice(0, 8) }) : t("topbar.untitled"));

  const activeSession: SessionMeta | null = useMemo(() => {
    const listed = sessions.find((s) => s.path === activePath);
    if (listed) return listed;
    if (!activePath) return null;
    return {
      path: activePath,
      id: sessionId ?? "",
      cwd: null,
      title: sessionName,
      preview: "",
      mtimeMs: 0,
      size: 0,
      startedAt: null,
    };
  }, [sessions, activePath, sessionId, sessionName]);

  return (
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/80">
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
        {planMode && (
          <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 align-middle text-[10.5px] font-semibold uppercase tracking-wide text-accent">
            {t("plan.badge")}
          </span>
        )}
        {queued > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {t("topbar.queued", { n: queued })}
          </span>
        )}
        {streaming && (
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
            {t("topbar.streaming")}
            {agentState?.tokensPerSecond ? ` · ${Math.round(agentState.tokensPerSecond)} tok/s` : ""}
          </span>
        )}
      </h1>

      <SessionMenu session={activeSession} />
    </header>
  );
}
