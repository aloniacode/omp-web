import { describe, expect, it } from "vitest";
import { buildExecutePrompt, extractPlan, stripPlanContract, wrapPlanPrompt } from "../src/lib/planMode";

describe("extractPlan", () => {
  it("returns null for empty or plan-less text", () => {
    expect(extractPlan(null)).toBeNull();
    expect(extractPlan("")).toBeNull();
    expect(extractPlan("just prose, no plan")).toBeNull();
    // Empty plan block is not a plan.
    expect(extractPlan("```plan\n```")).toBeNull();
  });

  it("extracts the body of a tagged plan block", () => {
    const text = 'intro\n```plan\nGoal: add RPC types\nSteps: mirror wire fields\n```\ntrailing';
    expect(extractPlan(text)).toBe("Goal: add RPC types\nSteps: mirror wire fields");
  });

  it("is case-insensitive on the fence tag and tolerates trailing spaces", () => {
    const text = "```PLAN  \nsteps here\n```";
    expect(extractPlan(text)).toBe("steps here");
  });

  it("uses the last plan block when several are present", () => {
    const text = "```plan\nfirst\n```\nmid\n```plan\nsecond\n```";
    expect(extractPlan(text)).toBe("second");
  });

  it("ignores untagged code fences", () => {
    const text = "```\nnot a plan\n```";
    expect(extractPlan(text)).toBeNull();
  });

  it("keeps nested code fences inside a longer plan fence", () => {
    const text = "````plan\nSteps:\n\n```ts\nconst a = 1;\n```\n\nDone\n````";
    expect(extractPlan(text)).toBe("Steps:\n\n```ts\nconst a = 1;\n```\n\nDone");
  });

  it("closes only on a backtick-only fence line (info strings do not close)", () => {
    const text = "```plan\nSteps:\n```ts\nconst a = 1;\n```\ntrailer";
    expect(extractPlan(text)).toBe("Steps:\n```ts\nconst a = 1;");
  });

  it("falls back to the remainder when the closing fence is missing", () => {
    const text = "intro\n```plan\nGoal: ship it";
    expect(extractPlan(text)).toBe("Goal: ship it");
  });
});

describe("stripPlanContract", () => {
  it("recovers the original prompt from a wrapped wire text", () => {
    const original = "fix the failing tests";
    expect(stripPlanContract(wrapPlanPrompt(original))).toBe(original);
  });

  it("leaves ordinary prompts untouched", () => {
    expect(stripPlanContract("hello agent")).toBe("hello agent");
  });
});

describe("wrapPlanPrompt", () => {
  it("keeps the user request intact and instructs plan-only behavior", () => {
    const wrapped = wrapPlanPrompt("fix the failing tests");
    expect(wrapped.endsWith("fix the failing tests")).toBe(true);
    expect(wrapped).toContain("do not change anything");
    expect(wrapped).toContain("```plan");
  });
});

describe("buildExecutePrompt", () => {
  it("embeds the approved plan in a plan block", () => {
    const prompt = buildExecutePrompt("Step 1: do it");
    expect(prompt).toContain("approved");
    expect(prompt).toContain("```plan\nStep 1: do it\n```");
  });
});
