/**
 * Goal mode (mirror of oh-my-pi's `/goal` semantics: a persistent autonomous
 * objective for the session, tracked by the agent's `goal` tool and reported
 * to hosts via `goal_updated` events). The RPC protocol exposes no goal
 * commands, so the UI drives setup and lifecycle ops through prompt-mediated
 * goal-tool operations — the same "normal conversation" design omp's
 * `/guided-goal` uses — while goal state itself arrives on native events.
 */

export type GoalOp = "complete" | "resume" | "drop";

/** i18n keys for each goal status, shared by the banner and the composer. */
export const GOAL_STATUS_KEYS = {
  active: "goal.status.active",
  paused: "goal.status.paused",
  "budget-limited": "goal.status.budget-limited",
  complete: "goal.status.complete",
  dropped: "goal.status.dropped",
} as const;

const GOAL_HEADER = "[Goal mode — prompt composed by the UI.]";
const GOAL_SEPARATOR = "\n---\n\n";

/**
 * Recover the user's original text from a goal prompt composed by the UI
 * (kickoff / op), same convention as the plan-mode contract.
 */
export function stripGoalContract(text: string): string {
  if (!text.startsWith(GOAL_HEADER)) return text;
  const idx = text.indexOf(GOAL_SEPARATOR);
  return idx === -1 ? text : text.slice(idx + GOAL_SEPARATOR.length);
}

/**
 * Kickoff prompt for `/goal <objective>`: the agent sets up the goal record.
 * Note: goal state is not replayed when a host re-attaches to a session, so
 * the prompt tells the agent to report an existing goal instead of creating
 * a second one.
 */
export function buildGoalKickoff(objective: string): string {
  return [
    GOAL_HEADER,
    "",
    "Set up goal mode for this session with the objective below: use the goal tool with",
    'op="create" and keep the objective text verbatim. If the objective is rough or',
    "ambiguous, first interview me briefly (at most a few questions), then create the",
    "goal. If a goal already exists for this session, do not create another one —",
    "report its current status instead. Once the goal exists, start working toward it",
    "and keep going across turns until it is complete.",
    "",
    "---",
    "",
    `Objective: ${objective}`,
  ].join("\n");
}

/**
 * Prompt for a goal lifecycle action (complete / resume / drop): the agent
 * executes the matching goal-tool op and reports the resulting status.
 */
export function buildGoalOpPrompt(op: GoalOp): string {
  const intent =
    op === "drop"
      ? "abandon the objective and remove the goal"
      : op === "resume"
        ? "resume the goal and continue working toward it"
        : "mark the goal as complete";
  return [
    GOAL_HEADER,
    "",
    `Operate on the current goal with the goal tool: call it with op="${op}" to ${intent}.`,
    "Confirm the resulting goal status in one short sentence.",
    "",
    "---",
    "",
    op === "drop" ? "Drop the current goal." : op === "resume" ? "Resume the current goal." : "Complete the current goal.",
  ].join("\n");
}
