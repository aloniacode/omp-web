import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useActions, useAppStore } from "../state/store";
import type { SessionMeta } from "../rpc/types";
import { relTime, truncate } from "../lib/format";
import { togglePin, usePinned } from "../lib/pins";
import { useI18n } from "../i18n";
import { ScrollArea } from "./ScrollArea";
import { SettingsDialog } from "./SettingsDialog";
import {
  Pencil as IconPencil,
  Pin as IconPin,
  Plus as IconPlus,
  Search as IconSearch,
  Settings as IconSettings,
  Trash2 as IconTrash,
  X as IconX,
} from "lucide-react";

type GroupMode = "date" | "project";
const GROUP_MODE_KEY = "omp-web.session-group";

// ── Sidebar width (resizable, desktop only) ────────────────────────────────
/** The stock `w-72` (18rem) is the floor; the ceiling is half the viewport. */
const SIDEBAR_WIDTH_KEY = "omp-web.sidebar-width";
const SIDEBAR_MIN_WIDTH = 288;

function readStoredSidebarWidth(): number {
  const stored = Number(localStorage.getItem(SIDEBAR_WIDTH_KEY));
  return Number.isFinite(stored) && stored >= SIDEBAR_MIN_WIDTH ? Math.floor(stored) : SIDEBAR_MIN_WIDTH;
}

interface SessionGroup {
  key: string;
  label: string;
  sessions: SessionMeta[];
}

function sessionLabel(
  session: SessionMeta,
  untitled: string,
  timeLabels: Parameters<typeof relTime>[1],
): { title: string; sub: string } {
  const title = session.title ?? untitled;
  const sub = session.preview && session.title ? truncate(session.preview, 60) : relTime(session.mtimeMs, timeLabels);
  return { title: truncate(title, 48), sub };
}

/** Short project name from a session cwd (works for win32 and posix paths). */
function projectLabel(cwd: string | null): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

function dateBucket(ms: number): "today" | "yesterday" | "week" | "month" | "older" {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= startOfToday) return "today";
  if (ms >= startOfToday - 86_400_000) return "yesterday";
  if (ms >= startOfToday - 7 * 86_400_000) return "week";
  if (ms >= startOfToday - 30 * 86_400_000) return "month";
  return "older";
}

export function RenameDialog({ target, onClose }: { target: SessionMeta; onClose: () => void }) {
  const { t } = useI18n();
  const actions = useActions();
  const [name, setName] = useState(target.title ?? "");
  const save = () => {
    if (name.trim()) actions.renameSession(name.trim());
    onClose();
  };
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-[15px] font-semibold">{t("dialog.renameTitle")}</h2>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
        className="mt-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent dark:border-zinc-600 dark:bg-zinc-800"
      />
      <div className="mt-4 flex justify-end gap-2">
        <CancelButton onClick={onClose} />
        <SaveButton label={t("dialog.rename")} onClick={save} />
      </div>
    </ModalShell>
  );
}

export function DeleteDialog({ target, onClose }: { target: SessionMeta; onClose: () => void }) {
  const { t } = useI18n();
  const actions = useActions();
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-[15px] font-semibold">{t("dialog.deleteTitle")}</h2>
      <p className="mt-2 text-[13px] text-zinc-500 dark:text-zinc-400">
        {t("dialog.deleteBody", { title: truncate(target.title ?? t("topbar.untitled"), 60) })}
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <CancelButton onClick={onClose} />
        <button
          type="button"
          onClick={() => {
            void actions.deleteSession(target.path);
            onClose();
          }}
          className="rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-medium text-white hover:bg-red-500"
        >
          {t("dialog.delete")}
        </button>
      </div>
    </ModalShell>
  );
}

export function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
      role="presentation"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl dark:bg-zinc-900">{children}</div>
    </div>
  );
}

function CancelButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {t("dialog.cancel")}
    </button>
  );
}

function SaveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover"
    >
      {label}
    </button>
  );
}

