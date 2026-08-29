import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArchiveRestore as IconArchive,
  ArrowRightLeft as IconHandoff,
  AtSign as IconAtSign,
  ClipboardList as IconPlan,
  Flag as IconFlag,
  Image as IconImage,
  Plus as IconPlus,
  Send as IconSend,
  Square as IconSquare,
  X as IconX,
  Zap as IconZap,
} from "lucide-react";
import { useI18n, type MessageKey } from "../i18n";
import { useActions, useAppStore } from "../state/store";
import {
  getComposerText,
  setComposerText,
  subscribeComposerText,
} from "../state/composerText";
import type { ImageContent } from "../rpc/types";
import type { Goal } from "../rpc/types";
import { buildGoalKickoff, buildGoalOpPrompt, GOAL_STATUS_KEYS, type GoalOp } from "../lib/goalMode";
import {
  buildCommandItems,
  filterCommandItems,
  parseLocalSlashCommand,
  type CommandItem,
} from "../lib/slash";
import { ModelPicker, ProjectPicker } from "./pickers";
import { ContextDisplay } from "./ContextDisplay";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

interface MentionState {
  kind: "file" | "command";
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
/** Slash-command token at the start of the input or after whitespace. */
const TRIGGER_COMMAND = /(^|\s)\/([a-z0-9-]*)$/i;

/** Palette icon per command name; skills fall back to the zap icon. */
const COMMAND_ICONS: Record<string, typeof IconPlan> = {
  plan: IconPlan,
  goal: IconFlag,
  handoff: IconHandoff,
  compact: IconArchive,
};

/** Goal lifecycle states the /goal subcommands operate on. */
function isGoalOperable(goal: Goal | null): goal is Goal {
  return goal !== null && (goal.status === "active" || goal.status === "paused" || goal.status === "budget-limited");
}

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

/** Plus menu: unified entry for file references, the "/" palette and image attachments. */
function PlusMenu({ onPick, disabled }: { onPick: (kind: "file" | "command" | "image") => void; disabled: boolean }) {
  const { t } = useI18n();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        aria-label={t("composer.attach")}
        className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
      >
        <IconPlus size={15} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuItem onSelect={() => onPick("file")}>
          <IconAtSign size={13} className="text-zinc-400" />
          {t("composer.fileRef")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("command")}>
          <IconZap size={13} className="text-zinc-400" />
          {t("composer.skillsRef")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick("image")}>
          <IconImage size={13} className="text-zinc-400" />
          {t("composer.attachImage")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Composer() {
  const { t } = useI18n();
  const actions = useActions();
  const connected = useAppStore((s) => s.connStatus === "connected" && s.agentReady);
  const stopping = useAppStore((s) => s.stopping);
  const isStreaming = useAppStore((s) => Boolean(s.agentState?.isStreaming));
  // Explicitly non-vision current model (agent state first, then the model
  // catalog): only rejects when known to lack image support.
  const visionBlocked = useAppStore((s) => {
    const model = s.agentState?.model;
    if (model?.vision === false) return true;
    const listed = model ? s.models.find((m) => m.provider === model.provider && m.id === model.id) : undefined;
    return listed?.vision === false;
  });
  // Composer text is a dedicated external store: typing re-renders only
  // this component instead of every store consumer.
  const composerText = useSyncExternalStore(subscribeComposerText, getComposerText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const filesCache = useRef<Map<string, string[]>>(new Map());
  const fileFetchSeq = useRef(0);

  const [mention, setMention] = useState<MentionState | null>(null);
  const [selected, setSelected] = useState(0);
  const [fileResults, setFileResults] = useState<string[]>([]);
  const [skills, setSkills] = useState<Array<{ name: string; description: string; source: string }>>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  // Keep the highlighted palette item in view as arrows move the selection.
  useEffect(() => {
    const popup = popupRef.current;
    if (!popup) return;
    popup.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selected, mention]);
  // Auto-grow with content, clamped.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [composerText]);

  // Skill catalog is small: load once per palette lifetime, even on failures
  // (an empty/failed catalog must not refetch on every palette open).
  const skillsLoaded = useRef(false);
  useEffect(() => {
    if (mention?.kind !== "command" || skillsLoaded.current) return;
    skillsLoaded.current = true;
    fetch("/api/skills")
      .then((res) => res.json())
      .then((body: { skills?: Array<{ name: string; description: string; source: string }> }) => {
        if (Array.isArray(body.skills)) setSkills(body.skills);
      })
      .catch(() => undefined);
  }, [mention?.kind]);

  // Unified "/" palette: local commands first, then the session's skills.
  const commandItems = useMemo(
    () => buildCommandItems(skills, (name) => t(`cmd.${name}` as MessageKey)),
    [skills, t],
  );
  const filteredCommands = useMemo(
    () => (mention?.kind === "command" ? filterCommandItems(commandItems, mention.query) : []),
    [mention, commandItems],
  );

  const filteredMentions = useMemo(() => {
    if (!mention) return [];
    if (mention.kind === "file") return fileResults;
    return filteredCommands.map((item) => item.name);
  }, [mention, fileResults, filteredCommands]);

  const detectMention = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const fileMatch = before.match(TRIGGER_FILE);
    if (fileMatch) {
      openMention("file", fileMatch[1], caret - fileMatch[1].length - 1);
      return;
    }
    // "/" opens the unified palette (input start, or after whitespace).
    const commandMatch = before.match(TRIGGER_COMMAND);
    if (commandMatch) {
      openMention("command", commandMatch[2], caret - commandMatch[2].length - 1);
      return;
    }
    setMention(null);
  };

  const openMention = (kind: "file" | "command", query: string, start: number) => {
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

  const applyMention = (index: number, fromKeyboard = false) => {
    const el = textareaRef.current;
    if (!el || !mention) return;

    if (mention.kind === "command") {
      const picked: CommandItem | undefined = filteredCommands[Math.min(index, filteredCommands.length - 1)];
      if (!picked) return;
      // A bare "/" (empty query) is for browsing: keyboard Enter/Tab must not
      // fire a state-changing exec command until a query is typed. Explicit
      // mouse clicks are always allowed.
      if (fromKeyboard && picked.kind === "exec" && !mention.query) return;
      const text = composerText;
      const caret = el.selectionStart ?? text.length;
      if (picked.kind === "exec") {
        // No-arg commands run at once; the token is lifted out of the input.
        runSlashCommand(`/${picked.name}`);
        const rest = text.slice(caret).replace(/^\s+/, "");
        setComposerText(text.slice(0, mention.start) + rest);
        setMention(null);
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(mention.start, mention.start);
        });
        return;
      }
      // Arg-taking commands and skills insert their token for completion.
      const insertion = `/${picked.name} `;
      const next = text.slice(0, mention.start) + insertion + text.slice(caret);
      setComposerText(next);
      setMention(null);
      requestAnimationFrame(() => {
        el.focus();
        const nextCaret = mention.start + insertion.length;
        el.setSelectionRange(nextCaret, nextCaret);
      });
      return;
    }

    const options = filteredMentions;
    const picked = options[Math.min(index, options.length - 1)];
    if (!picked) return;
    const insertion = `@${picked} `;
    const text = composerText;
    const next = text.slice(0, mention.start) + insertion + text.slice(el.selectionStart ?? text.length);
    setComposerText(next);
    setMention(null);
    requestAnimationFrame(() => {
      el.focus();
      const caret = mention.start + insertion.length;
      el.setSelectionRange(caret, caret);
    });
  };

  /**
   * TUI-style quick commands intercepted before the prompt is sent.
   * Returns false for unknown commands (or missing arguments) so the text
   * still reaches the agent as a normal message.
   */
  const runSlashCommand = (text: string): boolean => {
    const parsed = parseLocalSlashCommand(text);
    if (!parsed) return false;
    const arg = parsed.arg;
    const current = useAppStore.getState();
    switch (parsed.name) {
      case "compact":
        actions.compact(arg || undefined);
        return true;
      case "plan":
        // `/plan <prompt>` enters plan mode and submits; bare `/plan` toggles.
        // Upstream: plan mode is blocked while a goal is active.
        if (isGoalOperable(current.goal)) {
          actions.notify("warning", t("goal.blockedByGoal"));
          return true;
        }
        if (arg) {
          actions.setPlanMode(true);
          actions.sendPrompt(arg);
          return true;
        }
        actions.setPlanMode(!current.planMode);
        return true;
      case "goal": {
        // Mirror upstream `/goal` subcommands that map onto goal-tool ops.
        // Ops must be the exact word: `/goal <anything else>` is an objective.
        const goal = current.goal;
        const sub = arg ? arg.split(/\s+/)[0] : "";
        const op: GoalOp | null =
          arg && (sub === "drop" || sub === "resume" || sub === "complete") && arg === sub ? sub : null;
        if (op) {
          if (!isGoalOperable(goal)) {
            actions.notify("warning", t("goal.none"));
            return true;
          }
          if (op === "resume" && goal.status !== "paused") {
            actions.notify("warning", t("goal.notPaused"));
            return true;
          }
          if (op === "complete" && goal.status === "paused") {
            actions.notify("warning", t("goal.resumeFirst"));
            return true;
          }
          actions.sendPrompt(buildGoalOpPrompt(op));
          return true;
        }
        if (arg) {
          // Upstream: goal mode is blocked by plan mode.
          if (current.planMode) {
            actions.notify("warning", t("goal.blockedByPlan"));
            return true;
          }
          if (isGoalOperable(goal)) {
            actions.notify("warning", t("goal.alreadyActive"));
            return true;
          }
          actions.sendPrompt(buildGoalKickoff(arg));
          return true;
        }
        actions.notify(
          "info",
          goal && isGoalOperable(goal)
            ? `${goal.objective} · ${t(GOAL_STATUS_KEYS[goal.status])}`
            : t("goal.usage"),
          "goal",
        );
        return true;
      }
      case "handoff":
        actions.handoff(arg || undefined);
        return true;
      default:
        return false;
    }
  };

  const submit = () => {
    const text = composerText.trim();
    if ((!text && attachments.length === 0) || !connected) return;
    if (text.startsWith("/") && runSlashCommand(text)) {
      setComposerText("");
      setAttachments([]);
      setMention(null);
      return;
    }
    actions.sendPrompt(text, attachmentsToContent(attachments));
    setComposerText("");
    setAttachments([]);
    setMention(null);
  };

  const attachmentsToContent = (items: Attachment[]): ImageContent[] | undefined =>
    items.length > 0
      ? items.map((item) => ({ type: "image", data: item.data, mimeType: item.mimeType }))
      : undefined;

  const onKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && event.key === "Escape") {
      event.preventDefault();
      setMention(null);
      return;
    }
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
        applyMention(selected, true);
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const onChange = (value: string) => {
    setComposerText(value);
    detectMention(value, textareaRef.current?.selectionStart ?? value.length);
  };

  const openPicker = (kind: "file" | "command") => {
    const el = textareaRef.current;
    el?.focus();
    const caret = el?.selectionStart ?? composerText.length;
    const text = composerText;
    const next = `${text.slice(0, caret)}${kind === "file" ? "@" : "/"}${text.slice(caret)}`;
    setComposerText(next);
    const triggerStart = caret;
    requestAnimationFrame(() => {
      el?.setSelectionRange(triggerStart + 1, triggerStart + 1);
      openMention(kind, "", triggerStart);
    });
  };

  const onPlusPick = (kind: "file" | "command" | "image") => {
    if (kind === "image") {
      imageInputRef.current?.click();
      return;
    }
    openPicker(kind);
  };

  /** Shared image intake (paste + file picker): rejects with a toast when
   *  the current model has no vision support. */
  const acceptImages = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    if (visionBlocked) {
      actions.notify("warning", t("composer.imageRejected"));
      return;
    }
    const picked: Attachment[] = [];
    for (const file of images) {
      try {
        picked.push(await readImage(file));
      } catch {
        // skip unreadable file
      }
    }
    if (picked.length > 0) setAttachments((current) => [...current, ...picked]);
  };

