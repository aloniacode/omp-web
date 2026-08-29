import { describe, expect, it } from "vitest";
import {
  buildOversizeBubble,
  buildOversizePrompt,
  isOversizePrompt,
  stripOversizeContract,
  truncateToolOutput,
  MAX_TOOL_OUTPUT_CHARS,
  OVERSIZE_PROMPT_CHARS,
} from "../src/lib/oversize";

const BIG = "x".repeat(OVERSIZE_PROMPT_CHARS + 10);

describe("isOversizePrompt", () => {
  it("flags prompts strictly above the threshold", () => {
    expect(isOversizePrompt("normal request")).toBe(false);
    expect(isOversizePrompt("x".repeat(OVERSIZE_PROMPT_CHARS))).toBe(false);
    expect(isOversizePrompt(BIG)).toBe(true);
  });
});

describe("buildOversizePrompt", () => {
  it("references the scratch file and carries a truncated preview", () => {
    const prompt = buildOversizePrompt(BIG, "/repo/.omp/scratch/omp-web-1.md");
    expect(prompt).toContain("Full content: /repo/.omp/scratch/omp-web-1.md");
    expect(prompt).toContain("Read that file first");
    expect(prompt).toContain("…[preview truncated; full text in the file above]");
    expect(prompt).not.toContain(BIG);
  });
});

describe("buildOversizeBubble", () => {
  it("shows the character count and the scratch file name", () => {
    const bubble = buildOversizeBubble(BIG, "omp-web-1.md");
    expect(bubble).toContain(`[Attached oversized content — ${BIG.length.toLocaleString()} chars saved to .omp/scratch/omp-web-1.md]`);
    expect(bubble).toContain("…[truncated preview]");
  });
});

describe("stripOversizeContract", () => {
  it("recovers the preview from a wire prompt (history keeps machine paths out)", () => {
    const wire = buildOversizePrompt(BIG, "/repo/.omp/scratch/omp-web-1.md");
    const stripped = stripOversizeContract(wire);
    expect(stripped).not.toContain("/repo/.omp/scratch");
    expect(stripped).not.toContain("[The full text of this request");
    expect(stripped).toBe(`${BIG.slice(0, 800)}\n…[preview truncated; full text in the file above]`);
  });

  it("leaves ordinary prompts untouched", () => {
    expect(stripOversizeContract("hello")).toBe("hello");
  });
});

describe("truncateToolOutput", () => {
  it("passes through outputs below the cap", () => {
    expect(truncateToolOutput("hello")).toBe("hello");
  });
  it("caps pathological outputs", () => {
    const out = truncateToolOutput("y".repeat(MAX_TOOL_OUTPUT_CHARS + 5));
    expect(out.length).toBeLessThanOrEqual(MAX_TOOL_OUTPUT_CHARS + 20);
    expect(out.endsWith("…[truncated]")).toBe(true);
  });
});
