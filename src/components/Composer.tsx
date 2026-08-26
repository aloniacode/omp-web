import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useI18n } from "../i18n";
import { useStore } from "../state/store";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/format";
import { ModelPicker, ThinkingPicker } from "./pickers";
import { IconAtSign, IconSend, IconSquare, IconZap } from "./icons";

interface MentionState {
  kind: "file" | "skill";
  query: string;
  start: number;
}

const TRIGGER_FILE = /@([\w\-./]*)$/;
const TRIGGER_SKILL = /(^|\s)\/([a-z0-9-]*)$/i;

export function Composer() {
  const { t } = useI18n();
  const { state, actions } = useStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const connected = state.connStatus === "connected" && state.agentReady;

  const [mention, setMention] = useState<MentionState | null>(null);
  const [selected, setSelected] = useState(0);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; source: string }>>([]);
  const filesCache = useRef<Map<string, string[]>>(new Map());
  const fileFetchSeq = useRef(0);

  // Auto-grow with content, clamped.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [state.composerText]);

  // Skill catalog is small: load once when a skill mention opens.
  useEffect(() => {
    if (mention?.kind !== "skill" || skills.length > 0) return;
    fetch("/api/skills")
      .then((res) => res.json())
      .then((body: { skills?: Array<{ name: string; description: string; source: string }> }) => {
        if (Array.isArray(body.skills)) setSkills(body.skills);
      })
      .catch(() => undefined);
  }, [mention?.kind, skills.length]);

  const filteredMentions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    if (mention.kind === "file") return fileResults;
    return skills
      .filter((skill) => skill.name.toLowerCase().includes(q))
      .map((skill) => skill.name);
  }, [mention, fileResults, skills]);

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const fileMatch = before.match(TRIGGER_FILE);
    if (fileMatch) {
      openMention("file", fileMatch[1], caret - fileMatch[1].length - 1);
      return;
    }
    const skillMatch = before.match(TRIGGER_SKILL);
    if (skillMatch) {
      openMention("skill", skillMatch[2], caret - skillMatch[2].length - 1);
      return;
    }
    setMention(null);
  };

  const openMention = (kind: "file" | "skill", query: string, start: number) => {
    setMention({ kind, query, start });
    setSelected(0);
    if (kind === "file") {
      const cached = filesCache.current.get(query);
      if (cached) {
        setFileResults(cached);
        return;
      }
      const seq = ++fileFetchSeq.current;
      fetch(`/api/files?q=${encodeURIComponent(query)}`)
        .then((res) => res.json())
        .then((body: { files?: string[] }) => {
          if (seq !== fileFetchSeq.current) return; // a newer query superseded this one
          const files = Array.isArray(body.files) ? body.files : [];
          filesCache.current.set(query, files);
          setFileResults(files);
        })
        .catch(() => {
          if (seq === fileFetchSeq.current) setFileResults([]);
        });
    }
  };

  const applyMention = (index: number) => {
    const el = textareaRef.current;
    if (!el || !mention) return;
    const options = filteredMentions;
    const picked = options[Math.min(index, options.length - 1)];
    if (!picked) return;
    const insertion = mention.kind === "file" ? `@${picked} ` : `/${picked} `;
    const text = state.composerText;
    const next = text.slice(0, mention.start) + insertion + text.slice(el.selectionStart ?? text.length);
    actions.setComposerText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const caret = mention.start + insertion.length;
      el.setSelectionRange(caret, caret);
    });
  };

  const submit = () => {
    const text = state.composerText.trim();
    if (!text || !connected) return;
    actions.sendPrompt(text);
    actions.setComposerText("");
    setMention(null);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && filteredMentions.length > 0) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelected((i) => (i + 1) % filteredMentions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelected((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        applyMention(selected);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMention(null);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onChange = (value: string) => {
    actions.setComposerText(value);
    detectMention(value, textareaRef.current?.selectionStart ?? value.length);
  };

  const openPicker = (kind: "file" | "skill") => {
    const el = textareaRef.current;
    el?.focus();
    const caret = el?.selectionStart ?? state.composerText.length;
    const text = state.composerText;
    const next = `${text.slice(0, caret)}${kind === "file" ? "@" : "/"}${text.slice(caret)}`;
    actions.setComposerText(next);
    const triggerStart = caret;
    requestAnimationFrame(() => {
      el?.setSelectionRange(triggerStart + 1, triggerStart + 1);
      openMention(kind, "", triggerStart);
    });
  };

  const usage = state.stats;
  const context = state.stats?.contextUsage ?? state.agentState?.contextUsage;

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white px-3 pb-3 pt-2.5 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="relative mx-auto max-w-3xl">
        {/* Mention popup */}
        {mention && (
          <div className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-80 overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <p className="border-b border-zinc-100 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              {mention.kind === "file" ? t("composer.files") : t("composer.skills")}
            </p>
            {filteredMentions.length === 0 && (
              <p className="px-3 py-2 text-[12.5px] text-zinc-400 dark:text-zinc-500">
                {mention.kind === "file" ? t("composer.noFiles") : t("composer.noSkills")}
              </p>
            )}
            {filteredMentions.map((item, index) => {
              const skill = mention.kind === "skill" ? skills.find((s) => s.name === item) : undefined;
              return (
                <button
                  key={`${mention.kind}:${item}`}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyMention(index);
                  }}
                  onMouseEnter={() => setSelected(index)}
                  className={`block w-full px-3 py-1.5 text-left text-[13px] ${
                    index === selected ? "bg-accent/10 text-accent" : "text-zinc-700 dark:text-zinc-200"
                  }`}
                >
                  <span className="block truncate font-mono text-[12px]">
                    {mention.kind === "file" ? `@${item}` : `/${item}`}
                  </span>
                  {skill?.description && (
                    <span className="block truncate text-[11px] text-zinc-400">{skill.description}</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-accent dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            ref={textareaRef}
            rows={1}
            value={state.composerText}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => {
              // Delay so mention clicks (mousedown) land first.
              setTimeout(() => setMention(null), 120);
            }}
            placeholder={connected ? t("composer.placeholder") : t("composer.placeholderWaiting")}
            disabled={!connected}
            className="max-h-[220px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[14.5px] leading-relaxed outline-none placeholder:text-zinc-400 disabled:opacity-50"
          />
          {state.stopping || state.agentState?.isStreaming ? (
            <button
              type="button"
              onClick={actions.stop}
              title={state.stopping ? t("composer.stopping") : t("composer.stop")}
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white transition-colors hover:bg-red-500"
            >
              <IconSquare size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!state.composerText.trim() || !connected}
              title={t("composer.send")}
              className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconSend size={15} />
            </button>
          )}
        </div>

        {/* Toolbar: references, switchers, usage */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <button
            type="button"
            onClick={() => openPicker("file")}
            disabled={!connected}
            title={t("composer.fileRef")}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <IconAtSign size={12} />
            {t("composer.fileRef").replace(/（.*?）|\s*\(.*?\)/, "")}
          </button>
          <button
            type="button"
            onClick={() => openPicker("skill")}
            disabled={!connected}
            title={t("composer.skillsRef")}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-medium text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-40 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <IconZap size={12} />
            {t("composer.skillsRef").replace(/（.*?）|\s*\(.*?\)/, "")}
          </button>

          <span className="h-3 w-px bg-zinc-200 dark:bg-zinc-700" />
          <ModelPicker compact />
          <ThinkingPicker compact />

          {usage && (
            <span className="ml-auto flex items-center gap-2.5 text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
              <span title={t("composer.usageTotal", { tokens: usage.tokens.total })}>
                {fmtTokens(usage.tokens.total)} tok
              </span>
              <span title={t("composer.usageCost")}>{fmtCost(usage.cost)}</span>
              {context && context.contextWindow > 0 && (
                <span
                  title={t("composer.usageContext", {
                    used: fmtTokens(context.tokens),
                    window: fmtTokens(context.contextWindow),
                    percent: fmtPercent(context.percent),
                  })}
                >
                  ctx {fmtPercent(context.percent)}
                </span>
              )}
            </span>
          )}
        </div>
          <p className="mt-1 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("composer.hint")}</p>
      </div>
    </div>
  );
}
