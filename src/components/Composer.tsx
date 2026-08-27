import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Dropdown } from "@heroui/react";
import { useI18n } from "../i18n";
import { useStore } from "../state/store";
import type { ImageContent } from "../rpc/types";
import { ModelPicker } from "./pickers";
import { IconAtSign, IconImage, IconPlus, IconSend, IconSquare, IconX, IconZap } from "./icons";

interface MentionState {
  kind: "file" | "skill";
  query: string;
  start: number;
}

interface Attachment {
  id: string;
  name: string;
  data: string; // base64
  mimeType: string;
}

const TRIGGER_FILE = /@([\w\-./]*)$/;
const TRIGGER_SKILL = /(^|\s)\/([a-z0-9-]*)$/i;

/** Read a picked file as a base64 image attachment. */
function readImage(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const data = String(reader.result ?? "").replace(/^data:[^;]+;base64,/, "");
      resolve({ id: `${file.name}:${file.size}:${Date.now()}:${Math.random().toString(36).slice(2)}`, name: file.name, data, mimeType: file.type || "image/png" });
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** Plus menu: unified entry for file references, skills and image attachments. */
function PlusMenu({ onPick, disabled }: { onPick: (kind: "file" | "skill" | "image") => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <Dropdown>
      <Dropdown.Trigger
        isDisabled={disabled}
        aria-label={t("composer.attach")}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
      >
        <IconPlus size={15} />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu
          onAction={(key) => {
            const kind = String(key);
            if (kind === "file" || kind === "skill" || kind === "image") onPick(kind);
          }}
        >
          <Dropdown.Item key="file" id="file" textValue={t("composer.fileRef")}>
            <span className="flex items-center gap-2 text-[13px]">
              <IconAtSign size={13} className="shrink-0 text-zinc-400" />
              {t("composer.fileRef")}
            </span>
          </Dropdown.Item>
          <Dropdown.Item key="skill" id="skill" textValue={t("composer.skillsRef")}>
            <span className="flex items-center gap-2 text-[13px]">
              <IconZap size={13} className="shrink-0 text-zinc-400" />
              {t("composer.skillsRef")}
            </span>
          </Dropdown.Item>
          <Dropdown.Item key="image" id="image" textValue={t("composer.attachImage")}>
            <span className="flex items-center gap-2 text-[13px]">
              <IconImage size={13} className="shrink-0 text-zinc-400" />
              {t("composer.attachImage")}
            </span>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function Composer() {
  const { t } = useI18n();
  const { state, actions } = useStore();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const filesCache = useRef<Map<string, string[]>>(new Map());
  const fileFetchSeq = useRef(0);
  const connected = state.connStatus === "connected" && state.agentReady;

  const [mention, setMention] = useState<MentionState | null>(null);
  const [selected, setSelected] = useState(0);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; source: string }>>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

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
    if ((!text && attachments.length === 0) || !connected) return;
    actions.sendPrompt(text, attachmentsToContent(attachments));
    actions.setComposerText("");
    setAttachments([]);
    setMention(null);
  };

  const attachmentsToContent = (items: Attachment[]): ImageContent[] | undefined =>
    items.length > 0
      ? items.map((item) => ({ type: "image", data: item.data, mimeType: item.mimeType }))
      : undefined;

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

  const onPlusPick = (kind: "file" | "skill" | "image") => {
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    openPicker(kind);
  };

  const onImagesPicked = async (files: FileList | null) => {
    if (!files) return;
    const picked: Attachment[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        picked.push(await readImage(file));
      } catch {
        // skip unreadable file
      }
    }
    setAttachments((current) => [...current, ...picked]);
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
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

        {/* Hidden inputs */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void onImagesPicked(e.target.files);
            e.target.value = "";
          }}
        />

        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <div
                key={attachment.id}
                className="group relative overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-700"
              >
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt={attachment.name}
                  className="size-14 object-cover"
                />
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((a) => a.id !== attachment.id))}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                  title={t("composer.removeAttachment")}
                >
                  <IconX size={10} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Input block: plus | textarea | send — centered card matching the chat column */}
        <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-md transition-colors focus-within:border-accent dark:border-zinc-700 dark:bg-zinc-900">
          <PlusMenu onPick={onPlusPick} disabled={!connected} />
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
            className="max-h-[220px] min-h-[38px] flex-1 resize-none bg-transparent px-1 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-zinc-400 disabled:opacity-50"
          />
          {state.stopping || state.agentState?.isStreaming ? (
            <button
              type="button"
              onClick={actions.stop}
              title={state.stopping ? t("composer.stopping") : t("composer.stop")}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white transition-colors hover:bg-red-500"
            >
              <IconSquare size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={(!state.composerText.trim() && attachments.length === 0) || !connected}
              title={t("composer.send")}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <IconSend size={15} />
            </button>
          )}
        </div>

        {/* Toolbar blocks: model/thinking */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2 px-1">
          <ModelPicker compact />
        </div>
        <p className="mt-1 text-center text-[11px] text-zinc-400 dark:text-zinc-500">{t("composer.hint")}</p>
      </div>
    </div>
  );
}
