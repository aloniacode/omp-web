import { useEffect, useState } from "react";
import { useStore } from "../state/store";
import { useI18n } from "../i18n";
import type { ExtensionUiRequest } from "../rpc/types";
import { ModalShell } from "./Sidebar";
import { IconExternalLink, IconX } from "./icons";

/** Interactive extension UI requests (select/confirm/input/editor/open_url). */
export function ExtUiDialogs() {
  const { state } = useStore();
  const request = state.extStack[state.extStack.length - 1];
  if (!request) return null;
  return <ExtDialog key={request.id} request={request} />;
}

function ExtDialog({ request }: { request: ExtensionUiRequest }) {
  const { actions } = useStore();
  const { t } = useI18n();
  const close = (outcome: Parameters<typeof actions.respondExtUi>[1]) => actions.respondExtUi(request, outcome);
  const cancel = () => close({ kind: "cancelled" });

  let body = null;
  switch (request.method) {
    case "select":
      body = (
        <SelectBody
          request={request}
          onPick={(value) => close({ kind: "value", value })}
        />
      );
      break;
    case "confirm":
      body = (
        <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-300">{request.message}</p>
      );
      break;
    case "input":
    case "editor":
      body = <InputBody request={request} onSubmit={(value) => close({ kind: "value", value })} />;
      break;
    case "open_url":
      body = (
        <div className="space-y-3">
          {request.instructions && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300">{request.instructions}</p>
          )}
          <a
            href={request.launchUrl ?? request.url ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-[13px] font-medium hover:border-accent dark:border-zinc-600"
          >
            {t("ext.openLink")} <IconExternalLink size={13} />
          </a>
          {request.launchUrl && (
            <p className="break-all font-mono text-[11.5px] text-zinc-400">{request.url}</p>
          )}
        </div>
      );
      break;
    default:
      body = null;
  }

  return (
    <ModalShell onClose={request.method === "select" || request.method === "input" || request.method === "editor" ? cancel : () => close({ kind: "dismissed" })}>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[15px] font-semibold">{request.title ?? t("ext.defaultTitle")}</h2>
        <button
          type="button"
          onClick={() => close({ kind: "dismissed" })}
          className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800"
          title={t("ext.dismiss")}
        >
          <IconX size={14} />
        </button>
      </div>
      <div className="mt-3">{body}</div>
      {request.method === "confirm" && (
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => close({ kind: "confirmed", confirmed: false })}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-[13px] font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {t("ext.no")}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => close({ kind: "confirmed", confirmed: true })}
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-medium text-accent-foreground hover:bg-accent-hover"
          >
            {t("ext.yes")}
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function SelectBody({
  request,
  onPick,
}: {
  request: ExtensionUiRequest;
  onPick: (value: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {(request.options ?? []).map((option, index) => {
        const detail = request.optionDetails?.[index]?.description;
        return (
          <button
            key={`${index}:${option}`}
            type="button"
            onClick={() => onPick(option)}
            className="rounded-lg border border-zinc-200 px-3 py-2 text-left text-[13.5px] hover:border-accent hover:bg-accent/10 dark:border-zinc-700 dark:hover:bg-accent/15"
          >
            {option}
            {detail && <span className="mt-0.5 block text-[12px] text-zinc-400">{detail}</span>}
          </button>
        );
      })}
    </div>
  );
}

function InputBody({
  request,
  onSubmit,
}: {
  request: ExtensionUiRequest;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(request.prefill ?? "");
  const common =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent dark:border-zinc-600 dark:bg-zinc-800";
  return request.method === "editor" ? (
    <textarea
      autoFocus
      rows={6}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) onSubmit(value);
      }}
      placeholder={request.placeholder}
      className={common}
    />
  ) : (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmit(value);
      }}
      placeholder={request.placeholder}
      className={common}
    />
  );
}

// ── Notices / toasts ────────────────────────────────────────────────────────

export function Toasts() {
  const { state, actions } = useStore();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-40 flex w-80 flex-col gap-2">
      {state.notices.map((notice) => (
        <ToastItem key={notice.id} notice={notice} onDismiss={() => actions.dismissNotice(notice.id)} />
      ))}
    </div>
  );
}

const TOAST_MS: Record<string, number> = { info: 6000, warning: 12000, error: 0 };

function ToastItem({
  notice,
  onDismiss,
}: {
  notice: { id: number; level: "info" | "warning" | "error"; message: string; source?: string };
  onDismiss: () => void;
}) {
  useEffect(() => {
    const ms = TOAST_MS[notice.level];
    if (!ms) return undefined;
    const timer = setTimeout(onDismiss, ms);
    return () => clearTimeout(timer);
  }, [notice.id, notice.level, onDismiss]);

  const tone =
    notice.level === "error"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-500/50 dark:bg-red-950/80 dark:text-red-200"
      : notice.level === "warning"
        ? "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/50 dark:bg-amber-950/80 dark:text-amber-200"
        : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200";

  return (
    <div
      className={`pointer-events-auto cursor-pointer rounded-xl border px-3.5 py-2.5 text-[12.5px] leading-snug shadow-lg ${tone}`}
      onClick={onDismiss}
      role="status"
    >
      {notice.source && (
        <span className="mr-1.5 rounded bg-black/10 px-1 py-0.5 font-mono text-[10px] uppercase dark:bg-white/10">
          {notice.source}
        </span>
      )}
      <span className="whitespace-pre-wrap break-words">{notice.message}</span>
    </div>
  );
}
