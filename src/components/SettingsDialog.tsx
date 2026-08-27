import { useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Dropdown } from "@heroui/react";
import { useI18n } from "../i18n";
import { useTheme, ACCENTS, type ThemePref } from "../lib/theme";
import { useActions, useAppStore } from "../state/store";
import { THINKING_LEVELS } from "../rpc/types";
import { IconChevronDown, IconX } from "./icons";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<"web" | "omp">("web");
  const [autoRetry, setAutoRetry] = useState(false);
  if (!open) return null;
  // Portal to body: rendered inside the sidebar, whose slide-in `translate`
  // (kept for the mobile animation via md:translate-x-0) forms the containing
  // block for fixed children — anchoring this viewport modal to the sidebar
  // box instead of the viewport.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="text-[15px] font-semibold">{t("settings.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <IconX size={15} />
          </button>
        </div>

        <div className="flex gap-1 px-5 pt-3">
          {(["web", "omp"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                tab === id
                  ? "bg-accent/10 text-accent"
                  : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {t(id === "web" ? "settings.tab.web" : "settings.tab.omp")}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {tab === "web" ? <WebSettings /> : <OmpSettings autoRetry={autoRetry} onAutoRetryChange={setAutoRetry} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Shared primitives ───────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
        {title}
      </h3>
      <div className="space-y-2.5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-zinc-700 dark:text-zinc-200">{label}</p>
        {hint && <p className="mt-0.5 text-[11.5px] text-zinc-400 dark:text-zinc-500">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-5.5 w-10 rounded-full transition-colors ${
        checked ? "bg-accent" : "bg-zinc-300 dark:bg-zinc-700"
      }`}
    >
      <span
        className={`absolute top-0.5 size-4.5 rounded-full bg-white shadow transition-all dark:bg-zinc-100 ${
          checked ? "left-[calc(100%-1.25rem)]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function Select({ value, options, onChange }: {
  value: string;
  options: Array<{ id: string; label: string }>;
  onChange: (id: string) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <Dropdown>
      <Dropdown.Trigger
        className="flex min-w-32 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-[12.5px] font-medium text-zinc-700 hover:border-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
      >
        <span className="truncate">{current?.label ?? "—"}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => onChange(String(key))}>
          {options.map((option) => (
            <Dropdown.Item key={option.id} id={option.id} textValue={option.label}>
              <span className="flex items-center justify-between gap-4">
                {option.label}
                {value === option.id && <span className="text-accent">●</span>}
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

// ── Web settings ────────────────────────────────────────────────────────────

function WebSettings() {
  const { t } = useI18n();
  const { pref, setPref, accent, setAccent } = useTheme();
  const { lang, setLang } = useI18n();

  const modes: Array<{ id: ThemePref; label: string }> = [
    { id: "system", label: t("settings.themeMode.system") },
    { id: "light", label: t("settings.themeMode.light") },
    { id: "dark", label: t("settings.themeMode.dark") },
  ];

  return (
    <>
      <Section title={t("settings.appearance")}>
        <Row label={t("settings.themeMode")}>
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                onClick={() => setPref(mode.id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  pref === mode.id
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {mode.label}
              </button>
            ))}
          </div>
        </Row>
        <Row label={t("settings.accent")}>
          <div className="flex items-center gap-2">
            {ACCENTS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={t(`settings.accent.${preset.id}` as never)}
                onClick={() => setAccent(preset.id)}
                className={`size-6 rounded-full border border-black/10 transition-transform dark:border-white/20 ${
                  accent === preset.id
                    ? "scale-110 ring-2 ring-zinc-400 ring-offset-2 ring-offset-white dark:ring-zinc-500 dark:ring-offset-zinc-900"
                    : "hover:scale-110"
                }`}
                style={{ backgroundColor: preset.swatch }}
              />
            ))}
          </div>
        </Row>
      </Section>

      <Section title={t("settings.language")}>
        <Row label="Language / 语言">
          <div className="flex items-center gap-0.5 rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
            {([
              { id: "en", label: "English" },
              { id: "zh", label: "中文" },
            ] as const).map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLang(option.id)}
                className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                  lang === option.id
                    ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Row>
      </Section>
    </>
  );
}

// ── OMP settings (mirrors omp TUI /settings tabs and groups) ───────────────

const OMP_TABS = ["model", "interaction", "context", "providers", "session"] as const;
type OmpTab = (typeof OMP_TABS)[number];

const TAB_LABELS: Record<OmpTab, string> = {
  model: "Model",
  interaction: "Interaction",
  context: "Context",
  providers: "Providers",
  session: "Session",
};

function OmpSettings({ autoRetry, onAutoRetryChange }: { autoRetry: boolean; onAutoRetryChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const actions = useActions();
  const s = useAppStore((st) => st.agentState);
  const agentReady = useAppStore((st) => st.agentReady);
  const sessionName = useAppStore((st) => st.sessionName);
  const sessionId = useAppStore((st) => st.sessionId);
  const activePath = useAppStore((st) => st.activePath);
  const [tab, setTab] = useState<OmpTab>("model");
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  const queueOptions = [
    { id: "all", label: t("settings.omp.all") },
    { id: "one-at-a-time", label: t("settings.omp.oneAtATime") },
  ];
  const interruptOptions = [
    { id: "immediate", label: t("settings.omp.immediate") },
    { id: "wait", label: t("settings.omp.wait") },
  ];
  const thinkingOptions = THINKING_LEVELS.map((level) => ({ id: level, label: level }));

  return (
    <div className="flex gap-4">
      {/* Tab rail - mirrors omp's settings tab bar */}
      <div className="w-32 shrink-0 space-y-0.5">
        {OMP_TABS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] font-medium transition-colors ${
              tab === id
                ? "bg-accent/10 text-accent"
                : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            }`}
          >
            {TAB_LABELS[id]}
          </button>
        ))}
      </div>

      {/* Active tab content */}
      <div className="min-w-0 flex-1 space-y-5">
        {tab === "model" && (
          <>
            <Section title="Thinking">
              <Row label={t("settings.omp.thinking")}>
                <Select
                  value={s?.thinkingLevel ?? "off"}
                  options={thinkingOptions}
                  onChange={(id) => actions.setThinkingLevel(id)}
                />
              </Row>
              <Row label={t("settings.omp.model")}>
                <span className="font-mono text-[12px] text-zinc-500 dark:text-zinc-400">
                  {s?.model ? `${s.model.provider}/${s.model.id}` : "—"}
                </span>
              </Row>
            </Section>
            <Section title="Retry & Fallback">
              <Row label={t("settings.omp.autoRetry")} hint={t("settings.omp.autoRetryHint")}>
                <Toggle
                  checked={autoRetry}
                  onChange={(v) => {
                    onAutoRetryChange(v);
                    actions.setAutoRetry(v);
                  }}
                  label={t("settings.omp.autoRetry")}
                />
              </Row>
            </Section>
          </>
        )}

        {tab === "interaction" && (
          <Section title="Input">
            <Row label={t("settings.omp.steering")}>
              <Select
                value={s?.steeringMode ?? "one-at-a-time"}
                options={queueOptions}
                onChange={(id) => actions.setSteeringMode(id as "all" | "one-at-a-time")}
              />
            </Row>
            <Row label={t("settings.omp.followUp")}>
              <Select
                value={s?.followUpMode ?? "one-at-a-time"}
                options={queueOptions}
                onChange={(id) => actions.setFollowUpMode(id as "all" | "one-at-a-time")}
              />
            </Row>
            <Row label={t("settings.omp.interrupt")}>
              <Select
                value={s?.interruptMode ?? "immediate"}
                options={interruptOptions}
                onChange={(id) => actions.setInterruptMode(id as "immediate" | "wait")}
              />
            </Row>
          </Section>
        )}

        {tab === "context" && (
          <Section title="Compaction">
            <Row label={t("settings.omp.autoCompaction")} hint={t("settings.omp.autoCompactionHint")}>
              <Toggle
                checked={Boolean(s?.autoCompactionEnabled)}
                onChange={(v) => actions.setAutoCompaction(v)}
                label={t("settings.omp.autoCompaction")}
              />
            </Row>
            <Row label={t("settings.omp.compactNow")}>
              <button
                type="button"
                onClick={() => actions.compact()}
                disabled={!agentReady || Boolean(s?.isCompacting)}
                className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 hover:border-accent hover:text-accent disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
              >
                {s?.isCompacting ? t("settings.omp.compacting") : t("settings.omp.compactNow")}
              </button>
            </Row>
          </Section>
        )}

        {tab === "providers" && (
          <Section title="Services">
            <Row label={t("settings.omp.fastMode")} hint={t("settings.omp.fastModeHint")}>
              <Toggle
                checked={Boolean(s?.fastModeEnabled)}
                onChange={(v) => actions.setFastMode(v)}
                label={t("settings.omp.fastMode")}
              />
            </Row>
          </Section>
        )}

        {tab === "session" && (
        <Section title="Session">
          <Row label={t("settings.omp.sessionName")}>
            <input
              value={nameDraft ?? sessionName ?? ""}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                if (nameDraft != null && nameDraft.trim() && nameDraft.trim() !== sessionName) {
                  actions.renameSession(nameDraft.trim());
                }
                setNameDraft(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              placeholder="—"
              className="w-44 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-[12.5px] outline-none focus:border-accent dark:border-zinc-700 dark:bg-zinc-900"
            />
          </Row>
          <Row label={t("settings.omp.sessionId")}>
            <span className="font-mono text-[12px] text-zinc-500 dark:text-zinc-400">{sessionId ?? "—"}</span>
          </Row>
          <Row label={t("settings.omp.sessionFile")}>
            <span
              className="block max-w-52 truncate font-mono text-[11.5px] text-zinc-400 dark:text-zinc-500"
              title={activePath ?? ""}
            >
              {activePath ?? "—"}
            </span>
          </Row>
          <Row label={t("settings.omp.exportHtml")} hint={t("settings.omp.exportHint")}>
            <button
              type="button"
              onClick={actions.exportHtml}
              disabled={!agentReady}
              className="rounded-lg border border-zinc-200 px-2.5 py-1 text-[12px] font-medium text-zinc-600 hover:border-accent hover:text-accent disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
            >
              {t("settings.omp.exportHtml")}
            </button>
          </Row>
        </Section>
        )}
      </div>
    </div>
  );
}
