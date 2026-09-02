import { useEffect, useRef, useState } from "react";
import { Check as IconCheck, Copy as IconCopy } from "lucide-react";
import { useI18n } from "../i18n";

/**
 * Ghost copy button with a transient copied check. `text` may be lazy
 * (computed on click) so large or streaming content isn't materialized
 * per render.
 */
export function CopyButton({
  text,
  title,
  className = "",
}: {
  text: string | (() => string);
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const value = typeof text === "function" ? text() : text;
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — manual selection still works
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      title={title ?? t("common.copy")}
      className={`inline-flex cursor-pointer items-center justify-center rounded-md border border-zinc-300/60 bg-white/85 p-1 text-zinc-500 backdrop-blur transition-opacity hover:text-accent focus-visible:opacity-100 dark:border-zinc-600/60 dark:bg-zinc-900/85 dark:text-zinc-400 dark:hover:text-accent ${
        copied ? "text-emerald-500 dark:text-emerald-400" : ""
      } ${className}`}
    >
      {copied ? <IconCheck size={12} className="text-emerald-500 dark:text-emerald-400" /> : <IconCopy size={12} />}
    </button>
  );
}
