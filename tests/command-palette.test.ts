import { describe, expect, it } from "vitest";
import {
  agentCommandItems,
  buildCommandItems,
  filterCommandItems,
  LOCAL_COMMAND_ITEMS,
  LOCAL_SLASH_COMMANDS,
  parseLocalSlashCommand,
  type SkillEntry,
} from "../src/lib/slash";
import type { AvailableCommand } from "../src/rpc/types";
import { messages } from "../src/i18n";

const desc = (name: string) => `desc:${name}`;

const SKILLS: SkillEntry[] = [
  { name: "review", description: "Review the diff", source: "project" },
  { name: "release-notes", description: "", source: "global" },
];

const AGENT_COMMANDS: AvailableCommand[] = [
  { name: "compact", description: "builtin compact", source: "builtin" },
  { name: "deploy", description: "Deploy the service", source: "custom" },
  { name: "mcp-search", description: "Search the web", source: "mcp_prompt" },
  { name: "review", description: "Agent-side review", source: "skill" },
  { name: "plan", description: "shadowed local", source: "extension" },
];

const makeItems = () => buildCommandItems(SKILLS, AGENT_COMMANDS, desc);

describe("buildCommandItems", () => {
  it("lists local commands, then agent commands, then skills", () => {
    const items = makeItems();
    expect(items.map((i) => i.name)).toEqual([
      "plan",
      "goal",
      "handoff",
      "compact",
      "deploy",
      "mcp-search",
      "review",
      "release-notes",
    ]);
    expect(items[4].group).toBe("agent");
    expect(items[6].group).toBe("skills");
  });

  it("marks no-arg commands as exec and arg-taking ones as insert", () => {
    const byName = new Map(makeItems().map((item) => [item.name, item]));
    expect(byName.get("plan")?.kind).toBe("exec");
    expect(byName.get("handoff")?.kind).toBe("exec");
    expect(byName.get("goal")?.kind).toBe("insert");
    expect(byName.get("review")?.kind).toBe("insert");
  });

  it("resolves local descriptions via the describe callback and keeps others", () => {
    const byName = new Map(makeItems().map((item) => [item.name, item]));
    expect(byName.get("plan")?.description).toBe("desc:plan");
    expect(byName.get("deploy")?.description).toBe("Deploy the service");
    expect(byName.get("deploy")?.source).toBe("custom");
    expect(byName.get("review")?.description).toBe("Review the diff"); // skill wins over agent's skill-sourced twin
  });
});

describe("agentCommandItems", () => {
  it("drops builtin and skill-sourced commands plus local-name collisions", () => {
    const names = agentCommandItems(AGENT_COMMANDS).map((item) => item.name);
    expect(names).toEqual(["deploy", "mcp-search"]);
  });

  it("keeps the skill group out of the agent group", () => {
    expect(agentCommandItems(AGENT_COMMANDS).every((item) => item.group === "agent")).toBe(true);
  });

  it("dedupes repeated names within one update payload", () => {
    const names = agentCommandItems([
      { name: "deploy", description: "first", source: "custom" },
      { name: "deploy", description: "second", source: "extension" },
    ]).map((item) => item.name);
    expect(names).toEqual(["deploy"]);
  });
});

describe("filterCommandItems", () => {
  it("returns everything for an empty query", () => {
    expect(filterCommandItems(makeItems(), "")).toHaveLength(makeItems().length);
  });

  it("filters case-insensitively across groups", () => {
    const names = filterCommandItems(makeItems(), "P").map((item) => item.name);
    expect(names).toContain("plan");
    expect(names).toContain("compact");
    expect(names).not.toContain("goal");
  });

  it("matches hyphenated skill and agent command names", () => {
    expect(filterCommandItems(makeItems(), "release").map((item) => item.name)).toEqual(["release-notes"]);
    expect(filterCommandItems(makeItems(), "mcp-").map((item) => item.name)).toEqual(["mcp-search"]);
  });
});

describe("parseLocalSlashCommand stays palette-consistent", () => {
  it("accepts every exec/insert command name emitted by the palette", () => {
    for (const item of makeItems().filter((i) => i.group === "commands")) {
      expect(parseLocalSlashCommand(`/${item.name}`)?.name).toBe(item.name);
    }
  });

  it("covers every local slash command — none can silently vanish from the palette", () => {
    expect(LOCAL_COMMAND_ITEMS.map((item) => item.name).sort()).toEqual([...LOCAL_SLASH_COMMANDS].sort());
  });

  it("has a cmd.* description for every command in both locales", () => {
    for (const { name } of LOCAL_COMMAND_ITEMS) {
      const key = `cmd.${name}` as keyof typeof messages.en;
      expect(typeof messages.en[key]).toBe("string");
      expect(typeof messages.zh[key]).toBe("string");
    }
  });

  it("drops skills whose names collide with local or agent commands", () => {
    const items = buildCommandItems(
      [{ name: "compact", description: "shadowed" }, { name: "deploy", description: "shadowed too" }, ...SKILLS],
      AGENT_COMMANDS,
      desc,
    );
    expect(items.filter((item) => item.name === "compact")).toHaveLength(1);
    expect(items.filter((item) => item.name === "deploy")).toHaveLength(1);
    expect(items.filter((item) => item.group === "skills").map((item) => item.name)).toEqual([
      "review",
      "release-notes",
    ]);
  });
});
