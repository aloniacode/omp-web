/**
 * Session metadata parsing for `~/.omp/agent/sessions/<encoded-cwd>/*.jsonl`.
 * Pure helpers (no I/O) are exported for testing; see docs/session.md.
 */
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";

export function sanitizeText(text) {
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function userTextFromContent(content) {
  if (typeof content === "string") return sanitizeText(content);
  if (Array.isArray(content)) {
    for (const block of content) {
      if (block && block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        return sanitizeText(block.text);
      }
    }
  }
  return "";
}

/**
 * Parse a session JSONL prefix (4 KiB is enough: fixed-width title slot +
 * header + earliest entries). Returns lightweight metadata or null.
 */
export function parseSessionPrefix(filePath, buf, stat) {
  const text = buf.toString("utf8");
  const lines = text.split("\n");
  if (lines.length > 1) lines.pop(); // drop trailing partial line

  let header = null;
  let slotTitle = null;
  let preview = "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!entry || typeof entry !== "object") continue;

    if (entry.type === "title") {
      if (typeof entry.title === "string" && entry.title.trim()) slotTitle = entry.title.trim();
      continue;
    }
    if (entry.type === "session" && !header) {
      header = {
        id: typeof entry.id === "string" ? entry.id : path.basename(filePath, ".jsonl"),
        timestamp: entry.timestamp ?? null,
        cwd: typeof entry.cwd === "string" ? entry.cwd : null,
        title: typeof entry.title === "string" ? entry.title.trim() : "",
        titleSource: entry.titleSource ?? null,
      };
    }
    if (!preview && entry.type === "message" && entry.message?.role === "user") {
      const first = userTextFromContent(entry.message.content);
      if (first) preview = first.slice(0, 140);
    }
    if (header && preview) break;
  }

  const title = slotTitle ?? header?.title ?? "";
  return {
    path: filePath,
    id: header?.id ?? path.basename(filePath, ".jsonl"),
    cwd: header?.cwd ?? null,
    title: title || preview || null,
    preview,
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    startedAt: header?.timestamp ?? null,
  };
}

/**
 * Encoded-cwd bucket names per omp's session layout:
 * `--<encoded-absolute>--` where every `\`, `/` and `:` becomes `-`,
 * or `-<relative>` for directories under the home directory.
 */
export function bucketNamesForCwd(cwd, homeDir = os.homedir()) {
  const names = new Set();
  const absolute = "--" + [...cwd].map((c) => (/[\\/:]/.test(c) ? "-" : c)).join("") + "--";
  names.add(absolute);
  const rel = path.relative(homeDir, cwd);
  if (rel && !rel.startsWith("..")) {
    names.add("-" + [...rel].map((c) => (/[\\/:]/.test(c) ? "-" : c)).join(""));
  }
  return names;
}
