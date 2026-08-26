import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlightCode } from "../lib/highlighter";
import { useTheme } from "../lib/theme";

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
    return <div className="shiki-block" dangerouslySetInnerHTML={{ __html: html }} />;
  }
  return (
    <pre>
      <code className={lang ? `language-${lang}` : undefined}>{code}</code>
    </pre>
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
