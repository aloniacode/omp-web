import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | null = null;

const LANGS = [
  "typescript",
  "javascript",
  "tsx",
  "jsx",
  "json",
  "bash",
  "shell",
  "python",
  "rust",
  "go",
  "css",
  "html",
  "markdown",
  "yaml",
  "diff",
  "sql",
];

/** Common markdown fence aliases → shiki language ids. */
const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  py: "python",
  golang: "go",
  htm: "html",
  xml: "html",
};

function normalizeLang(lang: string): string {
  const lower = lang.toLowerCase();
  return ALIASES[lower] ?? lower;
}

export function getHighlighter(): Promise<Highlighter> {
  highlighterPromise ??= createHighlighter({ themes: ["github-light", "github-dark-default"], langs: LANGS });
  return highlighterPromise;
}

const cache = new Map<string, string>();
const MAX_CACHE = 300;
const MAX_CODE = 20_000;

/**
 * Highlight a code fence; returns HTML or null when the language is unknown
 * or the block is too large (callers fall back to a plain <pre>).
 */
export async function highlightCode(
  code: string,
  lang: string,
  theme: "light" | "dark",
): Promise<string | null> {
  if (!code || code.length > MAX_CODE) return null;
  const normalized = normalizeLang(lang);
  const key = `${normalized}:${theme}:${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;

  try {
    const highlighter = await getHighlighter();
    const loaded = new Set(highlighter.getLoadedLanguages());
    const target = loaded.has(normalized) ? normalized : "text";
    const html = await highlighter.codeToHtml(code, {
      lang: target,
      theme: theme === "dark" ? "github-dark-default" : "github-light",
    });
    if (cache.size >= MAX_CACHE) cache.clear();
    cache.set(key, html);
    return html;
  } catch {
    return null;
  }
}
