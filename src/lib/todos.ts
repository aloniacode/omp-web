/**
 * Todo panel model — mirrors oh-my-pi's tools/todo.ts wire shapes:
 * `{ name, tasks: [{ content, status, blocker? }] }` with statuses
 * pending | in_progress | completed | abandoned | blocked. No ids on the
 * wire; legacy frames that carry them are tolerated and stripped.
 */
export type TodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface TodoItem {
  content: string;
  status: TodoStatus;
  /** Only when status === "blocked": what the task is waiting for. */
  blocker?: string;
}

export interface TodoPhase {
  name: string;
  tasks: TodoItem[];
}

const STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "in_progress",
  "completed",
  "abandoned",
  "blocked",
]);

function normalizeItem(value: unknown): TodoItem | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.content !== "string" || !STATUSES.has(String(raw.status))) return null;
  const item: TodoItem = { content: raw.content, status: raw.status as TodoStatus };
  if (typeof raw.blocker === "string" && raw.blocker) item.blocker = raw.blocker;
  return item;
}

/** Tolerant TodoPhase[] normalization: junk entries are dropped, junk shapes → []. */
export function normalizeTodoPhases(value: unknown): TodoPhase[] {
  if (!Array.isArray(value)) return [];
  const phases: TodoPhase[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.name !== "string" || !Array.isArray(raw.tasks)) continue;
    const tasks = raw.tasks.map(normalizeItem).filter((item): item is TodoItem => item !== null);
    // A genuinely empty tasks array is meaningful (dropped everything), but a
    // phase whose every task entry was invalid is junk — don't render a bare
    // heading for it.
    if (raw.tasks.length > 0 && tasks.length === 0) continue;
    phases.push({ name: raw.name, tasks });
  }
  return phases;
}

/** Completed-vs-total across all phases (abandoned/blocked are not "done"). */
export function todoProgress(phases: TodoPhase[]): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const phase of phases) {
    for (const task of phase.tasks) {
      total += 1;
      if (task.status === "completed") done += 1;
    }
  }
  return { done, total };
}
