import { useState } from "react";
import { useI18n } from "../i18n";
import { truncate } from "../lib/format";

export interface TurnNavItem {
  key: string;
  /** Full user-side message text, whitespace-collapsed (tooltip source). */
  label: string;
}

/** Title cap per nav node — keeps the panel narrow and scannable. */
const NAV_LABEL_CHARS = 26;

/**
 * Codex-style session quick nav: a slim persistent dot rail on the left edge
 * of the chat, one dot per user turn. Hovering the rail expands a floating
 * titled list; clicking a dot or a list row jumps the chat to that turn. The
 * in-view turn's dot stays highlighted as a scroll spy.
 */
export function ConversationNav({
  items,
  activeKey,
  onNavigate,
}: {
  items: TurnNavItem[];
  activeKey: string | null;
  onNavigate: (key: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  return (
    <div
      className="absolute inset-y-0 left-0 z-30 hidden items-center md:flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {/* Slim persistent dot rail */}
      <div className="flex w-5 shrink-0 flex-col items-center gap-1.5">
        {items.map((item) => {
          const active = item.key === activeKey;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onNavigate(item.key)}
              title={item.label}
              aria-label={item.label}
              className={`cursor-pointer rounded-full transition-all duration-200 ${
                active
                  ? "size-2 bg-accent ring-2 ring-accent/25"
                  : "size-1.5 bg-zinc-300 hover:bg-zinc-400 dark:bg-zinc-600 dark:hover:bg-zinc-400"
              }`}
            />
          );
        })}
      </div>

      {/* Hover-expanded titled list */}
      {open && (
        <div className="ml-1.5 flex max-h-[70vh] w-60 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-baseline gap-1.5 px-3 pb-1.5 pt-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              {t("nav.title")}
            </span>
            <span className="text-[10.5px] tabular-nums text-zinc-300 dark:text-zinc-600">{items.length}</span>
          </div>
          <div className="overflow-y-auto px-1.5 pb-2">
            <div className="flex flex-col gap-0.5">
              {items.map((item, index) => {
                const active = item.key === activeKey;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    className={`group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors ${
                      active
                        ? "bg-accent/10 text-accent"
                        : "text-zinc-500 hover:bg-zinc-200/80 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-200"
                    }`}
                  >
                    <span
                      className={`shrink-0 font-mono text-[10.5px] tabular-nums ${
                        active
                          ? "text-accent/70"
                          : "text-zinc-300 group-hover:text-zinc-400 dark:text-zinc-600 dark:group-hover:text-zinc-500"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="truncate text-[12.5px] leading-snug">
                      {truncate(item.label, NAV_LABEL_CHARS)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
