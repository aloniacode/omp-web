/**
 * Plan mode (mirror of oh-my-pi's `/plan` semantics: the agent researches and
 * plans before executing; the host reviews the plan, then approves it for
 * implementation). The RPC protocol exposes no plan toggle, so the UI drives
 * the same workflow through a planning contract prompt and a review step.
 */

/** Fenced block tag the plan contract asks the agent to emit its plan in. */
export const PLAN_FENCE = "plan";

const CONTRACT_HEADER = "[Plan mode is active — plan only, do not change anything yet.]";
const CONTRACT_SEPARATOR = "\n---\n\n";

/**
 * Recover the user's original prompt from a plan-contract wrapped wire text.
 * Applied to committed transcript user messages so the visible history keeps
 * the user's wording instead of the wrapping contract.
 */
export function stripPlanContract(text: string): string {
  if (!text.startsWith(CONTRACT_HEADER)) return text;
  const idx = text.indexOf(CONTRACT_SEPARATOR);
  return idx === -1 ? text : text.slice(idx + CONTRACT_SEPARATOR.length);
}

/**
 * Extract the plan body from an assistant reply: the last fenced block tagged
 * `plan`. Fence-run aware (CommonMark-style): a plan fence opened with N
 * backticks only closes on a line of at least N backticks, so nested code
 * fences inside the plan survive when the model uses a longer outer fence.
 * An unterminated plan block (truncated reply) yields its remainder.
 * Returns null when the reply carries no plan block yet.
 */
export function extractPlan(text: string | null | undefined): string | null {
  if (!text) return null;
  let last: string | null = null;
  let i = 0;
  for (;;) {
    const open = text.indexOf("```", i);
    if (open === -1) break;
    let run = 3;
    while (text[open + run] === "`") run += 1;
    const lineEnd = text.indexOf("\n", open);
    if (lineEnd === -1) break;
    const info = text.slice(open + run, lineEnd).trim().toLowerCase();
    if (info !== PLAN_FENCE) {
      i = lineEnd + 1;
      continue;
    }
    // Find the closing fence: a line made only of backticks, at least `run`.
    let close = -1;
    let closeEnd = text.length;
    let pos = lineEnd + 1;
    for (;;) {
      const nl = text.indexOf("\n", pos);
      const line = nl === -1 ? text.slice(pos) : text.slice(pos, nl);
      const trimmed = line.trim();
      if (trimmed.length >= run && /^`+$/.test(trimmed)) {
        close = pos;
        closeEnd = nl === -1 ? text.length : nl + 1;
        break;
      }
      if (nl === -1) break;
      pos = nl + 1;
    }
    const body = (close === -1 ? text.slice(lineEnd + 1) : text.slice(lineEnd + 1, close)).trim();
    if (body) last = body;
    if (close === -1) break;
    i = closeEnd;
  }
  return last;
}

/**
 * Wrap a user prompt in the plan-mode contract: read-only research, no
 * mutations, and the final plan delivered in a `plan` fenced block for review.
 */
export function wrapPlanPrompt(text: string): string {
  return [
    CONTRACT_HEADER,
    "",
    "Research the request with read-only exploration, then produce an implementation plan.",
    "Do not create, modify, or delete files, and do not run state-changing commands.",
    "",
    "End your reply with the complete plan in a fenced block tagged `plan`, for example:",
    "",
    "```" + PLAN_FENCE,
    "Goal: …",
    "Steps: …",
    "Files to touch: …",
    "Risks / open questions: …",
    "```",
    "",
    "---",
    "",
    text,
  ].join("\n");
}

/** Prompt sent when the user approves a reviewed plan: leave planning, implement. */
export function buildExecutePrompt(plan: string): string {
  return [
    "The plan below has been reviewed and approved. Exit planning and implement it now,",
    "following the steps in order. If you hit a blocker, stop and explain instead of",
    "silently deviating from the plan.",
    "",
    "```" + PLAN_FENCE,
    plan,
    "```",
  ].join("\n");
}
