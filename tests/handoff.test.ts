import { describe, expect, it } from "vitest";
import { parseLocalSlashCommand } from "../src/lib/slash";

describe("parseLocalSlashCommand", () => {
  it("parses a handoff with focus instructions", () => {
    expect(parseLocalSlashCommand("/handoff focus on the auth migration")).toEqual({
      name: "handoff",
      arg: "focus on the auth migration",
    });
  });

  it("parses a bare handoff; whitespace-only args collapse to empty", () => {
    expect(parseLocalSlashCommand("/handoff")).toEqual({ name: "handoff", arg: "" });
    expect(parseLocalSlashCommand("/handoff   ")).toEqual({ name: "handoff", arg: "" });
  });

  it("does not intercept unknown or prefixed commands", () => {
    expect(parseLocalSlashCommand("/handoffx")).toBeNull();
    expect(parseLocalSlashCommand("/unknown")).toBeNull();
    expect(parseLocalSlashCommand("handoff")).toBeNull();
  });

  it("keeps interior whitespace of multi-word arguments", () => {
    expect(parseLocalSlashCommand("/name   my  session ")).toEqual({ name: "name", arg: "my  session" });
  });
});
