/* Hallmark · component: overlay panel (pill ↔ panel view transition) · genre: modern-minimal
 * theme: project tokens (zinc + runtime accent) · motion: View Transition API morph,
 * group 300ms ease-out-expo; unsupported browsers / reduced motion swap instantly
 * states: default · hover · focus-visible · expanded · collapsed · reduced-motion
 * (loading / error / success n/a — content is store-driven, no async here) */
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Ban as IconBan,
  Check as IconCheck,
  ChevronDown as IconChevronDown,
  Circle as IconCircle,
  CircleDot as IconCircleDot,
  ListTodo as IconListTodo,
  MinusCircle as IconMinusCircle,
} from "lucide-react";
import { useAppStore } from "../state/store";
import { useI18n } from "../i18n";
import { todoProgress, type TodoItem, type TodoStatus } from "../lib/todos";

/** Status icon + text styling, mirroring the TUI's strike-through treatment. */
const STATUS_STYLES: Record<TodoStatus, { icon: typeof IconCircle; className: string }> = {
  pending: { icon: IconCircle, className: "text-zinc-400 dark:text-zinc-500" },
  in_progress: { icon: IconCircleDot, className: "text-accent" },
  completed: { icon: IconCheck, className: "text-emerald-500" },
  abandoned: { icon: IconMinusCircle, className: "text-zinc-300 dark:text-zinc-600" },
  blocked: { icon: IconBan, className: "text-amber-500" },
};

