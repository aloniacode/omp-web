/**
 * Directory browsing for the project picker: an arbitrary directory listing
 * (directories/symlinks only) and top-level roots (Windows drives, home).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function fsRoots() {
  const entries = [];
  if (process.platform === "win32") {
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      try {
        await fsp.access(drive);
        entries.push({ name: drive, path: drive });
      } catch {}
    }
  } else {
    for (const dir of [os.homedir(), "/"]) {
      try {
        const stat = await fsp.stat(dir);
        if (stat.isDirectory()) entries.push({ name: dir, path: dir });
      } catch {}
    }
  }
  return { path: "", parent: null, entries };
}

/** Listing for one directory; throws a 400-status error when unusable. */
export async function browseDir(requested) {
  const dir = path.resolve(requested);
  let stat;
  try {
    stat = await fsp.stat(dir);
  } catch {
    throw Object.assign(new Error(`directory not found: ${dir}`), { status: 400 });
  }
  if (!stat.isDirectory()) throw Object.assign(new Error(`not a directory: ${dir}`), { status: 400 });
  const entries = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() || entry.isSymbolicLink()) {
      entries.push({ name: entry.name, path: path.join(dir, entry.name) });
    }
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const parent = path.dirname(dir);
  return {
    path: dir,
    parent: parent === dir ? null : parent,
    entries,
  };
}

/** Locate an executable on PATH (used to detect the omp binary). */
export function whichExecutable(bin) {
  // An explicit path (OMP_BIN=C:\tools\omp.exe) bypasses the PATH scan.
  if (bin.includes("/") || bin.includes("\\")) {
    const candidates = [];
    if (process.platform === "win32" && !path.extname(bin)) {
      // CreateProcess would append .exe; the probe must agree or it would
      // report a launchable binary as missing.
      candidates.push(bin + ".exe");
    }
    candidates.push(bin);
    for (const candidate of candidates) {
      try {
        if (!fs.statSync(candidate).isFile()) continue; // directories pass X_OK on posix
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {}
    }
    return null;
  }
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
