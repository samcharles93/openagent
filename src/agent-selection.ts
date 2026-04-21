import type { CopilotSession } from "@github/copilot-sdk";
import { applyAgentModelConfig } from "./agent-models";
import type { OpenAgentAgentName, OpenAgentConfig } from "./config";
import { isOpenAgentAgentName } from "./config";
import { setCurrentAgentName } from "./hooks";
import { syncFallbackState } from "./model-fallback";

export async function syncOpenAgentAgentState(args: {
  session: CopilotSession;
  agentName: OpenAgentAgentName;
  config: OpenAgentConfig;
}): Promise<void> {
  const { session, agentName, config } = args;
  setCurrentAgentName(agentName);
  await applyAgentModelConfig(session, agentName, config.agentOverrides);
  try {
    const currentModel = await session.rpc.model.getCurrent();
    syncFallbackState(agentName, currentModel.modelId ?? null);
  } catch {
    syncFallbackState(agentName, null);
  }
}

export async function selectOpenAgentAgent(args: {
  session: CopilotSession;
  agentName: OpenAgentAgentName;
  config: OpenAgentConfig;
}) {
  const { session, agentName, config } = args;
  const result = await session.rpc.agent.select({ name: agentName });
  await syncOpenAgentAgentState({ session, agentName, config });
  return result;
}

export async function initializeOpenAgentAgentState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<OpenAgentAgentName | null> {
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
