/**
 * Git branch helpers for the bridge's /api/branches endpoints.
 *
 * The bridge is a transport layer, so this stays a thin, validated wrapper
 * around the git CLI (execFile, no shell): list local branches, resolve the
 * current branch, and create/checkout branches in the agent working directory.
 */
import { execFile } from "node:child_process";

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const detail = String(stderr ?? "").trim().split("\n").pop() ?? err.message;
        reject(Object.assign(new Error(detail || err.message), { status: 400 }));
        return;
      }
      resolve(String(stdout));
    });
  });
}

/**
 * Validate a user-supplied branch name (git check-ref-format subset).
 * Returns an error message, or null when the name is acceptable.
 */
export function validateBranchName(name) {
  if (!name || name !== name.trim()) return "branch name has leading/trailing whitespace";
  if (name.length > 200) return "branch name too long";
  if (name.startsWith("-") || name.startsWith("/") || name.startsWith(".")) {
    return "branch name may not start with '-', '/' or '.'";
  }
  if (/\s/.test(name)) return "branch name may not contain whitespace";
  if (/[\x00-\x1f\x7f]/.test(name)) return "branch name may not contain control characters";
  if (/[~^:?*[\]\\]/.test(name)) return "branch name may not contain ~ ^ : ? * [ \\ characters";
  if (name.includes("..") || name.includes("//") || name.includes("@{")) return "branch name contains an invalid sequence";
  if (name.endsWith("/") || name.endsWith(".")) return "branch name may not end with '/' or '.'";
  if (name === "HEAD" || name.split("/").some((part) => part.endsWith(".lock"))) {
    return "branch name uses a reserved name";
  }
  // Over-strict by design: git accepts a branch literally named "a/@", but
  // nothing legitimate loses out by rejecting it.
  if (name === "@" || /(^|\/)@\/?$/.test(name)) return "'@' is not a valid branch name";
  return null;
}

/** Current branch from `git rev-parse --abbrev-ref HEAD` ("HEAD" when detached). */
export function parseCurrentBranch(stdout) {
  const name = stdout.trim();
  return name && name !== "HEAD" ? name : null;
}

/** Lines of `git branch --format=%(refname:short)` → branch names. */
export function parseBranchList(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** Local branches of the repo at cwd. repo=false when cwd is not a work tree. */
export async function listBranches(cwd) {
  try {
    await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
  } catch {
    return { repo: false, current: null, branches: [] };
  }
  // symbolic-ref (not rev-parse) so an unborn branch (fresh `git init`) still
  // resolves; detached HEAD fails it and simply reports null current.
  const [currentOut, listOut] = await Promise.all([
    runGit(cwd, ["symbolic-ref", "--short", "HEAD"]).catch(() => ""),
    runGit(cwd, ["branch", "--format=%(refname:short)"]),
  ]);
  const current = parseCurrentBranch(currentOut);
  const branches = parseBranchList(listOut).map((name) => ({ name, current: name === current }));
  return { repo: true, current, branches };
}

/** Checkout an existing branch, or create + checkout when `create` is set. */
export async function checkoutBranch(cwd, name, create) {
  const invalid = validateBranchName(name);
  if (invalid) throw Object.assign(new Error(invalid), { status: 400 });
  await runGit(cwd, create ? ["checkout", "-b", name] : ["checkout", name]);
  return { ok: true, current: name, created: create === true };
}
