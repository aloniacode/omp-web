/**
 * Oversized-prompt handling: prompts above a character threshold are written
 * to a bridge-managed scratch file (`<cwd>/.omp/scratch/…`) and the prompt
 * on the wire becomes a compact file reference + preview. Inlining hundreds
 * of kilobytes into the session context bloats every later turn; the file
 * reference lets the agent read the full text on demand.
 */

/** Offload threshold in characters (~12–24k tokens of context). */
export const OVERSIZE_PROMPT_CHARS = 48_000;

/** Preview length kept inline alongside the file reference. */
export const OVERSIZE_PREVIEW_CHARS = 800;

/** Also cap live tool-run output held in memory; the card offers a truncated view. */
export const MAX_TOOL_OUTPUT_CHARS = 262_144;

const OVERSIZE_HEADER = "[The full text of this request was too large to inline and has been saved to a file.]";
const OVERSIZE_SEPARATOR = "\n---\n\n";

export function isOversizePrompt(text: string): boolean {
  return text.length > OVERSIZE_PROMPT_CHARS;
}

/**
 * Recover the compact bubble from an oversize wire prompt, mirroring the
 * plan/goal contracts: committed history shows the preview, not the wire
 * header with its machine path.
 */
export function stripOversizeContract(text: string): string {
  if (!text.startsWith(OVERSIZE_HEADER)) return text;
  const idx = text.indexOf(OVERSIZE_SEPARATOR);
  return idx === -1 ? text : text.slice(idx + OVERSIZE_SEPARATOR.length);
}

/**
 * The prompt sent on the wire: instructions to read the scratch file, then a
 * preview of the original request so the agent can still see what it is being
 * asked. Every oversize prompt far exceeds the preview length, so the marker
 * is always appended.
 */
export function buildOversizePrompt(original: string, scratchPath: string): string {
  return [
    OVERSIZE_HEADER,
    "",
    `Full content: ${scratchPath}`,
    "Read that file first — it contains the complete, authoritative request text.",
    "",
    "---",
    "",
    `${original.slice(0, OVERSIZE_PREVIEW_CHARS)}\n…[preview truncated; full text in the file above]`,
  ].join("\n");
}

/** The compact bubble shown in the transcript instead of the huge payload. */
export function buildOversizeBubble(original: string, scratchFile: string): string {
  return [
    `[Attached oversized content — ${original.length.toLocaleString()} chars saved to .omp/scratch/${scratchFile}]`,
    original.slice(0, OVERSIZE_PREVIEW_CHARS) +
      (original.length > OVERSIZE_PREVIEW_CHARS ? "\n…[truncated preview]" : ""),
  ].join("\n");
}

/** Memory cap for live tool-run output held in the store. */
export function truncateToolOutput(text: string): string {
  return text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…[truncated]` : text;
}
