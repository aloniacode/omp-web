import { describe, expect, it } from "vitest";
import { coalesceKey, isDuplicatePendingMessage, isReplayable } from "../src/lib/idempotency";
import { OmpRpcClient } from "../src/rpc/client";
import type { RpcCommand } from "../src/rpc/types";

describe("coalesceKey", () => {
  it("keys identical idempotent commands together regardless of key order", () => {
    const a = coalesceKey({ type: "set_model", provider: "p", modelId: "m" });
    const b = coalesceKey({ type: "set_model", modelId: "m", provider: "p" });
    expect(a).toBe(b);
    expect(a).toMatch(/^set_model#/);
  });

  it("keys differ when arguments differ", () => {
    expect(coalesceKey({ type: "get_messages_page", cursor: "a" })).not.toBe(
      coalesceKey({ type: "get_messages_page", cursor: "b" }),
    );
  });

  it("returns null for the prompt family (chat, never duplicates)", () => {
    for (const command of [
      { type: "prompt", message: "hi" },
      { type: "steer", message: "hi" },
      { type: "follow_up", message: "hi" },
      { type: "abort_and_prompt", message: "hi" },
    ] as RpcCommand[]) {
      expect(coalesceKey(command)).toBeNull();
    }
  });

  it("ignores undefined fields and object key order", () => {
    expect(coalesceKey({ type: "compact" })).toBe(coalesceKey({ type: "compact", customInstructions: undefined }));
    expect(coalesceKey({ type: "get_state" })).toBe(coalesceKey({ type: "get_state" }));
  });
});

describe("isDuplicatePendingMessage", () => {
  const pending = (content: string) => ({ role: "user", content, pending: true });
  const accepted = (content: string) => ({ role: "user", content });

  it("flags an identical trailing pending prompt", () => {
    expect(isDuplicatePendingMessage([accepted("earlier"), pending("same text")], "same text")).toBe(true);
  });

  it("does not flag different text or an already accepted prompt", () => {
    expect(isDuplicatePendingMessage([pending("same text")], "other")).toBe(false);
    expect(isDuplicatePendingMessage([accepted("same text")], "same text")).toBe(false);
  });

  it("ignores trailing assistant/tool traffic and scans back to the last user message", () => {
    const messages = [pending("same text"), { role: "assistant", content: [] }];
    expect(isDuplicatePendingMessage(messages, "same text")).toBe(true);
  });

  it("returns false for an empty transcript", () => {
    expect(isDuplicatePendingMessage([], "anything")).toBe(false);
  });

  it("matches image-bearing sends only when the image count matches", () => {
    const pendingWithImage = {
      role: "user",
      content: [{ type: "text", text: "look" }, { type: "image", data: "x", mimeType: "image/png" }],
      pending: true,
    };
    expect(isDuplicatePendingMessage([pendingWithImage], "look", 1)).toBe(true);
    expect(isDuplicatePendingMessage([pendingWithImage], "look", 0)).toBe(false);
  });
});

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (ev: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
}

function makeClient() {
  const sockets: FakeWebSocket[] = [];
  const OriginalWebSocket = globalThis.WebSocket;
  const OriginalLocation = globalThis.location;
  (globalThis as { WebSocket: unknown }).WebSocket = class extends FakeWebSocket {
    constructor() {
      super();
      sockets.push(this);
    }
  };
  (globalThis as { location: unknown }).location = { protocol: "http:" };
  const client = new OmpRpcClient();
  client.start();
  const socket = sockets[0];
  socket.onopen?.();
  return {
      client,
      socket,
      sockets,
      respond(id: string, data: unknown, on?: FakeWebSocket) {
        (on ?? socket).onmessage?.({ data: JSON.stringify({ id, type: "response", command: "x", success: true, data }) });
      },
      cleanup() {
        client.dispose();
        (globalThis as { WebSocket: unknown }).WebSocket = OriginalWebSocket;
        (globalThis as { location: unknown }).location = OriginalLocation;
      },
    };
  }

describe("OmpRpcClient in-flight coalescing", () => {
  it("shares one request for concurrent identical idempotent commands", async () => {
    const env = makeClient();
    try {
      const p1 = env.client.request({ type: "get_state" });
      const p2 = env.client.request({ type: "get_state" });
      expect(env.socket.sent).toHaveLength(1);
      env.respond(JSON.parse(env.socket.sent[0]).id, { ok: true });
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2);
      expect(r1.data).toEqual({ ok: true });
    } finally {
      env.cleanup();
    }
  });

  it("sends prompt-family commands twice and distinct args twice", async () => {
    const env = makeClient();
    try {
      const p1 = env.client.request({ type: "prompt", message: "hi" });
      const p2 = env.client.request({ type: "prompt", message: "hi" });
      const p3 = env.client.request({ type: "get_messages_page", cursor: "a" });
      const p4 = env.client.request({ type: "get_messages_page", cursor: "b" });
      expect(env.socket.sent).toHaveLength(4);
      for (const frame of env.socket.sent) env.respond(JSON.parse(frame).id, null);
      await Promise.all([p1, p2, p3, p4]);
    } finally {
      env.cleanup();
    }
  });

  it("allows a repeat after the first request settles", async () => {
    const env = makeClient();
    try {
      const p1 = env.client.request({ type: "get_state" });
      env.respond(JSON.parse(env.socket.sent[0]).id, null);
      await p1;
      const p2 = env.client.request({ type: "get_state" });
      expect(env.socket.sent).toHaveLength(2);
      env.respond(JSON.parse(env.socket.sent[1]).id, null);
      await p2;
    } finally {
      env.cleanup();
    }
  });
});

