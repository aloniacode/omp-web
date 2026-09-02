/**
 * TUI-style quick commands the composer intercepts before sending anything to
 * the agent. Extracted as a pure parser so the surface is unit-testable.
 */
export const LOCAL_SLASH_COMMANDS = ["compact", "plan", "goal", "handoff"] as const;

const SLASH_RE = new RegExp(`^\\/(${LOCAL_SLASH_COMMANDS.join("|")})(?:\\s+([\\s\\S]*))?$`);

/** `/handoff focus  auth` → { name: "handoff", arg: "focus  auth" }; `/handoff  ` → arg "" ; unknown → null. */
export function parseLocalSlashCommand(text: string): { name: string; arg: string } | null {
  const match = text.match(SLASH_RE);
  if (!match) return null;
  return { name: match[1], arg: (match[2] ?? "").trim() };
}

// ── Unified "/" command palette ─────────────────────────────────────────────

import type { AvailableCommand } from "../rpc/types";

export interface CommandItem {
  /** Slash name (without leading "/"). */
  name: string;
  description: string;
  group: "commands" | "agent" | "skills";
  /** exec: run immediately on pick; insert: place "/name " for the user to complete. */
  kind: "exec" | "insert";
  /** Agent/skills groups: where the command comes from. */
  source?: string;
}

/** Local commands, in palette order. Exec = runs immediately on pick. */
export const LOCAL_COMMAND_ITEMS: ReadonlyArray<{
  name: (typeof LOCAL_SLASH_COMMANDS)[number];
  kind: "exec" | "insert";
}> = [
  { name: "plan", kind: "exec" },
  { name: "goal", kind: "insert" },
  { name: "handoff", kind: "exec" },
  { name: "compact", kind: "exec" },
];

export interface SkillEntry {
  name: string;
  description?: string;
  source?: string;
}

/**
 * Agent-pushed commands (`available_commands_update`) worth listing:
 * builtin ones are either mirrored by local commands or TUI-specific, and
 * skill-sourced ones already arrive via /api/skills — everything else
 * (extensions, custom commands, mcp prompts) renders in its own group and
 * is sent as a `/name …` prompt on pick.
 */
export function agentCommandItems(commands: AvailableCommand[]): CommandItem[] {
  const items: CommandItem[] = [];
  const seen = new Set<string>();
  for (const command of commands) {
    if (command.source === "builtin" || command.source === "skill") continue;
    if (typeof command.name !== "string" || !command.name || seen.has(command.name)) continue;
    if ((LOCAL_COMMAND_ITEMS as ReadonlyArray<{ name: string }>).some((local) => local.name === command.name)) continue;
    seen.add(command.name);
    items.push({
      name: command.name,
      description: command.description ?? "",
      group: "agent",
      kind: "insert",
      source: command.source,
    });
  }
  return items;
}

/**
 * Palette items: local commands first (descriptions resolved via `describe`
 * so i18n stays in the component layer), then agent-pushed commands, then the
 * session's skills. Later groups skip names already advertised — the earlier
 * entry wins at submit-time interception, so advertising both would shadow it.
 */
export function buildCommandItems(
  skills: SkillEntry[],
  agentCommands: AvailableCommand[],
  describe: (name: string) => string,
): CommandItem[] {
  const localNames = new Set(LOCAL_COMMAND_ITEMS.map((item) => item.name));
  const items: CommandItem[] = LOCAL_COMMAND_ITEMS.map(({ name, kind }) => ({
    name,
    description: describe(name),
    group: "commands",
    kind,
  }));
  const agent = agentCommandItems(agentCommands);
  for (const item of agent) items.push(item);
  for (const skill of skills) {
    if (localNames.has(skill.name as (typeof LOCAL_COMMAND_ITEMS)[number]["name"])) continue;
    if (agent.some((item) => item.name === skill.name)) continue;
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

/**
 * Text a picked item inserts into the composer. Upstream invokes skills as
 * `/skill:<name>` (getSkillSlashCommandName / parseSkillInvocation); a bare
 * `/name` would reach the model as literal text with no SKILL.md injection.
 */
export function commandInsertToken(item: Pick<CommandItem, "name" | "group">): string {
  return item.group === "skills" ? `/skill:${item.name}` : `/${item.name}`;
}
