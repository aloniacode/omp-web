import { useState } from "react";
import { useI18n } from "../i18n";
import { useAppStore } from "../state/store";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/format";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

/**
 * assistant-ui-style context display: a small circular progress ring of the
 * model's context usage next to the model picker. Hovering opens a details
 * popover (context usage + session token totals and cost).
 */
export function ContextDisplay() {
  const { t } = useI18n();
  const context = useAppStore((s) => s.agentState?.contextUsage);
  const stats = useAppStore((s) => s.stats);
  const [open, setOpen] = useState(false);

  const usage = stats ?? null;
  if ((!context || context.contextWindow <= 0) && !usage) return null;

  const percent = context ? Math.min(100, Math.max(0, context.percent)) : 0;
  const remaining = context ? Math.max(0, context.contextWindow - context.tokens) : 0;
  const tone =
    percent >= 95 ? "text-red-500" : percent >= 80 ? "text-amber-500" : "text-accent";
  const barTone =
    percent >= 95 ? "bg-red-500" : percent >= 80 ? "bg-amber-500" : "bg-accent";

  // Ring geometry: r=5.5 in a 14×14 viewBox, stroke thickness 2.5.
  const R = 5.5;
  const CIRC = 2 * Math.PI * R;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={t("context.title")}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="flex h-7 cursor-default items-center gap-1.5 rounded-lg px-1.5 text-[11.5px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400"
      >
        <svg viewBox="0 0 14 14" className={`size-3.5 -rotate-90 ${tone}`} aria-hidden>
          <circle cx="7" cy="7" r={R} fill="none" strokeWidth="2.5" className="stroke-zinc-300 dark:stroke-zinc-600" />
          <circle
            cx="7"
            cy="7"
            r={R}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - percent / 100)}
          />
        </svg>
        <span className={percent >= 80 ? tone : undefined}>{fmtPercent(percent)}</span>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="center"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="w-60 p-3"
      >
        {context && context.contextWindow > 0 && (
          <>
            <p className="text-[12.5px] font-semibold text-zinc-800 dark:text-zinc-100">
              {t("context.title")}
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
              <div className={`h-full rounded-full ${barTone}`} style={{ width: `${percent}%` }} />
            </div>
            <dl className="mt-2.5 space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("context.used")}</dt>
                <dd className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmtTokens(context.tokens)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("context.window")}</dt>
                <dd className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmtTokens(context.contextWindow)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("context.available")}</dt>
                <dd className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmtTokens(remaining)}
                </dd>
              </div>
            </dl>
          </>
        )}
        {usage && (
          <div className={context && context.contextWindow > 0 ? "mt-3 border-t border-zinc-200 pt-2.5 dark:border-zinc-700" : undefined}>
            <dl className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("context.totalTokens")}</dt>
                <dd className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmtTokens(usage.tokens.total)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt className="text-zinc-500 dark:text-zinc-400">{t("context.cost")}</dt>
                <dd className="font-medium tabular-nums text-zinc-700 dark:text-zinc-200">
                  {fmtCost(usage.cost)}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

