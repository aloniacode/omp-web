import { useMemo, useState } from "react";
import { Dropdown } from "@heroui/react";
import { useI18n } from "../i18n";
import { useActions, useAppStore } from "../state/store";
import type { SessionMeta } from "../rpc/types";
import { DeleteDialog, RenameDialog } from "./Sidebar";
import { isPinned, togglePin } from "../lib/pins";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/format";
import { IconCompress, IconDots, IconExternalLink, IconPanelLeft, IconPencil, IconPin, IconTrash } from "./icons";

/** Centered conversation usage cluster: tokens · cost · context. */
function UsageCluster() {
  const { t } = useI18n();
  const usage = useAppStore((s) => s.stats);
  const context = useAppStore((s) => s.agentState?.contextUsage);
  if (!usage) return null;
  const ctxHot = context != null && context.percent >= 80;
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-full bg-zinc-100/80 px-3 py-1 text-[11px] font-medium tabular-nums text-zinc-500 md:flex dark:bg-zinc-800/70 dark:text-zinc-400">
      <span title={t("composer.usageTotal", { tokens: usage.tokens.total })}>
        {fmtTokens(usage.tokens.total)}
        <span className="ml-0.5 text-zinc-400 dark:text-zinc-500">tok</span>
      </span>
      <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
        ·
      </span>
      <span title={t("composer.usageCost")}>{fmtCost(usage.cost)}</span>
      {context && context.contextWindow > 0 && (
        <>
          <span aria-hidden className="text-zinc-300 dark:text-zinc-600">
            ·
          </span>
          <span
            className={ctxHot ? "text-amber-600 dark:text-amber-400" : undefined}
            title={t("composer.usageContext", {
              used: fmtTokens(context.tokens),
              window: fmtTokens(context.contextWindow),
              percent: fmtPercent(context.percent),
            })}
          >
            ctx {fmtPercent(context.percent)}
          </span>
        </>
      )}
    </div>
  );
}

/** More-actions menu for the active session: rename, pin, compact, export, delete. */
function SessionMenu({ session }: { session: SessionMeta | null }) {
  const { t } = useI18n();
  const actions = useActions();
  const hasSession = useAppStore((s) => s.sessionId != null);
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pinned = isPinned(session?.path ?? null);

  return (
    <>
      <Dropdown>
        <Dropdown.Trigger
          aria-label={t("topbar.more")}
          className="rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <IconDots size={16} />
        </Dropdown.Trigger>
        <Dropdown.Popover placement="bottom end">
          <Dropdown.Menu
            onAction={(key) => {
              switch (String(key)) {
                case "rename":
                  setRenaming(true);
                  break;
                case "pin":
                  if (session?.path) togglePin(session.path);
                  break;
                case "compact":
                  actions.compact();
                  break;
                case "export":
                  actions.exportHtml();
                  break;
                case "delete":
                  setDeleting(true);
                  break;
              }
            }}
          >
            <Dropdown.Item key="rename" id="rename" textValue={t("topbar.rename")} isDisabled={!hasSession}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconPencil size={13} className="text-zinc-400" />
                {t("topbar.rename")}
              </span>
            </Dropdown.Item>
            <Dropdown.Item key="pin" id="pin" textValue={t("sidebar.pin")} isDisabled={!session?.path}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconPin size={13} className="text-zinc-400" filled={pinned} />
                {pinned ? t("sidebar.unpin") : t("sidebar.pin")}
              </span>
            </Dropdown.Item>
            <Dropdown.Item key="compact" id="compact" textValue={t("topbar.compact")}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconCompress size={13} className="text-zinc-400" />
                {t("topbar.compact")}
              </span>
            </Dropdown.Item>
            <Dropdown.Item key="export" id="export" textValue={t("topbar.exportHtml")}>
              <span className="flex items-center gap-2 text-[13px]">
                <IconExternalLink size={13} className="text-zinc-400" />
                {t("topbar.exportHtml")}
              </span>
            </Dropdown.Item>
            <Dropdown.Item key="delete" id="delete" textValue={t("topbar.delete")} isDisabled={!session?.path}>
              <span className="flex items-center gap-2 text-[13px] text-red-600 dark:text-red-400">
                <IconTrash size={13} />
                {t("topbar.delete")}
              </span>
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
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
  const hasStreamMsg = useAppStore((s) => s.streamingMsg !== null);
  const streaming = Boolean(agentState?.isStreaming) || hasStreamMsg;
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

      <UsageCluster />
    </header>
  );
}
