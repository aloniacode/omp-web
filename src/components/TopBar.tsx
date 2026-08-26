import { Button, Dropdown } from "@heroui/react";
import { useStore } from "../state/store";
import type { ModelInfo } from "../rpc/types";
import { THINKING_LEVELS } from "../rpc/types";
import { fmtCost, fmtPercent, fmtTokens } from "../lib/format";
import {
  IconBrain,
  IconChevronDown,
  IconLayers,
  IconPanelLeft,
} from "./icons";

function modelLabel(model: ModelInfo | undefined): string {
  if (!model) return "model";
  return `${model.provider}/${model.id}`;
}

function ContextMeter() {
  const { state } = useStore();
  const usage = state.stats?.contextUsage ?? state.agentState?.contextUsage;
  if (!usage || !usage.contextWindow) return null;
  const pct = Math.min(usage.percent, 100);
  const tone =
    usage.percent >= 90
      ? "bg-red-500"
      : usage.percent >= 70
        ? "bg-amber-500"
        : "bg-accent";
  return (
    <div
      className="hidden items-center gap-2 lg:flex"
      title={`Context: ${fmtTokens(usage.tokens)} / ${fmtTokens(usage.contextWindow)} tokens (${fmtPercent(usage.percent)})`}
    >
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
        {fmtPercent(usage.percent)}
      </span>
    </div>
  );
}

function TotalsChips() {
  const { state } = useStore();
  if (!state.stats) return null;
  return (
    <div className="hidden items-center gap-3 sm:flex" title="Conversation token totals (get_session_stats)">
      <span className="text-[11.5px] tabular-nums text-zinc-400 dark:text-zinc-500" title={`${state.stats.tokens.total} total tokens`}>
        {fmtTokens(state.stats.tokens.total)} tok
      </span>
      <span className="text-[11.5px] tabular-nums text-zinc-400 dark:text-zinc-500" title="estimated conversation cost">
        {fmtCost(state.stats.cost)}
      </span>
    </div>
  );
}

function ModelPicker() {
  const { state, actions } = useStore();
  const current = state.agentState?.model;
  const models = state.models.slice(0, 400);
  return (
    <Dropdown>
      <Button
        variant="secondary"
        className="h-8 max-w-[220px] min-w-0 gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-[12.5px] font-medium data-[hover=true]:border-accent dark:border-zinc-700 dark:data-[hover=true]:border-accent"
      >
        <span className="truncate">{modelLabel(current)}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            const model = models[Number(key)];
            if (model) actions.setModel(model.provider, model.id);
          }}
          className="max-h-96 overflow-y-auto"
        >
          {models.map((model, index) => (
            <Dropdown.Item
              key={String(index)}
              id={String(index)}
              textValue={modelLabel(model)}
              className={current && current.provider === model.provider && current.id === model.id ? "data-[selected=true]:bg-accent/10 dark:data-[selected=true]:bg-accent/15" : ""}
            >
              <span className="flex items-center justify-between gap-4">
                <span className="truncate font-mono text-[12px]">{modelLabel(model)}</span>
                {current && current.provider === model.provider && current.id === model.id && (
                  <span className="text-accent">●</span>
                )}
              </span>
            </Dropdown.Item>
          ))}
          {models.length === 0 && (
            <Dropdown.Item key="loading" id="loading" textValue="loading models" isDisabled>
              {state.modelsLoaded ? "No models available" : "Loading model catalog…"}
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

function ThinkingPicker() {
  const { state, actions } = useStore();
  const current = state.agentState?.thinkingLevel;
  return (
    <Dropdown>
      <Button
        className="h-8 gap-1.5 rounded-lg border border-zinc-200 px-2.5 text-[12.5px] font-medium capitalize data-[hover=true]:border-accent dark:border-zinc-700 dark:data-[hover=true]:border-accent"
      >
        <IconBrain size={14} className="text-accent/80" />
        <span className="capitalize">{current ?? "thinking"}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Button>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => actions.setThinkingLevel(String(key))}
        >
          {THINKING_LEVELS.map((level) => (
            <Dropdown.Item
              key={level}
              id={level}
              textValue={level}
              className="capitalize"
            >
              <span className="flex items-center justify-between gap-4 capitalize">
                {level}
                {current === level && <span className="text-accent">●</span>}
              </span>
            </Dropdown.Item>
          ))}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { state, actions } = useStore();
  const streaming = Boolean(state.agentState?.isStreaming) || state.streamingMsg !== null;
  const compacting = Boolean(state.agentState?.isCompacting);
  const queued = state.agentState?.queuedMessageCount ?? 0;

  const title =
    state.sessionName ??
    (state.sessionId ? `Session ${state.sessionId.slice(0, 8)}` : "New conversation");

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-zinc-200 bg-white px-3 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/80">
      <button
        type="button"
        onClick={onToggleSidebar}
        className="rounded-md p-2 text-zinc-500 hover:bg-zinc-100 md:hidden dark:text-zinc-400 dark:hover:bg-zinc-800"
        title="Toggle sidebar"
      >
        <IconPanelLeft size={16} />
      </button>

      <h1 className="min-w-0 flex-1 truncate text-[14px] font-medium text-zinc-800 dark:text-zinc-100">
        {title}
        {queued > 0 && (
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
            {queued} queued
          </span>
        )}
        {streaming && (
          <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-[11px] font-normal text-emerald-600 dark:text-emerald-400">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-emerald-500" />
            streaming{state.agentState?.tokensPerSecond ? ` · ${Math.round(state.agentState.tokensPerSecond)} tok/s` : ""}
          </span>
        )}
      </h1>

      <ContextMeter />
      <TotalsChips />

      <button
        type="button"
        onClick={actions.compact}
        disabled={!state.agentReady || compacting}
        title="Compact context (/compact)"
        className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-800"
      >
        <IconLayers size={15} className={compacting ? "animate-pulse" : undefined} />
      </button>

      <ThinkingPicker />
      <ModelPicker />
    </header>
  );
}
