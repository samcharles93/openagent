import type { OpenAgentAgentModelConfig } from "./agent-models";
import { getFallbackChain, getNextFallbackModel } from "./agent-models";
import {
  formatModelTarget,
  type OpenAgentAgentName,
  type OpenAgentModelTarget,
} from "./config";
import { recordFallbackSwitch } from "./telemetry";

export type ModelFallbackState = {
  agentName: string;
  originalModel: OpenAgentModelTarget | null;
  attemptedModels: OpenAgentModelTarget[];
  currentFallback: OpenAgentModelTarget | null;
  exhausted: boolean;
};

const fallbackStates = new Map<string, ModelFallbackState>();

export function initFallbackState(
  agentName: OpenAgentAgentName,
  currentModel: OpenAgentModelTarget | null,
): void {
  fallbackStates.set(agentName, {
    agentName,
    originalModel: currentModel,
    attemptedModels: currentModel !== null ? [currentModel] : [],
    currentFallback: null,
    exhausted: false,
  });
}

export function syncFallbackState(
  agentName: OpenAgentAgentName,
  currentModelId: string | null,
): void {
  initFallbackState(
    agentName,
    currentModelId !== null ? { model: currentModelId } : null,
  );
}

export function advanceFallback(
  agentName: OpenAgentAgentName,
  config?: {
    currentModelId?: string | null;
    userOverrides?: Record<string, OpenAgentAgentModelConfig>;
  },
): { target: OpenAgentModelTarget; exhausted: boolean } | null {
  let state = fallbackStates.get(agentName);

  if (!state) {
    initFallbackState(
      agentName,
      config?.currentModelId ? { model: config.currentModelId } : null,
    );
    state = fallbackStates.get(agentName)!;
  }

  if (!state.originalModel && config?.currentModelId) {
    state.originalModel = { model: config.currentModelId };
    state.attemptedModels = [{ model: config.currentModelId }];
  }

  if (state.exhausted) {
    return null;
  }

  const lastAttempted = state.currentFallback ?? state.originalModel;
  const nextTarget = getNextFallbackModel(
    agentName,
    lastAttempted,
    config?.userOverrides,
  );

  if (nextTarget === null) {
    state.exhausted = true;
    return null;
  }

  state.attemptedModels.push(nextTarget);
  state.currentFallback = nextTarget;
  recordFallbackSwitch(agentName, nextTarget);

  const chain = getFallbackChain(agentName, config?.userOverrides);
  const nextIndex = chain.findIndex(
    (target) =>
      target.model === nextTarget.model &&
      target.reasoningEffort === nextTarget.reasoningEffort,
  );
  const isLast = nextIndex === chain.length - 1;

  return { target: nextTarget, exhausted: isLast };
}

export function getFallbackState(
  agentName: OpenAgentAgentName,
): ModelFallbackState | undefined {
  return fallbackStates.get(agentName);
}

export function formatFallbackStatus(): string {
  if (fallbackStates.size === 0) {
    return "Model fallback: no active fallback states.";
  }

  const lines: string[] = ["Model fallback states:"];

  for (const [agentName, state] of fallbackStates) {
    const status = state.exhausted
      ? "exhausted"
      : state.currentFallback
        ? `active (${formatModelTarget(state.currentFallback)})`
        : "idle";
    lines.push(
      `  ${agentName}: ${status} | attempted: [${state.attemptedModels
        .map((target) => formatModelTarget(target))
        .join(", ")}]`,
    );
  }

  return lines.join("\n");
}

export function resetAllFallbackStates(): void {
  fallbackStates.clear();
}
