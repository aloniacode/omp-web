import { useEffect, useState } from "react";
import { CircleDot as IconCircleDot, Flag as IconFlag, Play as IconPlay, Trash2 as IconTrash } from "lucide-react";
import { useI18n } from "../i18n";
import { useActions, useAppStore } from "../state/store";
import { fmtTokens } from "../lib/format";
import { buildGoalOpPrompt, GOAL_STATUS_KEYS } from "../lib/goalMode";

const STATUS_STYLES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  paused: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "budget-limited": "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
};

/**
 * Session goal banner (goal mode): objective, status, token budget burn-down,
 * and lifecycle actions. The RPC protocol exposes no goal commands, so actions
 * are prompt-mediated goal-tool ops (same design as omp's /guided-goal); the
 * resulting state arrives via `goal_updated` events.
 */
export function GoalBar() {
  const { t } = useI18n();
  const actions = useActions();
  const connected = useAppStore((s) => s.connStatus === "connected" && s.agentReady);
  const goal = useAppStore((s) => s.goal);
  const [confirmingDrop, setConfirmingDrop] = useState(false);

  // A fresh goal record (created / re-created) resets the drop confirmation.
  useEffect(() => setConfirmingDrop(false), [goal?.id]);

  if (!goal || goal.status === "complete" || goal.status === "dropped") return null;

  const budget = goal.tokenBudget;
  const budgetPct = budget && budget > 0 ? Math.min(100, (goal.tokensUsed / budget) * 100) : null;
  const statusLabel = t(GOAL_STATUS_KEYS[goal.status]);

  const runOp = (op: "complete" | "resume" | "drop") => {
    setConfirmingDrop(false);
    actions.sendPrompt(buildGoalOpPrompt(op));
  };

  return (
    // w-full keeps the banner stretched to max-w-3xl: without it the auto
    // side margins (flex child of <main>) shrink-wrap the panel to its text.
    <div className="mx-auto mt-3 w-full max-w-3xl px-4 sm:px-6">
      <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <IconFlag size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100" title={goal.objective}>
              {goal.objective}
            </span>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                STATUS_STYLES[goal.status] ?? "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
              }`}
            >
              {statusLabel}
            </span>
          </div>
          {budget && budget > 0 && (
            <div className="mt-1 flex items-center gap-2">
              <div className="h-1 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                <div
                  className="h-full rounded-full bg-accent transition-[width]"
                  style={{ width: `${budgetPct ?? 0}%` }}
                />
              </div>
              <span className="text-[10.5px] text-zinc-400 dark:text-zinc-500">
                {t("goal.budget", { used: fmtTokens(goal.tokensUsed), budget: fmtTokens(budget) })}
              </span>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {goal.status === "paused" ? (
            <button
              type="button"
              disabled={!connected}
              onClick={() => runOp("resume")}
              title={t("goal.resume")}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] text-zinc-600 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <IconPlay size={11} />
              {t("goal.resume")}
            </button>
          ) : (
            <button
              type="button"
              disabled={!connected}
              onClick={() => runOp("complete")}
              title={t("goal.complete")}
              className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[11.5px] text-zinc-600 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <IconCircleDot size={11} />
              {t("goal.complete")}
            </button>
          )}
          <button
            type="button"
            disabled={!connected}
            aria-pressed={confirmingDrop}
            onClick={() => (confirmingDrop ? runOp("drop") : setConfirmingDrop(true))}
            onBlur={() => setConfirmingDrop(false)}
            title={confirmingDrop ? t("goal.dropConfirm") : t("goal.drop")}
            className={`inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2.5 py-1 text-[11.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              confirmingDrop
                ? "border-red-300 bg-red-50 text-red-600 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300"
                : "border-zinc-200 bg-white text-zinc-600 hover:border-red-300 hover:text-red-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-red-500/40 dark:hover:text-red-300"
            }`}
          >
            <IconTrash size={11} />
            {confirmingDrop ? t("goal.dropConfirm") : t("goal.drop")}
          </button>
        </div>
      </div>
    </div>
  );
}
