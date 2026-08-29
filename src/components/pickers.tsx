import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  ArrowUp as IconArrowUp,
  Check as IconCheck,
  ChevronDown as IconChevronDown,
  Folder as IconFolder,
  GitBranch as IconGitBranch,
  Plus as IconPlus,
} from "lucide-react";

import { useActions, useAppStore } from "../state/store";
import { apiFetch } from "../rpc/connection";
import { useI18n } from "../i18n";
import type { BranchListResult, ModelInfo } from "../rpc/types";
import { THINKING_LEVELS } from "../rpc/types";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Slider } from "./ui/slider";

export function modelLabel(model: ModelInfo | undefined): string {
  if (!model) return "model";
  return `${model.provider}/${model.id}`;
}

/**
 * Discrete 7-step thinking-intensity slider.
 *
 * Dragging is purely local (zero RPC, zero store traffic — that was the
 * source of the jank: every intermediate step fired a `set_thinking_level`
 * round-trip through the agent). The level commits once on release via
 * `onValueCommit`; the local drag value hands over to the store value once
 * the agent confirms it.
 */
function ThinkingSlider({ levelIndex, onCommit }: { levelIndex: number; onCommit: (index: number) => void }) {
  const { t } = useI18n();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const activeIndex = dragIndex ?? levelIndex;
  const maxIndex = THINKING_LEVELS.length - 1;

  // Hand control back to the store value once the agent confirms the change.
  useEffect(() => {
    setDragIndex(null);
  }, [levelIndex]);

  return (
    <div className="w-56 outline-none">
      <div className="mb-2.5 flex items-baseline justify-between">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
          {t("picker.thinking")}
        </span>
        <span className="font-mono text-[11px] font-medium text-accent">{THINKING_LEVELS[activeIndex]}</span>
      </div>
      <div className="relative h-4 w-full">
        {/* rail (below the slider) */}
        <span className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        <Slider
          aria-label={t("picker.thinking")}
          min={0}
          max={maxIndex}
          step={1}
          value={[activeIndex]}
          onValueChange={(value) => setDragIndex(Math.round(value[0] ?? 0))}
          onValueCommit={(value) => onCommit(Math.round(value[0] ?? 0))}
          className="absolute inset-0 h-4 cursor-pointer"
          // Ticks are rendered above the (transparent-track) slider.
          trackClassName="h-4 overflow-visible bg-transparent"
          rangeClassName="top-1/2 h-1 -translate-y-1/2 rounded-full bg-gradient-to-r from-accent/60 to-accent"
          thumbClassName="top-1/2 size-3.5 -translate-y-1/2 rounded-full border-2 border-accent bg-white shadow-sm transition-transform duration-150 hover:scale-110 active:scale-95 dark:bg-zinc-900"
        />
        {/* step ticks: lit up to the active step, dim beyond */}
        {THINKING_LEVELS.map((level, i) => (
          <span
            key={level}
            style={{ left: `${(i / maxIndex) * 100}%` }}
            className={`pointer-events-none absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ${
              i <= activeIndex
                ? "size-[5px] bg-accent-foreground/90 dark:bg-zinc-950"
                : "size-[4px] bg-zinc-400/80 dark:bg-zinc-600"
            } ${i === activeIndex ? "ring-2 ring-accent/25" : ""}`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[9.5px] uppercase tracking-wider text-zinc-400/80">
        <span>{THINKING_LEVELS[0]}</span>
        <span>{THINKING_LEVELS[maxIndex]}</span>
      </div>
    </div>
  );
}

/**
 * Model switcher with a thinking-level slider pinned to the panel footer
 * (get_available_models → set_model / set_thinking_level). Rendered as a
 * popover (no Menu) so the slider keeps pointer/keyboard focus.
 */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const actions = useActions();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const current = useAppStore((s) => s.agentState?.model);
  const currentLevel = useAppStore((s) => s.agentState?.thinkingLevel);
  const models = useAppStore(useShallow((s) => s.models.slice(0, 400)));
  const modelsLoaded = useAppStore((s) => s.modelsLoaded);
  const levelIndex = Math.max(
    0,
    currentLevel ? THINKING_LEVELS.indexOf(currentLevel) : THINKING_LEVELS.indexOf("medium"),
  );
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={`flex ${compact ? "h-7 max-w-[210px]" : "h-8 max-w-[240px]"} min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}
      >
        <span className="truncate">{modelLabel(current)}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-0">
        <div className="flex max-h-80 flex-col">
          <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">
            {t("picker.models")}
          </p>
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            {models.map((model) => {
              const active = current && current.provider === model.provider && current.id === model.id;
              return (
                <button
                  key={modelLabel(model)}
                  type="button"
                  onClick={() => {
                    actions.setModel(model.provider, model.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-200">
                    {modelLabel(model)}
                  </span>
                  {active && <span className="shrink-0 text-accent">●</span>}
                </button>
              );
            })}
            {models.length === 0 && (
              <p className="px-2.5 py-3 text-center text-[12px] text-zinc-400">
                {modelsLoaded ? t("picker.noModels") : t("picker.loadingModels")}
              </p>
            )}
          </div>
          {/* Thinking level: intensity slider fixed below the model list */}
          <div className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
            <ThinkingSlider
              levelIndex={levelIndex}
              onCommit={(index) => {
                const level = THINKING_LEVELS[index];
                if (level) actions.setThinkingLevel(level);
              }}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function dirName(cwd: string): string {
  const trimmed = cwd.replace(/[\\/]+$/, "");
  const base = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return base || trimmed;
}

/** Branch list result plus the UI-side transport-failure marker. */
interface BranchInfo extends BranchListResult {
  failed?: boolean;
}

/**
 * Git branch switcher for the project the agent works in (bridge
 * /api/branches): lists local branches, checks one out, and creates + checks
 * out a new branch. Operations run in the bridge's current agent cwd, so the
 * picker follows ProjectPicker.
 */
export function BranchPicker() {
  const actions = useActions();
  const { t } = useI18n();
  const projectCwd = useAppStore((s) => s.projectCwd ?? s.health?.ompCwd) ?? "";
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<BranchInfo | null>(null);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    apiFetch("/api/branches")
      .then(async (res) => {
        if (!res.ok) throw new Error(`branches failed (${res.status})`);
        const body = (await res.json()) as Partial<BranchInfo>;
        setInfo({ repo: Boolean(body.repo), current: body.current ?? null, branches: Array.isArray(body.branches) ? body.branches : [] });
      })
      .catch(() => setInfo({ repo: false, current: null, branches: [], failed: true }));
  };

  // The branch label must not outlive its project: reset on cwd switch.
  useEffect(() => {
    setInfo(null);
  }, [projectCwd]);

  const close = () => {
    setOpen(false);
    setNewName("");
  };

  const checkout = async (name: string, create: boolean) => {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/branches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), create }),
      });
      const body = (await res.json()) as { ok?: boolean; current?: string; error?: string };
      if (!res.ok || !body.ok) throw new Error(body.error ?? `checkout failed (${res.status})`);
      actions.notify("info", t(create ? "notice.branchCreated" : "notice.branchSwitched", { branch: body.current ?? name }), "git");
      setNewName("");
      refresh();
    } catch (err) {
      actions.notify("error", err instanceof Error ? err.message : "checkout failed", "git");
    } finally {
      setBusy(false);
    }
  };

  const q = newName.trim().toLowerCase();
  const filtered = info?.branches.filter((b) => !q || b.name.toLowerCase().includes(q)) ?? [];

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          refresh();
        } else {
          close();
        }
      }}
    >
      <PopoverTrigger
        aria-label={t("picker.branch")}
        className="flex h-7 max-w-[180px] min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <IconGitBranch size={13} className="shrink-0 opacity-60" />
        <span className="truncate">{info?.current ?? t("picker.branch")}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-72 p-2">
        {info === null ? null : info.failed ? (
          <p className="px-2.5 py-3 text-center text-[12px] text-red-500">{t("picker.branchError")}</p>
        ) : !info.repo ? (
          <p className="px-2.5 py-3 text-center text-[12px] text-zinc-400">{t("picker.noRepo")}</p>
        ) : (
          <>
            <div className="max-h-60 overflow-y-auto">
              {filtered.map((branch) => (
                <button
                  key={branch.name}
                  type="button"
                  disabled={busy || branch.current}
                  onClick={() => void checkout(branch.name, false)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-100 disabled:cursor-default disabled:hover:bg-transparent dark:hover:bg-zinc-800 dark:disabled:hover:bg-transparent"
                >
                  <span className="truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-200">{branch.name}</span>
                  {branch.current && <IconCheck size={13} className="shrink-0 text-accent" />}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="px-2.5 py-3 text-center text-[12px] text-zinc-400">{t("picker.noBranches")}</p>
              )}
            </div>
            <div className="mt-1 flex gap-1.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void checkout(newName, true);
                }}
                placeholder={t("picker.newBranch")}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-zinc-400 focus:border-accent dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                disabled={busy || !newName.trim()}
                onClick={() => void checkout(newName, true)}
                title={t("picker.createBranch")}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11.5px] font-medium text-zinc-500 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-400"
              >
                <IconPlus size={12} className="shrink-0" />
                {t("picker.createBranch")}
              </button>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Case/separator-insensitive path comparison helper. */
function normPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** One directory level from the bridge's /api/fs browser. */
interface FsDir {
  /** Absolute path; "" while at the roots view (drives / home). */
  path: string;
  parent: string | null;
  entries: Array<{ name: string; path: string }>;
}

/**
 * Project directory switcher (/api/projects → /api/cwd) with search,
 * custom-path entry, and a device-filesystem browser (/api/fs). Switching
 * disposes the agent child bridge-side; the client reconnects into the
 * new cwd.
 */
export function ProjectPicker() {
  const actions = useActions();
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [browse, setBrowse] = useState<FsDir | null>(null);
  const [browseError, setBrowseError] = useState(false);
  const projects = useAppStore(useShallow((s) => s.projects));
  const current = useAppStore((s) => s.projectCwd ?? s.health?.ompCwd) ?? "";

  const q = query.trim();
  const qNorm = normPath(q);
  const filtered = qNorm
    ? projects.filter((p) => normPath(p.cwd).includes(qNorm) || dirName(p.cwd).toLowerCase().includes(qNorm))
    : projects;
  const isKnown =
    qNorm.length > 0 &&
    (projects.some((p) => normPath(p.cwd) === qNorm) || normPath(current) === qNorm);
  const custom = q && !isKnown ? q : null;

  const close = () => {
    setOpen(false);
    setQuery("");
    setBrowse(null);
    setBrowseError(false);
  };

  const commit = (cwd: string) => {
    if (cwd) actions.switchProject(cwd);
    close();
  };

  const openFs = async (dir: string) => {
    setBrowseError(false);
    setBrowse({ path: dir, parent: null, entries: [] });
    try {
      const res = await apiFetch(`/api/fs?path=${encodeURIComponent(dir)}`);
      const body = (await res.json()) as Partial<FsDir> & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "fs error");
      setBrowse({
        path: body.path ?? dir,
        parent: body.parent ?? null,
        entries: Array.isArray(body.entries) ? body.entries : [],
      });
    } catch {
      setBrowseError(true);
    }
  };

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (filtered.length === 1) commit(filtered[0].cwd);
    else if (custom) commit(custom);
  };

  return (
    <Popover open={open} onOpenChange={(next) => (next ? setOpen(true) : close())}>
      <PopoverTrigger
        aria-label={t("picker.project")}
        className="flex h-7 max-w-[200px] min-w-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <IconFolder size={13} className="shrink-0 opacity-60" />
        <span className="truncate">{current ? dirName(current) : t("picker.project")}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 p-2">
        {browse === null ? (
          <>
            <div className="flex gap-1.5">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder={t("picker.searchProjects")}
                className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] outline-none placeholder:text-zinc-400 focus:border-accent dark:border-zinc-700 dark:bg-zinc-900"
              />
              <button
                type="button"
                onClick={() => void openFs("")}
                title={t("picker.browseDevice")}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 px-2 text-[11.5px] font-medium text-zinc-500 transition-colors hover:border-accent hover:text-accent dark:border-zinc-700 dark:text-zinc-400"
              >
                <IconFolder size={12} className="shrink-0" />
                {t("picker.browse")}
              </button>
            </div>
            <div className="mt-1 max-h-60 overflow-y-auto">
              {filtered.map((project) => (
                <button
                  key={project.cwd}
                  type="button"
                  onClick={() => commit(project.cwd)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[12.5px] text-zinc-700 dark:text-zinc-200">
                      {dirName(project.cwd)}
                    </span>
                    <span className="truncate font-mono text-[10.5px] text-zinc-400">{project.cwd}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {project.sessions > 0 && (
                      <span className="text-[10.5px] text-zinc-400">{project.sessions}</span>
                    )}
                    {project.cwd === current && <span className="text-accent">●</span>}
                  </span>
                </button>
              ))}
              {custom && (
                <button
                  type="button"
                  onClick={() => commit(custom)}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <IconFolder size={13} className="shrink-0 text-accent" />
                  <span className="truncate text-[12.5px] text-accent">
                    {t("picker.useCustom", { path: custom })}
                  </span>
                </button>
              )}
              {filtered.length === 0 && !custom && (
                <p className="px-2.5 py-3 text-center text-[12px] text-zinc-400">{t("picker.noProjects")}</p>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={!browse.parent}
                onClick={() => browse.parent && void openFs(browse.parent)}
                title={t("picker.up")}
                className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 disabled:opacity-30 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <IconArrowUp size={13} />
              </button>
              <span
                className="min-w-0 flex-1 truncate rounded-lg bg-zinc-100 px-2 py-1.5 font-mono text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                title={browse.path || "/"}
              >
                {browse.path || "/"}
              </span>
            </div>
            <div className="mt-1 max-h-56 overflow-y-auto">
              {browseError ? (
                <p className="px-2.5 py-3 text-center text-[12px] text-red-500">{t("picker.fsError")}</p>
              ) : browse.entries.length === 0 ? (
                <p className="px-2.5 py-3 text-center text-[12px] text-zinc-400">{t("picker.emptyFolder")}</p>
              ) : (
                browse.entries.map((entry) => (
                  <button
                    key={entry.path}
                    type="button"
                    onClick={() => void openFs(entry.path)}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  >
                    <IconFolder size={13} className="shrink-0 text-zinc-400" />
                    <span className="truncate text-[12.5px] text-zinc-700 dark:text-zinc-200">{entry.name}</span>
                  </button>
                ))
              )}
            </div>
            <button
              type="button"
              disabled={!browse.path}
              onClick={() => commit(browse.path)}
              className="mt-1 w-full cursor-pointer rounded-lg bg-accent px-3 py-1.5 text-[12.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t("picker.useFolder")}
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