function SessionItem({
  session,
  active,
  pending,
  pinned,
  onRename,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  /** A switch_session to this session is in flight (agent load takes seconds). */
  pending: boolean;
  pinned: boolean;
  onRename: (s: SessionMeta) => void;
  onDelete: (s: SessionMeta) => void;
}) {
  const { t } = useI18n();
  const actions = useActions();
  const { title, sub } = sessionLabel(session, t("topbar.untitled"), {
    justNow: t("time.justNow"),
    minutesAgo: t("time.minutesAgo"),
    hoursAgo: t("time.hoursAgo"),
    daysAgo: t("time.daysAgo"),
  });
  const highlight = active || pending;
  return (
    <div
      className={`group relative flex items-center rounded-lg ${highlight ? "bg-accent/10 dark:bg-accent/15" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70"}`}
    >
      {/* Pin toggle lives at the very front, always visible when pinned */}
      <button
        type="button"
        title={pinned ? t("sidebar.unpin") : t("sidebar.pin")}
        onClick={() => togglePin(session.path)}
        className={`ml-1 flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-zinc-300/70 dark:hover:bg-zinc-700 ${
          pinned ? "text-accent" : "text-zinc-400 opacity-0 group-hover:opacity-100"
        }`}
      >
        <IconPin size={12} fill={pinned ? "currentColor" : "none"} />
      </button>
      <button
        type="button"
        onClick={() => actions.openSession(session.path)}
        className="min-w-0 flex-1 px-1.5 py-2 pr-14 text-left"
      >
        <span
          className={`flex min-w-0 items-center gap-1.5 truncate text-[13.5px] font-medium ${highlight ? "text-accent" : "text-zinc-700 dark:text-zinc-200"}`}
        >
          {pending && (
            <span
              className="inline-block size-3 shrink-0 animate-spin rounded-full border-2 border-accent border-t-transparent"
              aria-hidden
            />
          )}
          <span className="truncate">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">{sub}</span>
      </button>
      <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          title={t("sidebar.rename")}
          onClick={() => onRename(session)}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-300/70 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <IconPencil size={13} />
        </button>
        <button
          type="button"
          title={t("sidebar.delete")}
          onClick={() => onDelete(session)}
          className="rounded-md p-1 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/60 dark:hover:text-red-400"
        >
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const actions = useActions();
  const sessions = useAppStore((s) => s.sessions);
  const activePath = useAppStore((s) => s.activePath);
  const pendingSessionPath = useAppStore((s) => s.pendingSessionPath);
  const agentReady = useAppStore((s) => s.agentReady);
  const pinned = usePinned();
  const [query, setQuery] = useState("");
  const [groupMode, setGroupMode] = useState<GroupMode>(() =>
    localStorage.getItem(GROUP_MODE_KEY) === "project" ? "project" : "date",
  );
  const [renaming, setRenaming] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);

  // Resizable width — desktop only; mobile keeps the fixed overlay width.
  const [width, setWidth] = useState(readStoredSidebarWidth);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const startResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = width;
    let next = startWidth;
    const onMove = (ev: PointerEvent) => {
      const max = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(window.innerWidth * 0.5));
      next = Math.min(Math.max(startWidth + ev.clientX - startX, SIDEBAR_MIN_WIDTH), max);
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("sidebar-resizing");
      localStorage.setItem(SIDEBAR_WIDTH_KEY, String(next));
    };
    document.body.classList.add("sidebar-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const resetWidth = () => {
    setWidth(SIDEBAR_MIN_WIDTH);
    localStorage.setItem(SIDEBAR_WIDTH_KEY, String(SIDEBAR_MIN_WIDTH));
  };

  useEffect(() => {
    localStorage.setItem(GROUP_MODE_KEY, groupMode);
  }, [groupMode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (session) => (session.title ?? "").toLowerCase().includes(q) || session.preview.toLowerCase().includes(q),
    );
  }, [sessions, query]);

  const groups = useMemo<SessionGroup[]>(() => {
    const pinnedSet = new Set(pinned);
    const pinnedSessions = filtered.filter((s) => pinnedSet.has(s.path));
    const rest = filtered.filter((s) => !pinnedSet.has(s.path));

    const groups: SessionGroup[] = [];
    if (pinnedSessions.length > 0) {
      groups.push({ key: "pinned", label: t("sidebar.pinned"), sessions: pinnedSessions });
    }

    if (groupMode === "date") {
      const dateKeys = ["today", "yesterday", "week", "month", "older"] as const;
      const byKey = new Map<string, SessionMeta[]>();
      for (const session of rest) {
        const bucket = dateBucket(session.mtimeMs);
        const list = byKey.get(bucket) ?? [];
        list.push(session);
        byKey.set(bucket, list);
      }
      const labels: Record<(typeof dateKeys)[number], string> = {
        today: t("sidebar.groupToday"),
        yesterday: t("sidebar.groupYesterday"),
        week: t("sidebar.groupThisWeek"),
        month: t("sidebar.groupThisMonth"),
        older: t("sidebar.groupOlder"),
      };
      for (const key of dateKeys) {
        const sessions = byKey.get(key);
        if (sessions?.length) groups.push({ key, label: labels[key], sessions });
      }
    } else {
      const byCwd = new Map<string, { label: string; sessions: SessionMeta[]; lastUsedMs: number }>();
      for (const session of rest) {
        const entry = byCwd.get(session.cwd ?? "") ?? {
          label: projectLabel(session.cwd) || t("sidebar.groupUnknownProject"),
          sessions: [],
          lastUsedMs: 0,
        };
        entry.sessions.push(session);
        entry.lastUsedMs = Math.max(entry.lastUsedMs, session.mtimeMs);
        byCwd.set(session.cwd ?? "", entry);
      }
      [...byCwd.entries()]
        .sort((a, b) => b[1].lastUsedMs - a[1].lastUsedMs)
        .forEach(([key, entry]) => groups.push({ key: `project:${key}`, label: entry.label, sessions: entry.sessions }));
    }
    return groups;
  }, [filtered, groupMode, pinned, t]);

  return (
    <>
      {/* Mobile scrim */}
      <div className={`fixed inset-0 z-30 bg-black/30 md:hidden ${open ? "" : "hidden"}`} onClick={onClose} />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform duration-200 md:relative md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        style={isDesktop ? { width, maxWidth: "50vw", minWidth: SIDEBAR_MIN_WIDTH } : undefined}
      >
        {/* Resize grip — drag to resize, double-click to reset (desktop only) */}
        <div
          aria-hidden
          onPointerDown={startResize}
          onDoubleClick={resetWidth}
          className="group absolute inset-y-0 right-0 z-10 hidden w-1.5 cursor-col-resize md:flex md:items-stretch"
        >
          <div className="h-full w-px bg-transparent transition-colors group-hover:bg-accent/50" />
        </div>
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-[13px] font-bold text-accent-foreground shadow-sm">
            π
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[15px] font-semibold leading-none tracking-tight">
              {t("app.title")}
            </span>
            <span className="mt-0.5 block font-mono text-[10.5px] leading-none text-zinc-400 dark:text-zinc-500">
              v{__APP_VERSION__}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 md:hidden dark:hover:bg-zinc-800"
            title={t("sidebar.close")}
          >
            <IconX size={15} />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={actions.newChat}
            disabled={!agentReady}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13.5px] font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus size={15} />
            {t("sidebar.newChat")}
          </button>
        </div>

        {/* Search + grouping toggle */}
        <div className="px-3 pb-2 pt-3">
          <div className="relative">
            <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("sidebar.search")}
              className="w-full rounded-lg border border-transparent bg-zinc-200/60 py-1.5 pl-8 pr-3 text-[13px] outline-none placeholder:text-zinc-400 focus:border-accent focus:bg-white dark:bg-zinc-800/80 dark:focus:bg-zinc-800"
            />
          </div>
          <div className="mt-2 flex items-center gap-0.5 rounded-lg bg-zinc-200/60 p-0.5 dark:bg-zinc-800/80">
            {(["date", "project"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setGroupMode(mode)}
                className={`flex-1 rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
                  groupMode === mode
                    ? "bg-white text-zinc-700 shadow-sm dark:bg-zinc-700 dark:text-zinc-200"
                    : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {mode === "date" ? t("sidebar.groupDate") : t("sidebar.groupProject")}
              </button>
            ))}
          </div>
        </div>

        {/* Sessions */}
        <ScrollArea className="min-h-0 flex-1" viewportClassName="px-3 pb-2">
         <nav className="space-y-0.5">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">
              {query ? t("sidebar.noMatches") : t("sidebar.empty")}
            </p>
          )}
          {groups.map((group) => (
            <div key={group.key} className="mt-2 first:mt-0">
              <p className="px-2 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.sessions.map((session) => (
                  <SessionItem
                    key={session.path}
                    session={session}
                    active={session.path === activePath}
                    pending={session.path === pendingSessionPath && session.path !== activePath}
                    pinned={pinned.includes(session.path)}
                    onRename={setRenaming}
                    onDelete={setDeleting}
                  />
                ))}
              </div>
            </div>
          ))}
         </nav>
        </ScrollArea>

        {/* Footer */}
        <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <ConnectionRow />
        </div>
      </aside>

      {renaming && <RenameDialog target={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function ConnectionRow() {
  const { t } = useI18n();
  const status = useAppStore((s) => s.connStatus);
  const agentReady = useAppStore((s) => s.agentReady);
  const ompResolved = useAppStore((s) => s.health?.ompResolved);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "reconnecting"
        ? "bg-amber-500"
        : status === "connecting"
          ? "bg-zinc-400"
          : "bg-red-500";
  const label =
    status === "connected"
      ? agentReady
        ? t("status.connected")
        : t("status.starting")
      : status === "reconnecting"
        ? t("status.reconnecting")
        : status === "connecting"
          ? t("status.connecting")
          : t("status.disconnected");
  return (
    <div className="flex items-center gap-2 px-1 text-[11.5px] text-zinc-400 dark:text-zinc-500">
      <span className={`size-2 rounded-full ${color} ${status === "reconnecting" ? "animate-pulse" : ""}`} />
      <span className="truncate">{label}</span>
      {ompResolved == null && status !== "closed" && (
        <span className="ml-auto truncate text-amber-500" title={t("status.ompTooltip")}>
          {t("status.ompMissing")}
        </span>
      )}
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        title={t("topbar.settings")}
        aria-label={t("topbar.settings")}
        className={`rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-200 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-200 ${
          ompResolved == null && status !== "closed" ? "" : "ml-auto"
        }`}
      >
        <IconSettings size={14} />
      </button>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
