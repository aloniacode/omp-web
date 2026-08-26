import { describe, expect, it } from "vitest";
import { FrameAssembler } from "../server/rpc-frame.mjs";

function chunks(id: string, payload: object, count = 3) {
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const size = Math.ceil(raw.length / count);
  const out: Array<{ type: string; chunkId: string; index: number; count: number; byteLength: number; data: string }> = [];
  for (let i = 0; i < count; i += 1) {
    out.push({
      type: "rpc_chunk",
      chunkId: id,
      index: i,
      count,
      byteLength: raw.length,
      data: raw.subarray(i * size, (i + 1) * size).toString("base64"),
    });
  }
  return out;
}

describe("FrameAssembler", () => {
  it("passes non-chunk frames through unchanged", () => {
    const assembler = new FrameAssembler();
    const frame = { type: "response", command: "get_state" };
    expect(assembler.feed(frame)).toEqual({ output: frame });
  });

  it("reassembles multi-chunk sequences into the original frame", () => {
    const assembler = new FrameAssembler();
    const payload = { type: "response", command: "big", data: { blob: "x".repeat(5000) } };
    let result: { output: unknown } | null = null;
    for (const chunk of chunks("c1", payload)) {
      result = assembler.feed(chunk);
    }
    expect(result?.output).toEqual(payload);
  });

  it("rejects interleaved sequences", () => {
    const assembler = new FrameAssembler();
    for (const c of chunks("a", { n: 1 }).slice(0, 2)) assembler.feed(c);
    const [firstOfB] = chunks("b", { n: 2 });
    const res = assembler.feed(firstOfB);
    expect(res.error).toMatch(/interleaved/);
    expect(res.output).toBeNull();
    // assembler recovers: a fresh sequence is accepted again
    let last = null as null | { output: unknown };
    for (const c of chunks("c", { n: 3 })) last = assembler.feed(c);
    expect((last?.output as { n?: number })?.n).toBe(3);
  });

  it("rejects out-of-order indices", () => {
    const assembler = new FrameAssembler();
    const seq = chunks("k", { v: 42 }, 4);
    assembler.feed(seq[0]);
    const res = assembler.feed(seq[2]);
    expect(res.error).toMatch(/out-of-order/);
  });

  it("rejects size above the reassembly ceiling", () => {
    const assembler = new FrameAssembler(10);
    const res = assembler.feed({ type: "rpc_chunk", chunkId: "x", index: 0, count: 4, byteLength: 9999, data: "" });
    expect(res.error).toMatch(/exceeds limit/);
  });

  it("recovers cleanly after a failure", () => {
    const assembler = new FrameAssembler();
    assembler.feed({ type: "rpc_chunk", chunkId: "bad", index: 5, count: 2, byteLength: 10, data: "" });
    let last = null as null | { output: unknown };
    for (const c of chunks("good", { ok: true })) last = assembler.feed(c);
    expect((last?.output as { ok?: boolean })?.ok).toBe(true);
  });
});
