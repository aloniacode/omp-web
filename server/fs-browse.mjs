/**
 * Directory browsing for the project picker: an arbitrary directory listing
 * (directories/symlinks only) and top-level roots (Windows drives, home).
 */
import fs from "node:fs";
import path from "node:path";

/** Locate an executable on PATH (used to detect the omp binary). */
export function whichExecutable(bin) {
  const exts = process.platform === "win32" ? (process.env.PATHEXT ?? ".exe").split(";") : [""];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, bin.endsWith(".exe") ? bin : bin + ext);
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
  }
  return null;
}
