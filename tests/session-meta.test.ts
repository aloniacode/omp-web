import { describe, expect, it } from "vitest";
import { bucketNamesForCwd, parseSessionPrefix } from "../server/session-meta.mjs";
import { FrameAssembler } from "../server/rpc-frame.mjs";

const stat = { mtimeMs: 1_700_000_000_000, size: 4096 };

function fixture(lines: string[]) {
  return Buffer.from(lines.join("\n") + "\n", "utf8");
}

describe("parseSessionPrefix", () => {
  it("parses title slot + header + first user preview", () => {
    const buf = fixture([
      JSON.stringify({ type: "title", title: "My session", source: "user" }),
      JSON.stringify({
        type: "session",
        version: 3,
        id: "abc12345",
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: "/work/proj",
        titleSource: "auto",
      }),
      JSON.stringify({
        type: "message",
        id: "m1",
        message: { role: "user", content: "Fix the failing tests\nsecond line" },
      }),
    ]);
    const meta = parseSessionPrefix("/tmp/x.jsonl", buf, stat);
    expect(meta.id).toBe("abc12345");
    expect(meta.title).toBe("My session");
    expect(meta.cwd).toBe("/work/proj");
    expect(meta.preview.startsWith("Fix the failing tests")).toBe(true);
  });

  it("falls back to header title then preview", () => {
    const buf = fixture([
      JSON.stringify({ type: "session", id: "deadbeef", cwd: "/w", title: "Header title" }),
      JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } }),
      JSON.stringify({ type: "message", message: { role: "user", content: "the real preview" } }),
    ]);
    const meta = parseSessionPrefix("/x.jsonl", buf, stat);
    expect(meta.title).toBe("Header title");
    expect(meta.preview).toBe("the real preview");
  });

  it("survives malformed lines and truncates partial trailing lines", () => {
    const full = ["{not json}", JSON.stringify({ type: "session", id: "ff" })].join("\n") + "\n";
    // simulate a cut in the middle of a following line
    const buf = Buffer.from(full + '{"type":"mess', "utf8");
    const meta = parseSessionPrefix("/y.jsonl", buf, stat);
    expect(meta?.id).toBe("ff");
  });
});

describe("bucketNamesForCwd", () => {
  it("encodes absolute windows paths with per-char separators", () => {
    expect(bucketNamesForCwd("D:\\WorkSpace\\omp-web", "C:\\Users\\u")).toContain("--D--WorkSpace-omp-web--");
  });
  it("derives home-relative buckets", () => {
    const names = bucketNamesForCwd("C:\\Users\\u\\work", "C:\\Users\\u");
    expect(names).toContain("-work");
  });
});