describe("isReplayable", () => {
  it("covers read-only commands only", () => {
    for (const type of ["get_state", "get_session_stats", "get_available_models", "get_messages", "get_messages_page"]) {
      expect(isReplayable({ type } as RpcCommand)).toBe(true);
    }
    for (const command of [
      { type: "prompt", message: "hi" },
      { type: "abort" },
      { type: "new_session" },
      { type: "switch_session", sessionPath: "x" },
      { type: "compact" },
      { type: "set_model", provider: "p", modelId: "m" },
    ] as RpcCommand[]) {
      expect(isReplayable(command)).toBe(false);
    }
  });
});

describe("OmpRpcClient reconnect replay", () => {
  function openSocket(sockets: Array<InstanceType<typeof FakeWebSocket>>) {
    const next = sockets[sockets.length - 1];
    next.onopen?.();
    return next;
  }

  it("replays read-only in-flight requests on reconnect and fails the rest", async () => {
    const env = makeClient();
    try {
      const stats = env.client.request({ type: "get_session_stats" });
      const prompt = env.client
        .request({ type: "prompt", message: "hi" })
        .then(() => "resolved", (err: Error) => `rejected: ${err.message}`);
      expect(env.socket.sent).toHaveLength(2);
      const originalStatsId = JSON.parse(env.socket.sent[0]).id;

      // Drop the socket: the prompt fails immediately, stats stays pending.
      env.socket.onclose?.();
      await expect(prompt).resolves.toMatch(/^rejected: connection to agent bridge lost/);

      // Reconnect on a fresh socket (reconnect() bypasses the retry backoff,
      // exactly like the store's submit-token path): stats is re-sent under
      // its original id.
      env.client.reconnect();
      const reopened = openSocket(env.sockets);
      expect(reopened.sent).toHaveLength(1);
      const resent = JSON.parse(reopened.sent[0]);
      expect(resent.type).toBe("get_session_stats");
      expect(resent.id).toBe(originalStatsId);
      env.respond(originalStatsId, { tokens: 1 }, reopened);
      await expect(stats).resolves.toMatchObject({ data: { tokens: 1 } });
    } finally {
      env.cleanup();
    }
  });

  it("does not replay when the caller gave up (timeout cleared the entry)", async () => {
    const env = makeClient();
    try {
      const req = env.client.request({ type: "get_state" }, 10);
      env.socket.onclose?.();
      await new Promise((r) => setTimeout(r, 30)); // timer fires while offline
      await expect(req).rejects.toThrow(/timed out/);
      env.client.reconnect();
      const reopened = openSocket(env.sockets);
      expect(reopened.sent).toHaveLength(0);
    } finally {
      env.cleanup();
    }
  });
});
