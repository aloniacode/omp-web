/**
 * Bounded workspace file search backing the composer's @-mention popup.
 * Depth-limited directory walk, results as cwd-relative paths.
 */
import fsp from "node:fs/promises";
import path from "node:path";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "coverage",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  ".idea",
  ".vscode",
]);

export async function searchFiles(cwd, query, limit = 24) {
  const results = [];
  const needle = query.toLowerCase();
  async function walk(dir, rel, depth) {
    if (depth > 4 || results.length >= limit) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (results.length >= limit) return;
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relPath, depth + 1);
      } else if (!needle || relPath.toLowerCase().includes(needle)) {
        results.push(relPath);
      }
    }
  }
  await walk(cwd, "", 0);
  return results;
}
