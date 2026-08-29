import { describe, expect, it } from "vitest";
import { validateBranchName, parseCurrentBranch, parseBranchList } from "../server/git-branches.mjs";

describe("validateBranchName", () => {
  it("accepts ordinary branch names", () => {
    for (const name of ["main", "feature/auth-2.0", "fix/issue_12", "release.v1", "a/b/c"]) {
      expect(validateBranchName(name)).toBeNull();
    }
  });

  it("rejects empty and padded names", () => {
    expect(validateBranchName("")).not.toBeNull();
    expect(validateBranchName("  ")).not.toBeNull();
    expect(validateBranchName(" main ")).not.toBeNull();
  });

  it("rejects any whitespace, including tabs and newlines", () => {
    expect(validateBranchName("a\tb")).not.toBeNull();
    expect(validateBranchName("a\nb")).not.toBeNull();
  });

  it("rejects ref-format violations", () => {
    for (const name of [
      "-branch",
      "/branch",
      "has space",
      "tilde~1",
      "care^t",
      "col:on",
      "star*",
      "quest?ion",
      "bra[ket]",
      "back\\slash",
      "double//slash",
      "dot..dot",
      "at@{brace",
      "trailing/",
      "trailing.",
      "head.lock",
      "a.lock/b",
      ".hidden",
      "HEAD",
      "@",
      "a/@",
    ]) {
      expect(validateBranchName(name), name).not.toBeNull();
    }
  });
});

describe("parseCurrentBranch", () => {
  it("returns the branch name", () => {
    expect(parseCurrentBranch("main\n")).toBe("main");
  });

  it("maps detached HEAD to null", () => {
    expect(parseCurrentBranch("HEAD\n")).toBeNull();
    expect(parseCurrentBranch("\n")).toBeNull();
  });
});

describe("parseBranchList", () => {
  it("parses branch lines and drops empties", () => {
    expect(parseBranchList("main\nfeature/x\n\n")).toEqual(["main", "feature/x"]);
    expect(parseBranchList("")).toEqual([]);
  });
});
