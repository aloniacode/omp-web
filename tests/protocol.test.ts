import { describe, expect, it } from "vitest";
import {
  NEGOTIATED_MAX_REASSEMBLED_BYTES,
  PROTOCOL_REQUEST_ID,
  PROTOCOL_VERSION,
  hasType,
} from "@omp-web/protocol";

describe("protocol constants", () => {
  it("pins the negotiated protocol version and handshake id", () => {
    expect(PROTOCOL_VERSION).toBe(2);
    expect(PROTOCOL_REQUEST_ID).toBe("protocol-1");
    expect(NEGOTIATED_MAX_REASSEMBLED_BYTES).toBe(512 * 1024 * 1024);
  });
});

describe("hasType", () => {
  it("accepts frames with a string type", () => {
    expect(hasType({ type: "response" })).toBe(true);
    expect(hasType({ type: "", extra: 1 })).toBe(true);
  });

  it("rejects non-frames", () => {
    expect(hasType(null)).toBe(false);
    expect(hasType(undefined)).toBe(false);
    expect(hasType("response")).toBe(false);
    expect(hasType({})).toBe(false);
    expect(hasType({ type: 42 })).toBe(false);
  });
});
