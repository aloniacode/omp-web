/**
 * Browser notifications for finished agent turns (Notification API).
 *
 * Preference lives in localStorage; the actual notification fires only when
 * the page is hidden — notifying a user who is watching the chat is noise.
 * Permission is requested from the settings toggle (a user gesture).
 */
import { truncate } from "./format";

const STORAGE_KEY = "omp-web.notify";
const MAX_BODY_CHARS = 140;

export function notificationsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, "on");
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // storage unavailable — preference is best-effort
  }
}

/** Request permission from a user gesture. False when denied/unsupported. */
export async function requestNotifyPermission(): Promise<"granted" | "denied" | "unsupported"> {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return (await Notification.requestPermission()) === "granted" ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

/**
 * Notify that a turn finished. No-ops unless enabled, supported, granted,
 * and the page is hidden; failures are swallowed (best-effort UX).
 */
export function notifyTurnEnd(title: string, body: string): void {
  if (!notificationsEnabled() || !document.hidden) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, {
      body: truncate(body.trim() || " ", MAX_BODY_CHARS),
      tag: "omp-web-turn-end",
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Notification constructor can throw on some platforms — ignore.
  }
}
