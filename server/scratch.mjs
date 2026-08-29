/**
 * Oversized-prompt offload for the bridge: huge pasted content is written to
 * a scratch file instead of inlining it into the session context, and the
 * prompt carries a file reference + preview instead.
 */
import fsp from "node:fs/promises";
import path from "node:path";

/** Scratch directory inside the agent cwd (agent-owned `.omp` namespace). */
export function scratchDir(cwd) {
  return path.join(cwd, ".omp", "scratch");
}

/**
 * Write `text` to `<cwd>/.omp/scratch/omp-web-<ts>-<rand>.md` and return the
 * absolute path plus the file name used in the prompt reference. The random
 * suffix keeps same-millisecond writes from overwriting each other.
 */
export async function writeScratchFile(cwd, text) {
  if (typeof text !== "string") throw Object.assign(new Error("scratch body must be a string"), { status: 400 });
  const dir = scratchDir(cwd);
  await fsp.mkdir(dir, { recursive: true });
  const file = `omp-web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.md`;
  const fullPath = path.join(dir, file);
  await fsp.writeFile(fullPath, text, "utf8");
  return { path: fullPath, file, bytes: Buffer.byteLength(text, "utf8") };
}
