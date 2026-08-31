import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Check as IconCheck, Copy as IconCopy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "../lib/highlighter";
import { useTheme } from "../lib/theme";
import { useI18n } from "../i18n";

/** Extract the raw text + language from a markdown <code> child of <pre>. */
function codeInfo(children: ReactNode): { code: string; lang: string } {
  const child = Array.isArray(children) ? children[0] : children;
  if (child && typeof child === "object" && "props" in (child as Record<string, unknown>)) {
    const element = child as { props: { className?: string; children?: ReactNode } };
    const lang = /language-([\w-]+)/.exec(element.props.className ?? "")?.[1] ?? "";
    const raw = element.props.children;
    const code = typeof raw === "string" ? raw : Array.isArray(raw) ? raw.join("") : "";
    return { code: code.replace(/\n$/, ""), lang };
  }
  return { code: "", lang: "" };
}

/** Copy affordance pinned to the block's top-right corner; icon flips on success. */
function CopyButton({ code }: { code: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable (permissions / insecure context) — ignore
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={copied ? t("message.codeCopied") : t("message.copyCode")}
      aria-label={copied ? t("message.codeCopied") : t("message.copyCode")}
      className="absolute right-2 top-2 z-10 rounded-md border border-zinc-200 bg-white/90 p-1.5 text-zinc-400 opacity-0 shadow-sm backdrop-blur transition-opacity hover:text-accent focus-visible:opacity-100 group-hover/code:opacity-100 dark:border-zinc-700 dark:bg-zinc-900/90 dark:text-zinc-500 dark:hover:text-accent"
    >
      {copied ? <IconCheck size={13} className="text-emerald-500" /> : <IconCopy size={13} />}
    </button>
  );
}

function CodeBlock({ children }: { children: ReactNode }) {
  const { resolved } = useTheme();
  const { code, lang } = useMemo(() => codeInfo(children), [children]);
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setHtml(null);
    void highlightCode(code, lang, resolved).then((result) => {
      if (alive) setHtml(result);
    });
    return () => {
      alive = false;
    };
  }, [code, lang, resolved]);

  if (html) {
    return (
      <div className="group/code relative">
        <CopyButton code={code} />
        <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    );
  }
  return (
    <div className="group/code relative">
      <CopyButton code={code} />
      <pre>
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
