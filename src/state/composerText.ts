/**
 * Composer text lives outside the global app store: every keystroke would
 * otherwise re-render all store consumers (chat list, markdown, topbar) and
 * make typing feel laggy. This tiny external store is subscribed to only by
 * the Composer; external writers (extension set_editor_text, suggestion
 * chips) push updates through setComposerText.
 */

let text = "";
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function getComposerText(): string {
  return text;
}

export function setComposerText(next: string): void {
  if (next === text) return;
  text = next;
  emit();
}

export function subscribeComposerText(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