function TaskRow({ task }: { task: TodoItem }) {
  const { icon: Icon, className } = STATUS_STYLES[task.status];
  const struck = task.status === "completed" || task.status === "abandoned";
  return (
    <li className="flex items-start gap-2 py-0.5" title={task.blocker}>
      <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center ${className}`}>
        <Icon size={12} />
      </span>
      <span
        className={`min-w-0 flex-1 text-[12.5px] leading-snug ${
          struck ? "text-zinc-400 line-through dark:text-zinc-500" : "text-zinc-700 dark:text-zinc-200"
        }`}
      >
        {task.content}
      </span>
      {task.blocker && <span className="shrink-0 text-[11px] text-amber-500">{task.blocker}</span>}
    </li>
  );
}

/**
 * Session todo panel: the agent's task list from todo-tool runs and get_state
 * snapshots (`todo_auto_clear` empties it). Hidden entirely while no todos
 * exist. Floats at the top-right of the chat area as an overlay — the
 * transcript keeps the full height and scrolls beneath it. Starts collapsed
 * to a compact pill; expanding morphs that pill into the panel.
 *
 * The morph rides the View Transition API: `view-transition-name` is handed
 * from the pill (collapsed) to the panel (expanded), so the browser pairs
 * their snapshots and animates the group's bounds between the two real
 * rectangles — the pill→panel direction falls out of the geometry, nothing
 * is measured or choreographed here (global.css styles the group). Browsers
 * without support, and reduced-motion users, swap the two surfaces instantly.
 */
export function TodoBar() {
  const { t } = useI18n();
  const todos = useAppStore((s) => s.todos);
  const [expanded, setExpanded] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const panelHeaderRef = useRef<HTMLButtonElement>(null);

  // Hidden while empty; upstream `todo rm` can leave named phases with no
  // tasks — nothing left to show then, either.
  if (todos.length === 0 || todoProgress(todos).total === 0) return null;
  const { done, total } = todoProgress(todos);
  const currentStep = todos.flatMap((phase) => phase.tasks).find((task) => task.status === "in_progress");

  // flushSync so both snapshots see the flipped state (the documented React
  // pattern inside startViewTransition). Focus follows the visible surface —
  // the outgoing one goes pointer-events-none/inert and would otherwise
  // strand keyboard focus.
  const toggle = (next: boolean) => {
    const apply = () => {
      flushSync(() => setExpanded(next));
      (next ? panelHeaderRef : pillRef).current?.focus({ preventScroll: true });
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !document.startViewTransition)
      apply();
    else document.startViewTransition(apply);
  };

  return (
    // Absolute overlay anchored to the chat area's top-right corner; the
    // layer is click-through so messages under the empty margin stay
    // interactive.
    <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-3 pt-3 sm:px-4">
      {/* Collapsed anchor: a content-hugging pill. It carries the transition
          name only while collapsed, so the browser pairs it with the panel. */}
      <button
        ref={pillRef}
        type="button"
        onClick={() => toggle(true)}
        aria-expanded={expanded}
        aria-controls="session-todos-panel"
        tabIndex={expanded ? -1 : 0}
        title={t("todo.expand")}
        className={`flex max-w-[calc(100%-1.5rem)] cursor-pointer items-center gap-2.5 rounded-full border border-zinc-200 bg-white/95 px-3 py-1.5 text-left shadow-lg backdrop-blur-sm outline-none hover:bg-zinc-100/70 focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-zinc-700 dark:bg-zinc-900/95 dark:hover:bg-zinc-800/50 ${
          expanded
            ? "pointer-events-none opacity-0 [view-transition-name:none]"
            : "pointer-events-auto opacity-100 [view-transition-name:todo-panel]"
        }`}
      >
        <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <IconListTodo size={13} />
        </div>
        <span className="min-w-0 flex-1 truncate text-[12px] text-zinc-600 dark:text-zinc-300">
          {currentStep ? (
            <>
              <span className="tabular-nums text-zinc-400 dark:text-zinc-500">
                {t("todo.progress", { done, total })}
              </span>
              <span className="text-zinc-300 dark:text-zinc-600"> · </span>
              {currentStep.content}
            </>
          ) : (
            t("todo.progress", { done, total })
          )}
        </span>
        <IconChevronDown size={14} className="shrink-0 -rotate-90 text-zinc-400" />
      </button>

      {/* Expanded surface: same name swap from the panel side; when collapsed
          it stays laid out (so the morph target size is real) but invisible
          and inert. */}
      <div
        id="session-todos-panel"
        role="region"
        aria-label={t("todo.title")}
        inert={!expanded}
        onKeyDown={(event) => {
          if (event.key === "Escape") toggle(false);
        }}
        className={`absolute top-3 right-3 w-64 max-w-[calc(100%-1.5rem)] overflow-hidden rounded-xl border border-zinc-200 bg-white/95 shadow-lg backdrop-blur-sm sm:right-4 dark:border-zinc-700 dark:bg-zinc-900/95 ${
          expanded
            ? "pointer-events-auto opacity-100 [view-transition-name:todo-panel]"
            : "pointer-events-none opacity-0 [view-transition-name:none]"
        }`}
      >
        <button
          ref={panelHeaderRef}
          type="button"
          onClick={() => toggle(false)}
          aria-expanded={expanded}
          aria-controls="session-todos-panel"
          title={t("todo.collapse")}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-[inherit] px-3 py-1.5 text-left outline-none hover:bg-zinc-100/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 dark:hover:bg-zinc-800/50"
        >
          <div className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <IconListTodo size={13} />
          </div>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">
            {t("todo.title")}
          </span>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-500 tabular-nums dark:bg-zinc-800 dark:text-zinc-400">
            {t("todo.progress", { done, total })}
          </span>
          <IconChevronDown size={14} className="shrink-0 rotate-180 text-zinc-400" />
        </button>
        <div className="max-h-[min(60vh,26rem)] space-y-2.5 overflow-y-auto border-t border-zinc-100 px-3 py-2 dark:border-zinc-800">
          {todos.map((phase, phaseIndex) => (
            <div key={`${phase.name}:${phaseIndex}`}>
              {phase.name && (
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {phase.name}
                </p>
              )}
              <ul>
                {phase.tasks.map((task, taskIndex) => (
                  <TaskRow key={`${task.content}:${taskIndex}`} task={task} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
