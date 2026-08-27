import { Dropdown } from "@heroui/react";

import { useStore } from "../state/store";
import { useI18n } from "../i18n";
import type { ModelInfo } from "../rpc/types";
import { THINKING_LEVELS } from "../rpc/types";
import { IconBrain, IconChevronDown } from "./icons";

export function modelLabel(model: ModelInfo | undefined): string {
  if (!model) return "model";
  return `${model.provider}/${model.id}`;
}

/** Model switcher (get_available_models → set_model). */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const { t } = useI18n();
  const current = state.agentState?.model;
  const models = state.models.slice(0, 400);
  return (
    <Dropdown>
      <Dropdown.Trigger
        className={`flex ${compact ? "h-7 max-w-[190px]" : "h-8 max-w-[220px]"} min-w-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12.5px] font-medium text-zinc-700 hover:border-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200`}
      >
        <span className="truncate">{modelLabel(current)}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu
          onAction={(key) => {
            const model = models[Number(key)];
            if (model) actions.setModel(model.provider, model.id);
          }}
          className="max-h-96 overflow-y-auto"
        >
          {models.map((model, index) => (
            <Dropdown.Item key={String(index)} id={String(index)} textValue={modelLabel(model)}>
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
              {state.modelsLoaded ? t("picker.noModels") : t("picker.loadingModels")}
            </Dropdown.Item>
          )}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}

/** Thinking level switcher (set_thinking_level). */
export function ThinkingPicker({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const current = state.agentState?.thinkingLevel;
  return (
    <Dropdown>
      <Dropdown.Trigger
        className={`flex ${compact ? "h-7" : "h-8"} items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 text-[12.5px] font-medium capitalize text-zinc-700 hover:border-accent dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200`}
      >
        <IconBrain size={14} className="text-accent/80" />
        <span className="capitalize">{current ?? "thinking"}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Dropdown.Trigger>
      <Dropdown.Popover>
        <Dropdown.Menu onAction={(key) => actions.setThinkingLevel(String(key))}>
          {THINKING_LEVELS.map((level) => (
            <Dropdown.Item key={level} id={level} textValue={level}>
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
