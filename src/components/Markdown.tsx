import { memo, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "../lib/highlighter";
import { useTheme } from "../lib/theme";
import { useI18n } from "../i18n";
import { CopyButton } from "./CopyButton";

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

function CodeBlock({ children }: { children: ReactNode }) {
  const { t } = useI18n();
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

  return (
    <div className="group relative">
      {html ? (
        <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre>
          <code className={lang ? `language-${lang}` : undefined}>{code}</code>
        </pre>
      )}
      <CopyButton
        text={code}
        title={t("message.copyCode")}
        className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100"
      />
    </div>
  );
}

/** Memoized by text: session reloads rebuild every message object but the
 *  markdown strings compare equal by value, so revisiting a session skips
 *  the (synchronous) react-markdown parse for every previously seen block. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
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
});
