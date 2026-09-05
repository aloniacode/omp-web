/**
 * Session transcript store: listing and deletion over
 * ~/.omp/agent/sessions/<encoded-cwd>/<ts>_<id>.jsonl files.
 */
import fsp from "node:fs/promises";
import path from "node:path";
import { parseSessionPrefix, bucketNamesForCwd } from "./session-meta.mjs";

export async function listSessions(sessionsDir, { cwd, limit = 50, scope = "all" } = {}) {
  const bucketScope = cwd ? bucketNamesForCwd(cwd) : new Set();
  let buckets;
  try {
    buckets = await fsp.readdir(sessionsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates = [];
  for (const dirent of buckets) {
    if (!dirent.isDirectory()) continue;
    if (scope !== "all" && !bucketScope.has(dirent.name)) continue;
    let files;
    try {
      files = await fsp.readdir(path.join(sessionsDir, dirent.name));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      candidates.push(path.join(sessionsDir, dirent.name, file));
    }
  }

  const withStats = await Promise.all(
    candidates.map(async (p) => {
      try {
        return { p, stat: await fsp.stat(p) };
      } catch {
        return null;
      }
    }),
  );
  withStats.sort((a, b) => (b?.stat.mtimeMs ?? 0) - (a?.stat.mtimeMs ?? 0));

  const out = [];
  for (const { p, stat } of withStats) {
    if (out.length >= limit) break;
    if (!stat) continue;
    try {
      const handle = await fsp.open(p, "r");
      try {
        const { buffer, bytesRead } = await handle.read(Buffer.alloc(4096), 0, 4096, 0);
        const parsed = parseSessionPrefix(p, buffer.subarray(0, bytesRead), stat);
        if (parsed) out.push(parsed);
      } finally {
        await handle.close();
      }
    } catch {
      // unreadable file — skip
    }
  }
  return out;
}

export async function deleteSessionFile(sessionsDir, requestedPath) {
  const resolved = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(sessionsDir);
  if (!resolved.startsWith(resolvedRoot + path.sep) || !resolved.endsWith(".jsonl")) {
    throw Object.assign(new Error("path outside sessions directory"), { status: 400 });
  }
  await fsp.unlink(resolved);
  return { deleted: resolved };
}

/** Refuse transcripts beyond this size — a session file that large would be
 *  unusable in the UI anyway and only serves as a DoS lever. */
const MAX_TRANSCRIPT_BYTES = 128 * 1024 * 1024;

/**
 * Read a session's messages straight from its .jsonl file — the same records
 * the agent's `get_messages` serves, without waiting on the agent. Lets the
 * web UI render a conversation instantly while `switch_session` catches up
 * in the background (the TUI equivalent: resume reads the session file).
 */
export async function readSessionTranscript(sessionsDir, requestedPath) {
  const resolved = path.resolve(requestedPath);
  const resolvedRoot = path.resolve(sessionsDir);
  if (!resolved.startsWith(resolvedRoot + path.sep) || !resolved.endsWith(".jsonl")) {
    throw Object.assign(new Error("path outside sessions directory"), { status: 400 });
  }
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat || !stat.isFile()) throw Object.assign(new Error("session file not found"), { status: 404 });
  if (stat.size > MAX_TRANSCRIPT_BYTES) {
    throw Object.assign(new Error("session transcript too large"), { status: 413 });
  }
  const content = await fsp.readFile(resolved, "utf8");
  const messages = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("{")) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // truncated/partial trailing line — skip
    }
    if (entry?.type === "message" && entry.message && typeof entry.message.role === "string") {
      messages.push(entry.message);
    }
  }
  return messages;
}
