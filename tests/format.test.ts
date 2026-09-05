import { describe, expect, it } from "vitest";
import { fmtCost, fmtPercent, fmtTokPerSec, fmtTokens, relTime, stderrTailSummary, toolArgsSummary, truncate, userText } from "../src/lib/format";

describe("fmtTokens", () => {
  it("formats small numbers raw", () => {
    expect(fmtTokens(0)).toBe("0");
    expect(fmtTokens(999)).toBe("999");
  });
  it("abbreviates thousands and millions", () => {
    expect(fmtTokens(1000)).toBe("1.0k");
    expect(fmtTokens(12_340)).toBe("12.3k");
    expect(fmtTokens(2_000_000)).toBe("2.00M");
    expect(fmtTokens(50_000_000)).toBe("50M");
  });
  it("handles missing values", () => {
    expect(fmtTokens(undefined)).toBe("0");
    expect(fmtTokens(null)).toBe("0");
  });
});

describe("fmtCost", () => {
  it("scales precision with magnitude", () => {
    expect(fmtCost(0)).toBe("$0");
    expect(fmtCost(0.00421)).toBe("$0.0042");
    expect(fmtCost(0.5)).toBe("$0.500");
    expect(fmtCost(12.345)).toBe("$12.35");
    expect(fmtCost(150)).toBe("$150");
  });
});

describe("fmtPercent", () => {
  it("formats one decimal", () => {
    expect(fmtPercent(17.24)).toBe("17.2%");
  });
  it("renders dashes for unknown", () => {
    expect(fmtPercent(null)).toBe("—");
  });
});

describe("fmtTokPerSec", () => {
  it("computes tokens per second from duration ms", () => {
    expect(fmtTokPerSec(300, 10_000)).toBe("30.0 tok/s");
    expect(fmtTokPerSec(1200, 2000)).toBe("600 tok/s");
  });
  it("returns null without duration", () => {
    expect(fmtTokPerSec(100, undefined)).toBeNull();
    expect(fmtTokPerSec(100, 0)).toBeNull();
  });
});

describe("truncate", () => {
  it("preserves short strings", () => {
    expect(truncate("abc", 5)).toBe("abc");
  });
  it("appends ellipsis past the budget", () => {
    const out = truncate("abcdefg", 6);
    expect(out).toBe("abcde…");
  });
  it("appends ellipsis within the budget", () => {
    const out = truncate("abcdef", 6);
    expect(out.startsWith("abcdef")).toBe(true);
  });
});

describe("userText", () => {
  it("passes through plain strings", () => {
    expect(userText("hello")).toBe("hello");
  });
  it("joins text blocks only", () => {
    expect(
      userText([
        { type: "text", text: "a" },
        { type: "image", data: "x", mimeType: "image/png" },
        { type: "text", text: "b" },
      ]),
    ).toBe("a\nb");
  });
  it("handles undefined content", () => {
    expect(userText(undefined)).toBe("");
  });
});
describe("toolArgsSummary", () => {
  it("prefers well-known keys in order", () => {
    expect(toolArgsSummary({ path: "/x/y", command: "ls" })).toBe("ls");  // path ranks first
  });
  it("falls back to the first string value", () => {
    expect(toolArgsSummary({ foo: "bar" })).toBe("bar");
  });
  it("returns empty for empty args", () => {
    expect(toolArgsSummary({})).toBe("");
    expect(toolArgsSummary(undefined)).toBe("");
  });
});
describe("stderrTailSummary", () => {
  it("suffixes the last non-empty chunks with a leading newline", () => {
    expect(stderrTailSummary(["noise", "", "Error: boom", "  at x"])).toBe("\nnoise\nError: boom\n  at x");
  });

  it("tolerates junk, caps count and per-chunk length", () => {
    const long = "a".repeat(300);
    expect(stderrTailSummary(undefined)).toBe("");
    expect(stderrTailSummary([42, null, long])).toBe(`\n${"a".repeat(200)}…`);
    expect(stderrTailSummary(["1", "2", "3", "4", "5"])).toBe("\n2\n3\n4\n5");
  });

  it("returns empty for whitespace-only chunks", () => {
    expect(stderrTailSummary(["  ", "\n"])).toBe("");
  });
});
describe("relTime", () => {
  const now = Date.now();
  const zh = {
    justNow: "刚刚",
    minutesAgo: "{n} 分钟前",
    hoursAgo: "{h} 小时前",
    daysAgo: "{d} 天前",
  };
  it("interpolates every unit placeholder, not just {n}", () => {
    expect(relTime(now - 30_000, zh)).toBe("刚刚");
    expect(relTime(now - 5 * 60_000, zh)).toBe("5 分钟前");
    expect(relTime(now - 3 * 3_600_000, zh)).toBe("3 小时前");
    expect(relTime(now - 2 * 86_400_000, zh)).toBe("2 天前");
  });
  it("defaults to english templates", () => {
    expect(relTime(now - 90_000)).toBe("1m ago");
    expect(relTime(now - 5 * 3_600_000)).toBe("5h ago");
    expect(relTime(now - 6 * 86_400_000)).toBe("6d ago");
  });
  it("falls back to a date beyond a week", () => {
    const old = new Date(2026, 0, 15, 12, 0).getTime();
    expect(relTime(old, zh)).toBe(new Date(old).toLocaleDateString());
  });
});
