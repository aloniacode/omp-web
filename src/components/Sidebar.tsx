import { useMemo, useState, type ReactNode } from "react";
import { useStore } from "../state/store";
import type { SessionMeta } from "../rpc/types";
import { relTime, truncate } from "../lib/format";
import { ACCENTS, useTheme, type ThemePref } from "../lib/theme";
import {
  IconMonitor,
  IconMoon,
  IconPencil,
  IconPlus,
  IconSearch,
  IconSun,
  IconTrash,
  IconX,
} from "./icons";

function sessionLabel(session: SessionMeta): { title: string; sub: string } {
  const title = session.title ?? "Untitled";
  const sub = session.preview && session.title ? truncate(session.preview, 60) : relTime(session.mtimeMs);
  return { title: truncate(title, 48), sub };
}

function ThemeSegmented() {
  const { pref, setPref } = useTheme();
  const options: Array<{ id: ThemePref; icon: typeof IconSun; label: string }> = [
    { id: "light", icon: IconSun, label: "Light" },
    { id: "dark", icon: IconMoon, label: "Dark" },
    { id: "system", icon: IconMonitor, label: "System" },
  ];
  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-zinc-200/70 p-0.5 dark:bg-zinc-800">
      {options.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          type="button"
          title={label}
          onClick={() => setPref(id)}
          className={`flex flex-1 items-center justify-center rounded-md px-2 py-1.5 transition-colors ${
            pref === id
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
              : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

function RenameDialog({ target, onClose }: { target: SessionMeta; onClose: () => void }) {
  const { actions } = useStore();
  const [name, setName] = useState(target.title ?? "");
  const save = () => {
    if (name.trim()) actions.renameSession(name.trim());
    onClose();
  };
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-[15px] font-semibold">Rename conversation</h2>
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
        <SaveButton label="Rename" onClick={save} />
      </div>
    </ModalShell>
  );
}

function DeleteDialog({ target, onClose }: { target: SessionMeta; onClose: () => void }) {
  const { actions } = useStore();
  return (
    <ModalShell onClose={onClose}>
      <h2 className="text-[15px] font-semibold">Delete conversation?</h2>
      <p className="mt-2 text-[13px] text-zinc-500 dark:text-zinc-400">
        “{truncate(target.title ?? "Untitled", 60)}” will be permanently removed from disk.
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
          Delete
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
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      Cancel
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
  onRename,
  onDelete,
}: {
  session: SessionMeta;
  active: boolean;
  onRename: (s: SessionMeta) => void;
  onDelete: (s: SessionMeta) => void;
}) {
  const { actions } = useStore();
  const { title, sub } = sessionLabel(session);
  return (
    <div
      className={`group relative rounded-lg ${active ? "bg-accent/10 dark:bg-accent/15" : "hover:bg-zinc-200/60 dark:hover:bg-zinc-800/70"}`}
    >
      <button
        type="button"
        onClick={() => actions.openSession(session.path)}
        className="block w-full px-3 py-2 pr-14 text-left"
      >
        <span
          className={`block truncate text-[13.5px] font-medium ${active ? "text-accent" : "text-zinc-700 dark:text-zinc-200"}`}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-zinc-400 dark:text-zinc-500">{sub}</span>
      </button>
      <div className="absolute right-1.5 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          title="Rename"
          onClick={() => onRename(session)}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-300/70 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
        >
          <IconPencil size={13} />
        </button>
        <button
          type="button"
          title="Delete"
          onClick={() => onDelete(session)}
          className="rounded-md p-1 text-zinc-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-950/60 dark:hover:text-red-400"
        >
          <IconTrash size={13} />
        </button>
      </div>
    </div>
  );
}

export function Sidebar({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, actions } = useStore();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<SessionMeta | null>(null);
  const [deleting, setDeleting] = useState<SessionMeta | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.sessions;
    return state.sessions.filter(
      (session) =>
        (session.title ?? "").toLowerCase().includes(q) ||
        session.preview.toLowerCase().includes(q),
    );
  }, [state.sessions, query]);

  return (
    <>
      {/* Mobile scrim */}
      <div
        className={`fixed inset-0 z-30 bg-black/30 md:hidden ${open ? "" : "hidden"}`}
        onClick={onClose}
      />
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-zinc-200 bg-zinc-50 transition-transform duration-200 md:static md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 pb-2 pt-4">
          <div className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground text-[13px] font-bold shadow-sm">
            π
          </div>
          <span className="flex-1 text-[15px] font-semibold tracking-tight">omp web</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 md:hidden dark:hover:bg-zinc-800"
            title="Close sidebar"
          >
            <IconX size={15} />
          </button>
        </div>

        {/* New chat */}
        <div className="px-3 pt-2">
          <button
            type="button"
            onClick={actions.newChat}
            disabled={!state.agentReady}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent text-accent-foreground px-3 py-2 text-[13.5px] font-medium shadow-sm transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            <IconPlus size={15} />
            New chat
          </button>
        </div>

        {/* Search */}
        <div className="px-3 pb-2 pt-3">
          <div className="relative">
            <IconSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search conversations"
              className="w-full rounded-lg border border-transparent bg-zinc-200/60 py-1.5 pl-8 pr-3 text-[13px] outline-none placeholder:text-zinc-400 focus:border-accent focus:bg-white dark:bg-zinc-800/80 dark:focus:bg-zinc-800"
            />
          </div>
        </div>

        {/* Sessions */}
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-2">
          {filtered.length === 0 && (
            <p className="px-2 py-6 text-center text-[12.5px] text-zinc-400 dark:text-zinc-500">
              {query ? "No matches" : "No conversations yet"}
            </p>
          )}
          {filtered.map((session) => (
            <SessionItem
              key={session.path}
              session={session}
              active={session.path === state.activePath}
              onRename={setRenaming}
              onDelete={setDeleting}
            />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-zinc-200 px-3 py-3 dark:border-zinc-800">
          <ThemeSegmented />
          <AccentSwatches />
          <ConnectionRow />
        </div>
      </aside>

      {renaming && <RenameDialog target={renaming} onClose={() => setRenaming(null)} />}
      {deleting && <DeleteDialog target={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}

function AccentSwatches() {
  const { accent, setAccent } = useTheme();
  return (
    <div className="mt-2.5 flex items-center justify-between gap-1 px-0.5">
      {ACCENTS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          title={preset.label}
          onClick={() => setAccent(preset.id)}
          className={`size-5 rounded-full border border-black/10 transition-transform dark:border-white/20 ${
            accent === preset.id
              ? "scale-110 ring-2 ring-zinc-400 ring-offset-2 ring-offset-zinc-50 dark:ring-zinc-500 dark:ring-offset-zinc-900"
              : "hover:scale-110"
          }`}
          style={{ backgroundColor: preset.swatch }}
        />
      ))}
    </div>
  );
}

function ConnectionRow() {
  const { state } = useStore();
  const status = state.connStatus;
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
      ? state.agentReady
        ? "agent connected"
        : "starting agent…"
      : status === "reconnecting"
        ? "reconnecting…"
        : status === "connecting"
          ? "connecting…"
          : "disconnected";
  return (
    <div className="mt-3 flex items-center gap-2 px-1 text-[11.5px] text-zinc-400 dark:text-zinc-500">
      <span className={`size-2 rounded-full ${color} ${status === "reconnecting" ? "animate-pulse" : ""}`} />
      <span className="truncate">{label}</span>
      {state.health?.ompResolved == null && status !== "closed" && (
        <span className="ml-auto truncate text-amber-500" title="omp binary not found on PATH">
          omp missing?
        </span>
      )}
    </div>
  );
}
