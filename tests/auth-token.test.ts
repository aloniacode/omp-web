import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBridgeToken, verifyToken } from "../server/auth-token.mjs";

describe("resolveBridgeToken", () => {
  it("uses OMP_WEB_TOKEN when set", () => {
    expect(resolveBridgeToken({ OMP_WEB_TOKEN: "secret" })).toEqual({ token: "secret", source: "env" });
  });

  it("disables auth for OMP_WEB_TOKEN off/none/0/false", () => {
    for (const value of ["off", "NONE", "0", "false"]) {
      expect(resolveBridgeToken({ OMP_WEB_TOKEN: value })).toEqual({ token: null, source: "disabled" });
    }
  });

  it("reuses the persisted token file when no env override exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-token-"));
    const file = path.join(dir, "web-bridge-token");
    fs.writeFileSync(file, "persisted-token\n");
    try {
      expect(resolveBridgeToken({}, file)).toEqual({ token: "persisted-token", source: "file" });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("mints and persists a fresh token when none exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-token-"));
    const file = path.join(dir, "nested", "web-bridge-token");
    try {
      const first = resolveBridgeToken({}, file);
      expect(first.token).toBeTruthy();
      expect(first.source).toBe("file");
      expect(fs.readFileSync(file, "utf8").trim()).toBe(first.token);
      // Second resolution reuses it instead of rotating.
      expect(resolveBridgeToken({}, file).token).toBe(first.token);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("verifyToken", () => {
  it("accepts the exact token", () => {
    expect(verifyToken("secret", "secret")).toBe(true);
  });

  it("rejects wrong, empty, and missing tokens", () => {
    expect(verifyToken("wrong", "secret")).toBe(false);
    expect(verifyToken("", "secret")).toBe(false);
    expect(verifyToken(undefined, "secret")).toBe(false);
    expect(verifyToken(null, "secret")).toBe(false);
  });

  it("allows everything only when auth is disabled (null expected)", () => {
    expect(verifyToken(undefined, null)).toBe(true);
    expect(verifyToken("anything", null)).toBe(true);
  });
});
