const READ_ONLY_AGENT_DENIED_TOOLS = [
    "bash",
    "powershell",
    "shell",
    "edit",
    "create",
    "write",
    "apply_patch",
    "openagent_bootstrap_task",
    "openagent_plan_note",
    "openagent_workspace_note",
    "openagent_route_phase",
    "openagent_delegate",
    "openagent_background_register",
    "openagent_background_update",
    "openagent_background_cancel",
    "openagent_safe_edit",
    "openagent_ast_replace",
    "openagent_lsp_rename",
    "openagent_task_create",
    "openagent_task_update",
];
const NO_EDIT_AGENT_DENIED_TOOLS = [
    "edit",
    "create",
    "write",
    "apply_patch",
    "openagent_bootstrap_task",
    "openagent_background_register",
    "openagent_background_update",
    "openagent_background_cancel",
    "openagent_safe_edit",
    "openagent_ast_replace",
    "openagent_lsp_rename",
    "openagent_task_create",
    "openagent_task_update",
];
const DEFAULT_AGENT_MODEL_CONFIGS = {
    "openagent-orchestrator": {
        reasoningEffort: "high",
        fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }],
    },
    "openagent-planner": {
        reasoningEffort: "high",
        deniedTools: ["bash", "powershell", "shell", "edit", "create", "write", "apply_patch"],
        fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }],
    },
    "openagent-critic": {
        preferredModel: "claude-sonnet-4",
        reasoningEffort: "high",
        deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
        fallbackModels: [{ model: "gpt-5.4", reasoningEffort: "high" }, { model: "gpt-4.1" }],
    },
    "openagent-explorer": {
        preferredModel: "gpt-5.4-mini",
        reasoningEffort: "low",
        deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
        fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }],
    },
    "openagent-implementer": {
        reasoningEffort: "medium",
        fallbackModels: [{ model: "gpt-4.1" }, { model: "claude-sonnet-4" }],
    },
    "openagent-reviewer": {
        reasoningEffort: "high",
        deniedTools: ["edit", "create", "write", "apply_patch", "bash", "powershell", "shell"],
        fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }],
    },
    "openagent-oracle": {
        preferredModel: "gpt-5.4",
        reasoningEffort: "high",
        deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
        fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }],
    },
    "openagent-qa": {
        preferredModel: "claude-sonnet-4",
        reasoningEffort: "medium",
        deniedTools: [...NO_EDIT_AGENT_DENIED_TOOLS],
        fallbackModels: [{ model: "gpt-5.4", reasoningEffort: "medium" }, { model: "gpt-4.1" }],
    },
    "openagent-researcher": {
        reasoningEffort: "medium",
        deniedTools: ["edit", "create", "write", "apply_patch"],
        fallbackModels: [{ model: "gpt-4.1" }, { model: "claude-sonnet-4" }],
    },
};
function cloneModelTarget(target) {
    return {
        model: target.model,
        reasoningEffort: target.reasoningEffort,
    };
}
function cloneModelTargets(targets) {
    return targets ? targets.map((target) => cloneModelTarget(target)) : undefined;
}
function getModelTargetKey(target) {
    return `${target.model}::${target.reasoningEffort ?? "default"}`;
}
function getCurrentTargetIndex(chain, currentTarget) {
    const exactKey = getModelTargetKey(currentTarget);
    const exactIndex = chain.findIndex((target) => getModelTargetKey(target) === exactKey);
    if (exactIndex >= 0) {
        return exactIndex;
    }
    return chain.findIndex((target) => target.model === currentTarget.model);
}
export async function switchSessionModelTarget(session, target) {
    try {
        await session.rpc.model.switchTo({
            modelId: target.model,
            reasoningEffort: target.reasoningEffort,
        });
        return true;
    }
    catch {
        // Fall through to session.setModel.
    }
    try {
        await session.setModel(target.model, {
            reasoningEffort: target.reasoningEffort,
        });
        return true;
    }
    catch {
        return false;
    }
}
export function getAgentModelConfig(agentName, userOverrides) {
    const base = DEFAULT_AGENT_MODEL_CONFIGS[agentName];
    const override = userOverrides?.[agentName];
    if (!override) {
        return {
            ...base,
            allowedTools: base.allowedTools ? [...base.allowedTools] : undefined,
            deniedTools: base.deniedTools ? [...base.deniedTools] : undefined,
            fallbackModels: cloneModelTargets(base.fallbackModels),
            promptAppend: base.promptAppend,
        };
    }
    return {
        preferredModel: override.preferredModel ?? base.preferredModel,
        reasoningEffort: override.reasoningEffort ?? base.reasoningEffort,
        allowedTools: override.allowedTools ?? (base.allowedTools ? [...base.allowedTools] : undefined),
        deniedTools: override.deniedTools ?? (base.deniedTools ? [...base.deniedTools] : undefined),
        fallbackModels: override.fallbackModels ?? cloneModelTargets(base.fallbackModels),
        promptAppend: override.promptAppend ?? base.promptAppend,
    };
}
export async function applyAgentModelConfig(session, agentName, userOverrides) {
    const config = getAgentModelConfig(agentName, userOverrides);
    if (config.preferredModel) {
        const switched = await switchSessionModelTarget(session, {
            model: config.preferredModel,
            reasoningEffort: config.reasoningEffort,
        });
        if (switched) {
            return;
        }
    }
    if (config.reasoningEffort) {
        try {
            const currentModel = await session.rpc.model.getCurrent();
            if (currentModel.modelId) {
                await session.rpc.model.switchTo({
                    modelId: currentModel.modelId,
                    reasoningEffort: config.reasoningEffort,
                });
                return;
            }
        }
        catch {
            // RPC method unavailable; try session.setModel as fallback.
        }
        try {
            const currentModel = await session.rpc.model.getCurrent();
            if (currentModel.modelId) {
                await session.setModel(currentModel.modelId, {
                    reasoningEffort: config.reasoningEffort,
                });
            }
        }
        catch {
            // Reasoning effort not supported on this host; skip gracefully.
        }
    }
}
export function getAgentDeniedTools(agentName, userOverrides) {
    const config = getAgentModelConfig(agentName, userOverrides);
    return config.deniedTools ?? [];
}
export function isToolDeniedForAgent(toolName, agentName, userOverrides) {
    const config = getAgentModelConfig(agentName, userOverrides);
    if (config.allowedTools && config.allowedTools.length > 0) {
        return !config.allowedTools.includes(toolName);
    }
    return (config.deniedTools ?? []).includes(toolName);
}
export function getFallbackChain(agentName, userOverrides) {
    const config = getAgentModelConfig(agentName, userOverrides);
    return cloneModelTargets(config.fallbackModels) ?? [];
}
export function getNextFallbackModel(agentName, currentTarget, userOverrides) {
    const chain = getFallbackChain(agentName, userOverrides);
    if (chain.length === 0) {
        return null;
    }
    if (currentTarget === null) {
        return chain[0] ? cloneModelTarget(chain[0]) : null;
    }
    const currentIndex = getCurrentTargetIndex(chain, currentTarget);
    if (currentIndex === -1) {
        return chain[0] ? cloneModelTarget(chain[0]) : null;
    }
    const nextIndex = currentIndex + 1;
    return nextIndex < chain.length && chain[nextIndex]
        ? cloneModelTarget(chain[nextIndex])
        : null;
}
