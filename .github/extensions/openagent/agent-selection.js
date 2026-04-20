import { applyAgentModelConfig } from "./agent-models.js";
import { isOpenAgentAgentName } from "./config.js";
import { setCurrentAgentName } from "./hooks.js";
import { syncFallbackState } from "./model-fallback.js";
export async function syncOpenAgentAgentState(args) {
    const { session, agentName, config } = args;
    setCurrentAgentName(agentName);
    await applyAgentModelConfig(session, agentName, config.agentOverrides);
    try {
        const currentModel = await session.rpc.model.getCurrent();
        syncFallbackState(agentName, currentModel.modelId ?? null);
    }
    catch {
        syncFallbackState(agentName, null);
    }
}
export async function selectOpenAgentAgent(args) {
    const { session, agentName, config } = args;
    const result = await session.rpc.agent.select({ name: agentName });
    await syncOpenAgentAgentState({ session, agentName, config });
    return result;
}
export async function initializeOpenAgentAgentState(args) {
    const { session, config } = args;
    const current = await session.rpc.agent.getCurrent();
    const currentAgentName = current.agent?.name;
    if (!currentAgentName || !isOpenAgentAgentName(currentAgentName)) {
        return null;
    }
    await syncOpenAgentAgentState({
        session,
        agentName: currentAgentName,
        config,
    });
    return currentAgentName;
}
