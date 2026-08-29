import { describe, expect, it } from "vitest";
import { buildCommandItems, filterCommandItems, LOCAL_COMMAND_ITEMS, LOCAL_SLASH_COMMANDS, parseLocalSlashCommand, type SkillEntry } from "../src/lib/slash";
import { messages } from "../src/i18n";

const desc = (name: string) => `desc:${name}`;

const SKILLS: SkillEntry[] = [
  { name: "review", description: "Review the diff", source: "project" },
  { name: "release-notes", description: "", source: "global" },
];

const makeItems = () => buildCommandItems(SKILLS, desc);

describe("buildCommandItems", () => {
  it("lists local commands first, then skills", () => {
    const items = makeItems();
    expect(items[0].group).toBe("commands");
    expect(items[items.length - 1].group).toBe("skills");
    expect(items.map((i) => i.name)).toEqual([
      "plan",
      "goal",
      "handoff",
      "compact",
      "new",
      "export",
      "stop",
      "name",
      "review",
      "release-notes",
    ]);
  });

  it("marks no-arg commands as exec and arg-taking ones as insert", () => {
    const byName = new Map(makeItems().map((item) => [item.name, item]));
    expect(byName.get("plan")?.kind).toBe("exec");
    expect(byName.get("handoff")?.kind).toBe("exec");
    expect(byName.get("goal")?.kind).toBe("insert");
    expect(byName.get("name")?.kind).toBe("insert");
    expect(byName.get("review")?.kind).toBe("insert");
  });

  it("resolves local descriptions via the describe callback and keeps skill ones", () => {
    const byName = new Map(makeItems().map((item) => [item.name, item]));
    expect(byName.get("plan")?.description).toBe("desc:plan");
    expect(byName.get("review")?.description).toBe("Review the diff");
    expect(byName.get("review")?.source).toBe("project");
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

  it("matches hyphenated skill names", () => {
    expect(filterCommandItems(makeItems(), "release").map((item) => item.name)).toEqual(["release-notes"]);
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

  it("drops skills whose names collide with local commands", () => {
    const items = buildCommandItems([{ name: "compact", description: "shadowed" }, ...SKILLS], desc);
    expect(items.filter((item) => item.name === "compact")).toHaveLength(1);
    expect(items.filter((item) => item.group === "skills").map((item) => item.name)).toEqual([
      "review",
      "release-notes",
    ]);
  });
});
