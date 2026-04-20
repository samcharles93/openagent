import { getFallbackChain, getNextFallbackModel } from "./agent-models.js";
import { formatModelTarget, } from "./config.js";
import { recordFallbackSwitch } from "./telemetry.js";
const fallbackStates = new Map();
export function initFallbackState(agentName, currentModel) {
    fallbackStates.set(agentName, {
        agentName,
        originalModel: currentModel,
        attemptedModels: currentModel !== null ? [currentModel] : [],
        currentFallback: null,
        exhausted: false,
    });
}
export function syncFallbackState(agentName, currentModelId) {
    initFallbackState(agentName, currentModelId !== null ? { model: currentModelId } : null);
}
export function advanceFallback(agentName, config) {
    let state = fallbackStates.get(agentName);
    if (!state) {
        initFallbackState(agentName, config?.currentModelId ? { model: config.currentModelId } : null);
        state = fallbackStates.get(agentName);
    }
    if (!state.originalModel && config?.currentModelId) {
        state.originalModel = { model: config.currentModelId };
        state.attemptedModels = [{ model: config.currentModelId }];
    }
    if (state.exhausted) {
        return null;
    }
    const lastAttempted = state.currentFallback ?? state.originalModel;
    const nextTarget = getNextFallbackModel(agentName, lastAttempted, config?.userOverrides);
    if (nextTarget === null) {
        state.exhausted = true;
        return null;
    }
    state.attemptedModels.push(nextTarget);
    state.currentFallback = nextTarget;
    recordFallbackSwitch(agentName, nextTarget);
    const chain = getFallbackChain(agentName, config?.userOverrides);
    const nextIndex = chain.findIndex((target) => target.model === nextTarget.model &&
        target.reasoningEffort === nextTarget.reasoningEffort);
    const isLast = nextIndex === chain.length - 1;
    return { target: nextTarget, exhausted: isLast };
}
export function getFallbackState(agentName) {
    return fallbackStates.get(agentName);
}
export function formatFallbackStatus() {
    if (fallbackStates.size === 0) {
        return "Model fallback: no active fallback states.";
    }
    const lines = ["Model fallback states:"];
    for (const [agentName, state] of fallbackStates) {
        const status = state.exhausted
            ? "exhausted"
            : state.currentFallback
                ? `active (${formatModelTarget(state.currentFallback)})`
                : "idle";
        lines.push(`  ${agentName}: ${status} | attempted: [${state.attemptedModels
            .map((target) => formatModelTarget(target))
            .join(", ")}]`);
    }
    return lines.join("\n");
}
export function resetAllFallbackStates() {
    fallbackStates.clear();
}
