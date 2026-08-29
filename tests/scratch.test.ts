import { afterAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { scratchDir, writeScratchFile } from "../server/scratch.mjs";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-scratch-"));
const cwd = path.join(tmpRoot, "project");
fs.mkdirSync(cwd, { recursive: true });

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe("scratchDir", () => {
  it("lives under the agent-owned .omp namespace of the cwd", () => {
    expect(scratchDir("/repo")).toBe(path.join("/repo", ".omp", "scratch"));
  });
});

describe("writeScratchFile", () => {
  it("writes the text and returns absolute path, file name, and byte size", async () => {
    const result = await writeScratchFile(cwd, "hello oversized world");
    expect(result.file).toMatch(/^omp-web-\d+-[a-z0-9]{6}\.md$/);
    expect(result.path).toBe(path.join(scratchDir(cwd), result.file));
    expect(result.bytes).toBe(Buffer.byteLength("hello oversized world", "utf8"));
    await expect(fsp.readFile(result.path, "utf8")).resolves.toBe("hello oversized world");
  });

  it("creates the directory on demand and rejects non-string bodies", async () => {
    expect(fs.existsSync(scratchDir(cwd))).toBe(true);
    await expect(writeScratchFile(cwd, undefined)).rejects.toMatchObject({ status: 400 });
  });
});
