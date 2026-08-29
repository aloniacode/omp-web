/**
 * Shared runtime pieces of the bridge <-> browser wire contract. Types live
 * in index.d.ts; only values both sides genuinely need are runtime code.
 */

/** Highest RPC protocol version omp-web negotiates (oh-my-pi docs/rpc.md). */
export const PROTOCOL_VERSION = 2;

/** Request id used for the handshake's negotiate_protocol call. */
export const PROTOCOL_REQUEST_ID = "protocol-1";

/**
 * Reassembly ceiling adopted when protocol v2 is confirmed (per oh-my-pi's
 * RPC doc: hosts raise their chunk-assembler cap after negotiation succeeds).
 */
export const NEGOTIATED_MAX_REASSEMBLED_BYTES = 512 * 1024 * 1024;

/**
 * A wire frame must carry a string `type`. Used as the uplink guard before a
 * browser frame is forwarded to the agent's stdin, and usable as a generic
 * envelope check on the downlink.
 */
export function hasType(frame) {
  return typeof frame === "object" && frame !== null && typeof frame.type === "string";
}
