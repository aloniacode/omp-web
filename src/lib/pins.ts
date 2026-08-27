/**
 * Pinned-session registry, persisted in localStorage and shared between the
 * sidebar (pinned group) and the top-bar session menu.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "omp-web.pinned-sessions";

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

let pins: string[] = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pins));
  } catch {
    // storage unavailable — keep in-memory state
  }
  for (const listener of listeners) listener();
}

export function getPinned(): string[] {
  return pins;
}

export function subscribePinned(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPinned(path: string | null | undefined): boolean {
  return path != null && pins.includes(path);
}

export function togglePin(path: string) {
  pins = pins.includes(path) ? pins.filter((p) => p !== path) : [...pins, path];
  persist();
}

/** React binding for the pinned-session list. */
export function usePinned(): string[] {
  return useSyncExternalStore(subscribePinned, getPinned);
}
