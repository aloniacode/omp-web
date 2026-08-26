import { useCallback, useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "omp-web.theme";
const ACCENT_KEY = "omp-web.accent";

export interface AccentPreset {
  id: string;
  label: string;
  /** UI swatch color (fixed, theme-independent). */
  swatch: string;
}

export const ACCENTS: AccentPreset[] = [
  { id: "graphite", label: "石墨 Black", swatch: "#18181b" },
  { id: "violet", label: "紫罗兰 Violet", swatch: "#7c5cff" },
  { id: "blue", label: "蓝色 Blue", swatch: "#3b82f6" },
  { id: "emerald", label: "翠绿 Emerald", swatch: "#10b981" },
  { id: "rose", label: "玫红 Rose", swatch: "#f43f5e" },
  { id: "amber", label: "琥珀 Amber", swatch: "#f59e0b" },
];

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
  document.documentElement.style.colorScheme = resolved;
}

function applyAccent(accent: string) {
  document.documentElement.dataset.accent = accent;
}

/** Light/dark/system preference + accent preset, persisted, applied to <html>. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
  });
  const [accent, setAccentState] = useState<string>(() => {
    const stored = localStorage.getItem(ACCENT_KEY);
    return stored && ACCENTS.some((a) => a.id === stored) ? stored : "graphite";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() => resolve(pref));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, pref);
    const next = resolve(pref);
    setResolved(next);
    apply(next);

    if (pref !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const r = resolve("system");
      setResolved(r);
      apply(r);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [pref]);

  useEffect(() => {
    localStorage.setItem(ACCENT_KEY, accent);
    applyAccent(accent);
  }, [accent]);

  const setAccent = useCallback((id: string) => setAccentState(id), []);

  const cycle = useCallback(() => {
    setPref((current) => (current === "system" ? "light" : current === "light" ? "dark" : "system"));
  }, []);

  return { pref, resolved, setPref, cycle, accent, setAccent };
}
