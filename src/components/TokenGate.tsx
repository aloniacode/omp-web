import { useState } from "react";
import { KeyRound as IconKey } from "lucide-react";
import { useActions, type TokenSubmitResult } from "../state/store";
import { useI18n } from "../i18n";

/**
 * Blocking gate shown when the bridge rejected the access token (401 on
 * /api/*). The token comes from the bridge console (or ~/.omp/web-bridge-token);
 * successful submission unblocks the UI without a reload.
 */
export function TokenGate() {
  const actions = useActions();
  const { t } = useI18n();
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<TokenSubmitResult | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!token.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    const result = await actions.submitToken(token);
    setSubmitting(false);
    if (result !== "ok") setError(result);
  };

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto bg-zinc-50 px-4 py-10 dark:bg-zinc-950">
      <form
        onSubmit={submit}
        className="w-full max-w-lg rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <IconKey size={17} />
          </div>
          <div>
            <h1 className="text-[16px] font-semibold text-zinc-900 dark:text-zinc-50">{t("auth.title")}</h1>
            <p className="text-[12.5px] text-zinc-500 dark:text-zinc-400">{t("auth.subtitle")}</p>
          </div>
        </div>

        <p className="mt-4 text-[13px] leading-relaxed text-zinc-600 dark:text-zinc-300">{t("auth.body")}</p>

        <input
          type="text"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t("auth.placeholder")}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="mt-4 w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 font-mono text-[13px] text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-accent dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-100"
        />

        {error && <p className="mt-2 text-[12.5px] text-rose-500">{t(error === "storage" ? "auth.storage" : "auth.invalid")}</p>}

        <button
          type="submit"
          disabled={submitting || !token.trim()}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-[13.5px] font-medium text-accent-foreground transition-colors hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting && (
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          )}
          {submitting ? t("auth.submitting") : t("auth.submit")}
        </button>
      </form>
    </div>
  );
}
