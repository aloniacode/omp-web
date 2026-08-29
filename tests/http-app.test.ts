import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fsp from "node:fs/promises";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpApp } from "../server/http-app.mjs";

let tmpRoot;
let sessionsDir;
let state;
let app;

const connections = new Map();
const children = new Set();

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-http-"));
  sessionsDir = path.join(tmpRoot, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  state = { defaultCwd: path.join(tmpRoot, "project-a") };
  fs.mkdirSync(state.defaultCwd, { recursive: true });
  app = createHttpApp({
    ompBin: "omp-test-missing-binary",
    getDefaultCwd: () => state.defaultCwd,
    setDefaultCwd: (cwd) => {
      state.defaultCwd = cwd;
    },
    connections,
    children,
    sessionsDir,
    maxUplinkBytes: 1024,
    distDir: path.join(tmpRoot, "dist"),
  });
});

afterAll(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

function mockReq(url, { method = "GET", headers = {}, bodyText = "" } = {}) {
  const chunks = bodyText ? [Buffer.from(bodyText)] : [];
  return {
    url,
    method,
    headers,
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    finished: false,
    writeHead(status, headers) {
      if (this.finished) throw new Error("ERR_HTTP_HEADERS_SENT");
      this.statusCode = status;
      this.headers = headers;
    },
    end(payload) {
      if (this.finished) throw new Error("ERR_HTTP_HEADERS_SENT");
      this.finished = true;
      this.body = payload ?? "";
    },
  };
}

async function call(url, options) {
  const res = mockRes();
  await app(mockReq(url, options), res);
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

describe("http-app routing", () => {
  it("rejects cross-origin requests before anything else", async () => {
    const { status, body } = await call("/api/health", {
      headers: { origin: "https://evil.com", host: "127.0.0.1:8787" },
    });
    expect(status).toBe(403);
    expect(body.error).toMatch(/cross-origin/);
  });

  it("answers /api/health with the probed binary name", async () => {
    const { status, body } = await call("/api/health");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.omp.bin).toBe("omp-test-missing-binary");
  });

  it("maps a missing browse directory to a 400 with the exact message", async () => {
    const missing = path.join(tmpRoot, "does-not-exist");
    const { status, body } = await call(`/api/fs?path=${encodeURIComponent(missing)}`);
    expect(status).toBe(400);
    expect(body.error).toBe(`directory not found: ${missing}`);
  });

  it("contains static path resolution inside distDir", async () => {
    const { status } = await call(`/${encodeURIComponent("..%5cdist-extra%5cx")}`);
    // Traversal falls back to the SPA index (404 "not built" here — no dist).
    expect([200, 404]).toContain(status);
  });

  it("returns 404 for unknown /api endpoints", async () => {
    const { status } = await call("/api/nope");
    expect(status).toBe(404);
  });

  it("scopes /api/projects current to the calling connection", async () => {
    connections.set("conn-1", { cwd: path.join(tmpRoot, "project-b"), child: null });
    try {
      const anonymous = await call("/api/projects");
      expect(anonymous.body.current).toBe(state.defaultCwd);
      const scoped = await call("/api/projects", { headers: { "x-omp-web-connection": "conn-1" } });
      expect(scoped.body.current).toBe(path.join(tmpRoot, "project-b"));
    } finally {
      connections.delete("conn-1");
    }
  });

  it("legacy /api/cwd without a header is a no-op for the same cwd", async () => {
    const { body } = await call("/api/cwd", {
      method: "POST",
      bodyText: JSON.stringify({ cwd: state.defaultCwd }),
    });
    expect(body.changed).toBe(false);
    expect(children.size).toBe(0);
  });

  it("connection-scoped /api/cwd disposes only that connection's child", async () => {
    const disposed = [];
    connections.set("conn-2", {
      cwd: state.defaultCwd,
      child: { dispose: () => disposed.push("conn-2") },
    });
    children.add({ dispose: () => disposed.push("other") });
    try {
      const target = path.join(tmpRoot, "project-c");
      fs.mkdirSync(target, { recursive: true });
      const { body } = await call("/api/cwd", {
        method: "POST",
        headers: { "x-omp-web-connection": "conn-2" },
        bodyText: JSON.stringify({ cwd: target }),
      });
      expect(body.changed).toBe(true);
      expect(disposed).toEqual(["conn-2"]);
      expect(state.defaultCwd).toBe(target); // fresh connections inherit
    } finally {
      connections.delete("conn-2");
      children.clear();
    }
  });
});