  const onPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files ?? []);
    if (!files.some((file) => file.type.startsWith("image/"))) return; // plain text paste
    event.preventDefault();
    void acceptImages(files);
  };

  const onImagesPicked = async (files: FileList | null) => {
    if (!files) return;
    await acceptImages(Array.from(files));
  };

  return (
    <div className="shrink-0 px-4 pb-4 pt-1 sm:px-6">
      <div className="relative mx-auto max-w-3xl">
        {/* Mention / command palette popup */}
        {mention && (
          <div
            ref={popupRef}
            role={mention.kind === "command" ? "listbox" : undefined}
            className="absolute bottom-full left-0 z-30 mb-2 max-h-64 w-full overflow-y-auto rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          >
            {mention.kind === "command"
              ? filteredCommands.map((item, index) => {
                  // Commands and skills are pre-ordered in one flat list; a
                  // header renders whenever the group changes.
                  const showHeader = index === 0 || filteredCommands[index - 1].group !== item.group;
                  const ItemIcon = item.group === "commands" ? COMMAND_ICONS[item.name] : IconZap;
                  return (
                    <div key={`${item.group}:${item.name}`}>
                      {showHeader && (
                        <p className="border-b border-zinc-100 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                          {item.group === "commands" ? t("cmd.commands") : t("composer.skills")}
                        </p>
                      )}
                      <button
                        type="button"
                        role="option"
                        aria-selected={index === selected}
                        onMouseDown={(e) => {
                          e.preventDefault();
                          applyMention(index);
                        }}
                        onMouseEnter={() => setSelected(index)}
                        className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] ${
                          index === selected ? "bg-accent/10 text-accent" : "text-zinc-700 dark:text-zinc-200"
                        }`}
                      >
                        {ItemIcon && (
                          <span
                            className={`flex size-5 shrink-0 items-center justify-center rounded ${
                              index === selected ? "text-accent" : "text-zinc-400 dark:text-zinc-500"
                            }`}
                          >
                            <ItemIcon size={12} />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[12px]">
                            /{item.name}
                            {item.source ? <span className="ml-1.5 text-[10px] text-zinc-400">{item.source}</span> : null}
                          </span>
                          {item.description && (
                            <span className="block truncate text-[11px] text-zinc-400">{item.description}</span>
                          )}
                        </span>
                      </button>
                    </div>
                  );
                })
              : (
                <>
                  <p className="border-b border-zinc-100 px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
                    {t("composer.files")}
                  </p>
                  {filteredMentions.map((item, index) => (
                    <button
                      key={`file:${item}`}
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
                      <span className="block truncate font-mono text-[12px]">@{item}</span>
                    </button>
                  ))}
                </>
              )}
            {mention.kind === "command" && filteredCommands.length === 0 && (
              <p className="px-3 py-2 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("composer.noSkills")}</p>
            )}
            {mention.kind === "file" && filteredMentions.length === 0 && (
              <p className="px-3 py-2 text-[12.5px] text-zinc-400 dark:text-zinc-500">{t("composer.noFiles")}</p>
            )}
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

        {/* Input block: textarea on its own row; controls (plus, project,
            model, send) share one bottom bar — centered card matching the
            chat column */}
        <div className="flex flex-col rounded-2xl border border-zinc-300 bg-white p-2 shadow-md transition-colors focus-within:border-accent dark:border-zinc-700 dark:bg-zinc-900">
          <textarea
            ref={textareaRef}
            rows={1}
            value={composerText}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            onBlur={() => {
              // Delay so mention clicks (mousedown) land first.
              setTimeout(() => setMention(null), 120);
            }}
            placeholder={connected ? t("composer.placeholder") : t("composer.placeholderWaiting")}
            disabled={!connected}
            className="max-h-[220px] min-h-[38px] w-full resize-none bg-transparent px-1.5 py-2 text-[14.5px] leading-relaxed outline-none placeholder:text-zinc-400 disabled:opacity-50"
          />
          <div className="flex items-center gap-1 pt-1">
            <PlusMenu onPick={onPlusPick} disabled={!connected} />
            <ProjectPicker />
            <ModelPicker compact />
            <ContextDisplay />
            <div className="min-w-0 flex-1" />
            {stopping || isStreaming ? (
              <Button
                onClick={actions.stop}
                aria-label={stopping ? t("composer.stopping") : t("composer.stop")}
                className="bg-red-600 text-white hover:bg-red-500"
              >
                <IconSquare size={12} />
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={(!composerText.trim() && attachments.length === 0) || !connected}
                aria-label={t("composer.send")}
              >
                <IconSend size={15} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
