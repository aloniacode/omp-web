/**
 * TUI-style quick commands the composer intercepts before sending anything to
 * the agent. Extracted as a pure parser so the surface is unit-testable.
 */
export const LOCAL_SLASH_COMMANDS = ["compact", "new", "export", "stop", "name", "plan", "goal", "handoff"] as const;

const SLASH_RE = new RegExp(`^\\/(${LOCAL_SLASH_COMMANDS.join("|")})(?:\\s+([\\s\\S]*))?$`);

/** `/name value` → { name: "name", arg: "value" }; `/name  ` → arg "" ; unknown → null. */
export function parseLocalSlashCommand(text: string): { name: string; arg: string } | null {
  const match = text.match(SLASH_RE);
  if (!match) return null;
  return { name: match[1], arg: (match[2] ?? "").trim() };
}
