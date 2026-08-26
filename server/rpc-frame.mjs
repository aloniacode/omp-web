/**
 * Protocol v2 lossless-frame assembly (mirrors omp's RpcFrameDecoder rules):
 * chunks of one sequence share a chunkId; indices arrive strictly in order;
 * no interleaving; total size is bounded; bytes concat in index order and
 * decode as strict UTF-8 before JSON parsing.
 */
const MAX_DEFAULT_BYTES = 64 * 1024 * 1024;

export class FrameAssembler {
  #maxBytes;
  #pending = null;

  constructor(maxReassembledBytes = MAX_DEFAULT_BYTES) {
    this.maxBytes = maxReassembledBytes;
  }

  /**
   * Feed one parsed stdout frame.
   * @returns {{ output: object | null, error?: string }} output is the
   * reassembled logical frame when a sequence completed; chunk frames yield
   * null; any rule violation resets state and reports an error message.
   */
  feed(frame) {
    if (frame?.type !== "rpc_chunk") return { output: frame ?? null };

    const { chunkId, index, count, byteLength, data } = frame;
    if (
      typeof chunkId !== "string" ||
      !Number.isInteger(index) ||
      !Number.isInteger(count) ||
      count < 1 ||
      index < 0 ||
      index >= count ||
      !Number.isInteger(byteLength) ||
      typeof data !== "string"
    ) {
      return this.#fail("malformed rpc_chunk fields");
    }
    if (byteLength > this.maxBytes) {
      return this.#fail(`reassembled frame ${byteLength} exceeds limit ${this.maxBytes}`);
    }

    if (this.pending && this.pending.chunkId !== chunkId) {
      return this.#fail(`interleaved chunk sequence (${this.pending.chunkId} vs ${chunkId})`);
    }
    if (!this.pending) {
      if (index !== 0) return this.#fail(`chunk sequence starts at index ${index}`);
      this.pending = { chunkId, count, byteLength, parts: [] };
    } else if (count !== this.pending.count || byteLength !== this.pending.byteLength) {
      return this.#fail("chunk metadata mismatch within sequence");
    }
    if (index !== this.pending.parts.length) {
      return this.#fail(`out-of-order chunk index ${index}, expected ${this.pending.parts.length}`);
    }
    this.pending.parts.push(Buffer.from(data, "base64"));
    if (this.pending.parts.length < count) return { output: null };

    const { byteLength: expected, parts } = this.pending;
    this.pending = null;
    const buf = Buffer.concat(parts);
    if (buf.length !== expected) {
      return this.#fail(`reassembly size mismatch (${buf.length} != ${expected})`);
    }
    try {
      const json = new TextDecoder("utf-8", { fatal: true }).decode(buf);
      return { output: JSON.parse(json) };
    } catch (err) {
      return this.#fail(`reassembly decode failed: ${err.message}`);
    }
  }

  reset() {
    this.pending = null;
  }

  #fail(message) {
    this.pending = null;
    return { output: null, error: message };
  }
}
