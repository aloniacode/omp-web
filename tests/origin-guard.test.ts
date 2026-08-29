import { describe, expect, it } from "vitest";
import { isAllowedOrigin } from "../server/origin-guard.mjs";

describe("isAllowedOrigin", () => {
  it("allows requests without an Origin (curl, scripts, node clients)", () => {
    expect(isAllowedOrigin(undefined, "127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("", "127.0.0.1:8787")).toBe(true);
  });

  it("allows loopback origins on any port", () => {
    expect(isAllowedOrigin("http://localhost:5173", "127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8787", "127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("http://127.0.0.1:8787", undefined)).toBe(true);
    expect(isAllowedOrigin("http://[::1]:8787", "127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("https://sub.localhost", "127.0.0.1:8787")).toBe(true);
  });

  it("allows same-authority access on a non-loopback host (LAN binding)", () => {
    expect(isAllowedOrigin("http://192.168.1.5:8787", "192.168.1.5:8787")).toBe(true);
    // Port-insensitive on purpose (consistent with the loopback rule).
    expect(isAllowedOrigin("http://192.168.1.5:9999", "192.168.1.5:8787")).toBe(true);
  });

  it("handles IPv6 literal Host headers (bracket-aware)", () => {
    expect(isAllowedOrigin("http://[fe80::1]:8787", "[fe80::1]:8787")).toBe(true);
    expect(isAllowedOrigin("http://0.0.0.0:8787", "0.0.0.0:8787")).toBe(true);
  });

  it("pins the userinfo parse quirk (browsers cannot forge Origin userinfo)", () => {
    // new URL("http://evil.com@localhost").hostname === "localhost", so a
    // hand-crafted Origin like this is allowed — unreachable from browsers,
    // which serialize Origin without userinfo. Pinned so nobody "fixes" it.
    expect(isAllowedOrigin("http://evil.com@localhost:8787", "127.0.0.1:8787")).toBe(true);
  });

  it("rejects cross-site origins", () => {
    expect(isAllowedOrigin("https://evil.com", "127.0.0.1:8787")).toBe(false);
    expect(isAllowedOrigin("http://evil.com:8787", "127.0.0.1:8787")).toBe(false);
    expect(isAllowedOrigin("http://localhost.evil.com", "127.0.0.1:8787")).toBe(false);
    expect(isAllowedOrigin("http://127.0.0.1.evil.com", "127.0.0.1:8787")).toBe(false);
  });

  it("rejects malformed origins", () => {
    expect(isAllowedOrigin("null", "127.0.0.1:8787")).toBe(false);
    expect(isAllowedOrigin("not a url", "127.0.0.1:8787")).toBe(false);
  });

  it("is case-insensitive on the origin host", () => {
    expect(isAllowedOrigin("http://LOCALHOST:5173", "127.0.0.1:8787")).toBe(true);
    expect(isAllowedOrigin("http://EVIL.com", "127.0.0.1:8787")).toBe(false);
  });
});
