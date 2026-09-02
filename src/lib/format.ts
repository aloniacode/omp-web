/** Number/time formatting helpers for token and cost display. */
import type { AssistantMessage } from "../rpc/types";

export function fmtTokens(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n)) return "0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return String(Math.round(n));
}

export function fmtCost(usd: number | undefined | null): string {
  if (usd == null || !Number.isFinite(usd)) return "$0";
  if (usd === 0) return "$0";
  if (usd >= 100) return `$${usd.toFixed(0)}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(4)}`;
}

export function fmtPercent(p: number | undefined | null): string {
  if (p == null || !Number.isFinite(p)) return "—";
  return `${p.toFixed(1)}%`;
}

/** Output tokens per second given a request duration in ms. */
export function fmtTokPerSec(outputTokens: number | undefined, durationMs: number | undefined): string | null {
  if (!outputTokens || !durationMs || durationMs <= 0 || !Number.isFinite(durationMs)) return null;
  const tps = (outputTokens / durationMs) * 1000;
  if (!Number.isFinite(tps) || tps <= 0) return null;
  return tps >= 100 ? `${tps.toFixed(0)} tok/s` : `${tps.toFixed(1)} tok/s`;
}

export function relTime(
  ms: number,
  labels?: { justNow: string; minutesAgo: string; hoursAgo: string; daysAgo: string },
): string {
  const diff = Date.now() - ms;
  const l = labels ?? { justNow: "just now", minutesAgo: "{n}m ago", hoursAgo: "{h}h ago", daysAgo: "{d}d ago" };
  const fill = (template: string, n: number) => template.replaceAll("{n}", String(n));
  if (diff < 60_000) return l.justNow;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return fill(l.minutesAgo, minutes);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return fill(l.hoursAgo, hours);
  const days = Math.floor(hours / 24);
  if (days < 7) return fill(l.daysAgo, days);
  return new Date(ms).toLocaleDateString();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Extract plain text out of a user-message content union. */
export function userText(content: string | Array<{ type: string; text?: string }> | undefined | null): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/** Concatenated text blocks of an assistant message (tool calls/thinking skipped). */
export function assistantText(content: AssistantMessage["content"] | undefined | null): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

/**
 * Crash-diagnostic suffix for the agent_exit notice: the child's last
 * non-empty stderr chunks, each truncated, newline-prefixed when present.
 * Tolerant of anything the wire delivers.
 */
export function stderrTailSummary(stderrTail: unknown, maxChunks = 4, maxChars = 200): string {
  const lines = (Array.isArray(stderrTail) ? stderrTail : [])
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(-maxChunks)
    .map((line) => (line.length > maxChars ? `${line.slice(0, maxChars)}…` : line));
  return lines.length ? `\n${lines.join("\n")}` : "";
}

export function toolArgsSummary(args: Record<string, unknown> | undefined, max = 80): string {
  if (!args) return "";
  const preferred = ["command", "path", "file", "file_path", "pattern", "query", "url", "name", "intent", "objective"];
  for (const key of preferred) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return truncate(value.replaceAll(/\s+/g, " ").trim(), max);
    }
  }
  const firstString = Object.values(args).find((v) => typeof v === "string");
  if (typeof firstString === "string") return truncate(firstString, max);
  return "";
}
