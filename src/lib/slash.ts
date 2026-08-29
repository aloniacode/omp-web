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

// ── Unified "/" command palette ─────────────────────────────────────────────

export interface CommandItem {
  /** Slash name (without leading "/"). */
  name: string;
  description: string;
  group: "commands" | "skills";
  /** exec: run immediately on pick; insert: place "/name " for the user to complete. */
  kind: "exec" | "insert";
  /** Skills only: where the skill comes from. */
  source?: string;
}

/** Local commands, in palette order. Exec = no argument required. */
export const LOCAL_COMMAND_ITEMS: ReadonlyArray<{
  name: (typeof LOCAL_SLASH_COMMANDS)[number];
  kind: "exec" | "insert";
}> = [
  { name: "plan", kind: "exec" },
  { name: "goal", kind: "insert" },
  { name: "handoff", kind: "exec" },
  { name: "compact", kind: "exec" },
  { name: "new", kind: "exec" },
  { name: "export", kind: "exec" },
  { name: "stop", kind: "exec" },
  { name: "name", kind: "insert" },
];

export interface SkillEntry {
  name: string;
  description?: string;
  source?: string;
}

/**
 * Palette items: local commands first (descriptions resolved via `describe`
 * so i18n stays in the component layer), then the session's skills. Skills
 * whose name collides with a local command are skipped — the builtin wins at
 * submit-time interception, so advertising both would shadow the skill.
 */
export function buildCommandItems(skills: SkillEntry[], describe: (name: string) => string): CommandItem[] {
  const localNames = new Set(LOCAL_COMMAND_ITEMS.map((item) => item.name));
  const items: CommandItem[] = LOCAL_COMMAND_ITEMS.map(({ name, kind }) => ({
    name,
    description: describe(name),
    group: "commands",
    kind,
  }));
  for (const skill of skills) {
    if (localNames.has(skill.name as (typeof LOCAL_COMMAND_ITEMS)[number]["name"])) continue;
    items.push({
      name: skill.name,
      description: skill.description ?? "",
      group: "skills",
      kind: "insert",
      source: skill.source,
    });
  }
  return items;
}

/** Case-insensitive substring filter on the palette item name. */
export function filterCommandItems(items: CommandItem[], query: string): CommandItem[] {
  const q = query.toLowerCase();
  if (!q) return items;
  return items.filter((item) => item.name.toLowerCase().includes(q));
}
