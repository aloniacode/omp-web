import { Dropdown } from "@heroui/react";
import type { ReactNode } from "react";

import { useStore } from "../state/store";
import { useI18n } from "../i18n";
import type { ModelInfo } from "../rpc/types";
import { THINKING_LEVELS } from "../rpc/types";
import { IconChevronDown } from "./icons";

/**
 * Dropdown.Section passes props through to react-aria's MenuSection, whose
 * `title` (ReactNode) works at runtime but is missing from HeroUI's d.ts.
 */
const MenuSection = Dropdown.Section as (props: { title?: ReactNode; children: ReactNode }) => ReactNode;

function sectionTitle(text: string) {
  return <span className="text-[10.5px] font-semibold uppercase tracking-wider text-zinc-400">{text}</span>;
}

export function modelLabel(model: ModelInfo | undefined): string {
  if (!model) return "model";
  return `${model.provider}/${model.id}`;
}

/**
 * Model switcher with an inline thinking-level section
 * (get_available_models → set_model / set_thinking_level).
 */
export function ModelPicker({ compact = false }: { compact?: boolean }) {
  const { state, actions } = useStore();
  const { t } = useI18n();
  const current = state.agentState?.model;
  const currentLevel = state.agentState?.thinkingLevel;
  const models = state.models.slice(0, 400);
  return (
    <Dropdown>
      <Dropdown.Trigger
        className={`flex ${compact ? "h-7 max-w-[210px]" : "h-8 max-w-[240px]"} min-w-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200`}
      >
        <span className="truncate">{modelLabel(current)}</span>
        <IconChevronDown size={13} className="shrink-0 opacity-50" />
      </Dropdown.Trigger>
      <Dropdown.Popover placement="top start">
        <Dropdown.Menu
          onAction={(key) => {
            const id = String(key);
            if (id.startsWith("t:")) {
              actions.setThinkingLevel(id.slice(2));
              return;
            }
            const model = models[Number(id.slice(2))];
            if (model) actions.setModel(model.provider, model.id);
          }}
          className="max-h-96 overflow-y-auto"
        >
          <MenuSection title={sectionTitle(t("picker.models"))}>
            {models.map((model, index) => (
              <Dropdown.Item key={`m:${index}`} id={`m:${index}`} textValue={modelLabel(model)}>
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
          </MenuSection>
          <MenuSection title={sectionTitle(t("picker.thinking"))}>
            {THINKING_LEVELS.map((level) => (
              <Dropdown.Item key={`t:${level}`} id={`t:${level}`} textValue={level}>
                <span className="flex items-center justify-between gap-4 capitalize">
                  {level}
                  {currentLevel === level && <span className="text-accent">●</span>}
                </span>
              </Dropdown.Item>
            ))}
          </MenuSection>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
  );
}
