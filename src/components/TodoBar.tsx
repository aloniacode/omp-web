import { useState } from "react";
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
 * exist; collapsible so long lists don't crowd the chat.
 */
export function TodoBar() {
  const { t } = useI18n();
  const todos = useAppStore((s) => s.todos);
  const [expanded, setExpanded] = useState(true);

  // Hidden while empty; upstream `todo rm` can leave named phases with no
  // tasks — nothing left to show then, either.
  if (todos.length === 0 || todoProgress(todos).total === 0) return null;
  const { done, total } = todoProgress(todos);

  return (
    <div className="mx-auto mt-3 max-w-3xl px-4 sm:px-6">
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="flex w-full cursor-pointer items-center gap-3 text-left"
        >
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <IconListTodo size={14} />
          </div>
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-zinc-800 dark:text-zinc-100">
            {t("todo.title")}
          </span>
          <span className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10.5px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            {t("todo.progress", { done, total })}
          </span>
          <IconChevronDown
            size={14}
            className={`shrink-0 text-zinc-400 transition-transform ${expanded ? "" : "-rotate-90"}`}
          />
        </button>
        {expanded && (
          <div className="mt-2 space-y-2.5 border-t border-zinc-100 pt-2 dark:border-zinc-800">
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
        )}
      </div>
    </div>
  );
}
