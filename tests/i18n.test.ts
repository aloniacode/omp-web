import { describe, expect, it } from "vitest";
import { ACCENTS } from "../src/lib/theme";
import { messages, storeT } from "../src/i18n";

function keySet(lang: "en" | "zh") {
  return Object.keys(messages[lang]).sort();
}

describe("i18n dictionaries", () => {
  it("en and zh have identical key sets", () => {
    expect(keySet("zh")).toEqual(keySet("en"));
  });
  it("values are non-empty strings", () => {
    for (const lang of ["en", "zh"] as const) {
      for (const [key, value] of Object.entries(messages[lang])) {
        expect(typeof value).toBe("string");
        expect((value as string).length).toBeGreaterThan(0);
        if (key === value) throw new Error(`${lang}:${key} resolves to its own key`);
      }
    }
  });
});

describe("ACCENTS presets", () => {
  it("have matching dictionary entries for every accent label", () => {
    for (const accent of ACCENTS) {
      expect(Object.keys(messages.en)).toContain(`settings.accent.${accent.id}`);
      expect(Object.keys(messages.zh)).toContain(`settings.accent.${accent.id}`);
    }
  });
  it("include graphite as the default-first preset", () => {
    expect(ACCENTS[0].id).toBe("graphite");
  });
});

describe("storeT", () => {
  it("interpolates variables", () => {
    expect(storeT("topbar.queued", { n: 3 })).toBe("3 queued");
  });
});
