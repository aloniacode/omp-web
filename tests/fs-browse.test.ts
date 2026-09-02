import { describe, expect, it } from "vitest";
import { whichExecutable } from "../server/fs-browse.mjs";

describe("whichExecutable", () => {
  it("resolves an absolute binary path directly, bypassing PATH", () => {
    const abs = process.platform === "win32" ? "C:/Windows/System32/cmd.exe" : "/bin/sh";
    expect(whichExecutable(abs)).toBe(abs);
    expect(whichExecutable("definitely/not/here/nothing.exe")).toBeNull();
  });

  it("appends the win32 extension to extensionless absolute paths", () => {
    if (process.platform !== "win32") return; // CreateProcess-only behavior
    expect(whichExecutable("C:/Windows/System32/cmd")).toBe("C:/Windows/System32/cmd.exe");
  });

  it("rejects directories that would otherwise pass X_OK", () => {
    expect(whichExecutable("C:/Windows/System32")).toBeNull();
  });

  it("resolves a bare name from PATH", () => {
    const name = process.platform === "win32" ? "cmd" : "sh";
    expect(whichExecutable(name)).toBeTruthy();
  });

  it("returns null for binaries that do not exist", () => {
    expect(whichExecutable("definitely-not-omp-xyz")).toBeNull();
  });
});
