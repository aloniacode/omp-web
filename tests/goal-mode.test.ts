import { describe, expect, it } from "vitest";
import { buildGoalKickoff, buildGoalOpPrompt, stripGoalContract } from "../src/lib/goalMode";

describe("buildGoalKickoff", () => {
  it("carries the objective verbatim and requests a goal-tool create", () => {
    const prompt = buildGoalKickoff("Refactor the auth module to use the new SDK");
    expect(prompt).toContain("Objective: Refactor the auth module to use the new SDK");
    expect(prompt).toContain('op="create"');
  });

  it("tells the agent to report an existing goal instead of creating a second one", () => {
    expect(buildGoalKickoff("anything")).toContain("do not create another one");
  });

  it("is recoverable via stripGoalContract", () => {
    const visible = stripGoalContract(buildGoalKickoff("Refactor the auth module"));
    expect(visible).toBe("Objective: Refactor the auth module");
  });
});

describe("buildGoalOpPrompt", () => {
  it("maps each lifecycle op to the matching goal-tool op", () => {
    for (const op of ["complete", "resume", "drop"] as const) {
      expect(buildGoalOpPrompt(op)).toContain(`op="${op}"`);
    }
  });

  it("describes drop as abandoning the objective", () => {
    expect(buildGoalOpPrompt("drop")).toContain("abandon");
  });

  it("is recoverable via stripGoalContract", () => {
    expect(stripGoalContract(buildGoalOpPrompt("resume"))).not.toContain("Goal mode");
  });
});
