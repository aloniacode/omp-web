import { useState } from "react";
import { useStore } from "../state/store";
import { useI18n } from "../i18n";
import { IconCheck, IconCopy } from "./icons";

const INSTALL_OPTIONS: Array<{ label: string; command: string; note?: string }> = [
  { label: "Windows (PowerShell)", command: "irm https://omp.sh/install.ps1 | iex" },
  { label: "macOS / Linux", command: "curl -fsSL https://omp.sh/install | sh" },
  { label: "Homebrew", command: "brew install can1357/tap/omp" },
  { label: "Bun", command: "bun install -g @oh-my-pi/pi-coding-agent" },
  { label: "npm", command: "npm i -g @oh-my-pi/pi-coding-agent" },
];

function InstallRow({ label, command }: { label: string; command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — user can select the text manually
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800/60">
      <span className="w-36 shrink-0 text-[12px] font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-[12px] text-zinc-700 dark:text-zinc-200">
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        title="复制命令 Copy command"
        className="shrink-0 rounded-md p-1.5 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
      >
        {copied ? <IconCheck size={13} className="text-emerald-500" /> : <IconCopy size={13} />}
      </button>
    </div>
  );
}

/** Blocking setup screen shown when the bridge cannot find the omp binary. */
export function SetupGuide() {
  const { state, actions } = useStore();
  const { t } = useI18n();
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    await actions.recheckHealth();
    setChecking(false);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <div className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-[15px] font-bold text-accent-foreground">
            π
          </div>
          <div>
<h1 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-50">{t("setup.title")}</h1>
<p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{t("setup.subtitle")}</p>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">
          {t("setup.body", {
            omp: "omp",
            cwd: state.health?.ompCwd || "—",
            bin: "OMP_BIN",
          })}
        </p>

        <div className="mt-4 space-y-2">
          {INSTALL_OPTIONS.map((option) => (
            <InstallRow key={option.label} {...option} />
          ))}
        </div>

        <p className="mt-4 text-[12px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          {t("setup.afterInstall", { omp: "omp" })}
        </p>

        <button
          type="button"
          onClick={recheck}
          disabled={checking}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {checking && (
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {checking ? t("setup.rechecking") : t("setup.recheck")}
        </button>
      </div>
    </div>
  );
}
