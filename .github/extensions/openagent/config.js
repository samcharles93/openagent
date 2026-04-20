import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "jsonc-parser";
export const OPENAGENT_AGENT_NAMES = [
    "openagent-orchestrator",
    "openagent-planner",
    "openagent-critic",
    "openagent-researcher",
    "openagent-explorer",
    "openagent-implementer",
    "openagent-reviewer",
    "openagent-oracle",
    "openagent-qa",
];
const DEFAULT_CONFIG = {
    autoSelectAgent: true,
    defaultAgent: "openagent-orchestrator",
    systemDirectives: [
        "Plan before heavy implementation work.",
        "Prefer precise, tool-backed reasoning over speculation.",
        "Keep durable notes in the session workspace when they can help future turns.",
    ],
    planningKeywords: [
        "plan",
        "architecture",
        "design",
        "implement",
        "refactor",
        "debug",
        "investigate",
        "migration",
        "scaffold",
    ],
    ultraworkAliases: ["ultrawork", "ulw"],
    guardrails: {
        dangerousShellPatterns: [
            "rm\\s+-rf\\b",
            "git\\s+reset\\s+--hard\\b",
            "git\\s+clean\\s+-fd\\b",
            "Remove-Item\\b.*-Recurse\\b.*-Force\\b",
            "del\\s+/f\\s+/s\\s+/q\\b",
        ],
        truncateToolResultsOver: 12000,
    },
    workspace: {
        notesDirectory: "openagent",
    },
    agentOverrides: {},
    agents: {},
    categories: {},
    disabledAgents: [],
    disabledHooks: [],
    disabledTools: [],
    disabledCommands: [],
};
function cloneDefaultConfig() {
    return {
        ...DEFAULT_CONFIG,
        systemDirectives: [...DEFAULT_CONFIG.systemDirectives],
        planningKeywords: [...DEFAULT_CONFIG.planningKeywords],
        ultraworkAliases: [...DEFAULT_CONFIG.ultraworkAliases],
        guardrails: {
            ...DEFAULT_CONFIG.guardrails,
            dangerousShellPatterns: [...DEFAULT_CONFIG.guardrails.dangerousShellPatterns],
        },
        workspace: {
            ...DEFAULT_CONFIG.workspace,
        },
        agentOverrides: {},
        agents: {},
        categories: {},
        disabledAgents: [],
        disabledHooks: [],
        disabledTools: [],
        disabledCommands: [],
    };
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function uniqueStrings(values) {
    return [...new Set(values)];
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const normalized = value
        .filter((entry) => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    return normalized.length > 0 ? uniqueStrings(normalized) : undefined;
}
function normalizeReasoningEffort(value) {
    return value === "low" || value === "medium" || value === "high"
        ? value
        : undefined;
}
function modelTargetKey(target) {
    return `${target.model}::${target.reasoningEffort ?? "default"}`;
}
function normalizeModelTarget(value) {
    if (typeof value === "string" && value.trim().length > 0) {
        return { model: value.trim() };
    }
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.model !== "string" || value.model.trim().length === 0) {
        return null;
    }
    const target = {
        model: value.model.trim(),
    };
    const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
    if (reasoningEffort) {
        target.reasoningEffort = reasoningEffort;
    }
    return target;
}
function normalizeModelTargetArray(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const seen = new Set();
    const normalized = [];
    for (const entry of value) {
        const target = normalizeModelTarget(entry);
        if (!target) {
            continue;
        }
        const key = modelTargetKey(target);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(target);
    }
    return normalized.length > 0 ? normalized : undefined;
}
export function formatModelTarget(target) {
    return target.reasoningEffort
        ? `${target.model} (${target.reasoningEffort})`
        : target.model;
}
export function formatModelTargets(targets) {
    return targets.length > 0
        ? targets.map((target) => formatModelTarget(target)).join(" -> ")
        : "none";
}
function normalizePositiveInteger(value, fallback, minimum) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < minimum) {
        return fallback;
    }
    return value;
}
function normalizeAgentName(value) {
    if (typeof value === "string" && isOpenAgentAgentName(value)) {
        return value;
    }
    return undefined;
}
export function isOpenAgentAgentName(value) {
    return OPENAGENT_AGENT_NAMES.includes(value);
}
function normalizeNotesDirectory(value, fallback) {
    if (typeof value !== "string") {
        return fallback;
    }
    const segments = value
        .replace(/\\/g, "/")
        .split("/")
        .map((segment) => segment.trim())
        .filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.length === 0 || segments.some((segment) => segment === "..")) {
        return fallback;
    }
    return segments.join("/");
}
function resolvePromptFilePath(sourcePath, fileTarget) {
    const expanded = fileTarget.startsWith("~/")
        ? path.join(os.homedir(), fileTarget.slice(2))
        : fileTarget;
    return path.isAbsolute(expanded)
        ? expanded
        : path.resolve(path.dirname(sourcePath), expanded);
}
function resolvePromptText(value, sourcePath) {
    if (typeof value !== "string" || value.trim().length === 0) {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed.startsWith("file://")) {
        return trimmed;
    }
    const fileTarget = trimmed.slice("file://".length).trim();
    if (fileTarget.length === 0) {
        return undefined;
    }
    try {
        return readFileSync(resolvePromptFilePath(sourcePath, fileTarget), "utf8").trim();
    }
    catch {
        return undefined;
    }
}
function readConfigFile(filePath) {
    const content = readFileSync(filePath, "utf8");
    const errors = [];
    const parsed = parse(content, errors, {
        allowTrailingComma: true,
        disallowComments: false,
    });
    if (errors.length > 0 || !isRecord(parsed)) {
        return null;
    }
    return parsed;
}
function applyConfigPatch(base, patch, sourcePath) {
    const next = {
        ...base,
        systemDirectives: [...base.systemDirectives],
        planningKeywords: [...base.planningKeywords],
        ultraworkAliases: [...base.ultraworkAliases],
        guardrails: {
            ...base.guardrails,
            dangerousShellPatterns: [...base.guardrails.dangerousShellPatterns],
        },
        workspace: {
            ...base.workspace,
        },
        agents: { ...base.agents },
        categories: { ...base.categories },
        disabledAgents: [...base.disabledAgents],
        disabledHooks: [...base.disabledHooks],
        disabledTools: [...base.disabledTools],
        disabledCommands: [...base.disabledCommands],
    };
    if (typeof patch.autoSelectAgent === "boolean") {
        next.autoSelectAgent = patch.autoSelectAgent;
    }
    const defaultAgent = normalizeAgentName(patch.defaultAgent);
    if (defaultAgent) {
        next.defaultAgent = defaultAgent;
    }
    const systemDirectives = normalizeStringArray(patch.systemDirectives);
    if (systemDirectives) {
        next.systemDirectives = uniqueStrings([
            ...next.systemDirectives,
            ...systemDirectives,
        ]);
    }
    const planningKeywords = normalizeStringArray(patch.planningKeywords);
    if (planningKeywords) {
        next.planningKeywords = uniqueStrings([
            ...next.planningKeywords,
            ...planningKeywords,
        ]);
    }
    const ultraworkAliases = normalizeStringArray(patch.ultraworkAliases);
    if (ultraworkAliases) {
        next.ultraworkAliases = uniqueStrings([
            ...next.ultraworkAliases,
            ...ultraworkAliases,
        ]);
    }
    if (isRecord(patch.guardrails)) {
        const dangerousShellPatterns = normalizeStringArray(patch.guardrails.dangerousShellPatterns);
        if (dangerousShellPatterns) {
            next.guardrails.dangerousShellPatterns = uniqueStrings([
                ...next.guardrails.dangerousShellPatterns,
                ...dangerousShellPatterns,
            ]);
        }
        next.guardrails.truncateToolResultsOver = normalizePositiveInteger(patch.guardrails.truncateToolResultsOver, next.guardrails.truncateToolResultsOver, 512);
    }
    if (isRecord(patch.workspace)) {
        next.workspace.notesDirectory = normalizeNotesDirectory(patch.workspace.notesDirectory, next.workspace.notesDirectory);
    }
    if (isRecord(patch.agentOverrides)) {
        for (const [agentKey, rawOverride] of Object.entries(patch.agentOverrides)) {
            if (!isRecord(rawOverride)) {
                continue;
            }
            const override = {};
            if (typeof rawOverride.preferredModel === "string" && rawOverride.preferredModel.trim().length > 0) {
                override.preferredModel = rawOverride.preferredModel.trim();
            }
            const overrideReasoningEffort = normalizeReasoningEffort(rawOverride.reasoningEffort);
            if (overrideReasoningEffort) {
                override.reasoningEffort = overrideReasoningEffort;
            }
            const allowedTools = normalizeStringArray(rawOverride.allowedTools);
            if (allowedTools) {
                override.allowedTools = allowedTools;
            }
            const deniedTools = normalizeStringArray(rawOverride.deniedTools);
            if (deniedTools) {
                override.deniedTools = deniedTools;
            }
            const fallbackModels = normalizeModelTargetArray(rawOverride.fallbackModels);
            if (fallbackModels) {
                override.fallbackModels = fallbackModels;
            }
            const promptAppend = resolvePromptText(rawOverride.promptAppend, sourcePath);
            if (promptAppend) {
                override.promptAppend = promptAppend;
            }
            if (Object.keys(override).length > 0) {
                next.agentOverrides[agentKey] = {
                    ...next.agentOverrides[agentKey],
                    ...override,
                };
            }
        }
    }
    if (isRecord(patch.agents)) {
        for (const [agentKey, rawDef] of Object.entries(patch.agents)) {
            if (!isRecord(rawDef)) {
                continue;
            }
            const definition = {};
            if (typeof rawDef.displayName === "string" && rawDef.displayName.trim().length > 0) {
                definition.displayName = rawDef.displayName.trim();
            }
            if (typeof rawDef.description === "string" && rawDef.description.trim().length > 0) {
                definition.description = rawDef.description.trim();
            }
            const prompt = resolvePromptText(rawDef.prompt, sourcePath);
            if (prompt) {
                definition.prompt = prompt;
            }
            if (typeof rawDef.preferredModel === "string" && rawDef.preferredModel.trim().length > 0) {
                definition.preferredModel = rawDef.preferredModel.trim();
            }
            const definitionReasoningEffort = normalizeReasoningEffort(rawDef.reasoningEffort);
            if (definitionReasoningEffort) {
                definition.reasoningEffort = definitionReasoningEffort;
            }
            const allowedTools = normalizeStringArray(rawDef.allowedTools);
            if (allowedTools) {
                definition.allowedTools = allowedTools;
            }
            const deniedTools = normalizeStringArray(rawDef.deniedTools);
            if (deniedTools) {
                definition.deniedTools = deniedTools;
            }
            const fallbackModels = normalizeModelTargetArray(rawDef.fallbackModels);
            if (fallbackModels) {
                definition.fallbackModels = fallbackModels;
            }
            const promptAppend = resolvePromptText(rawDef.promptAppend, sourcePath);
            if (promptAppend) {
                definition.promptAppend = promptAppend;
            }
            if (Object.keys(definition).length > 0) {
                next.agents[agentKey] = {
                    ...next.agents[agentKey],
                    ...definition,
                };
            }
        }
    }
    if (isRecord(patch.categories)) {
        for (const [catKey, rawOverride] of Object.entries(patch.categories)) {
            if (!isRecord(rawOverride)) {
                continue;
            }
            const override = {};
            if (typeof rawOverride.preferredModel === "string" && rawOverride.preferredModel.trim().length > 0) {
                override.preferredModel = rawOverride.preferredModel.trim();
            }
            const categoryFallbackModels = normalizeModelTargetArray(rawOverride.fallbackModels);
            if (categoryFallbackModels) {
                override.fallbackModels = categoryFallbackModels;
            }
            else if (typeof rawOverride.fallbackModel === "string" &&
                rawOverride.fallbackModel.trim().length > 0) {
                override.fallbackModel = rawOverride.fallbackModel.trim();
            }
            const categoryReasoningEffort = normalizeReasoningEffort(rawOverride.reasoningEffort);
            if (categoryReasoningEffort) {
                override.reasoningEffort = categoryReasoningEffort;
            }
            const allowedTools = normalizeStringArray(rawOverride.allowedTools);
            if (allowedTools) {
                override.allowedTools = allowedTools;
            }
            const deniedTools = normalizeStringArray(rawOverride.deniedTools);
            if (deniedTools) {
                override.deniedTools = deniedTools;
            }
            const promptAppend = resolvePromptText(rawOverride.promptAppend, sourcePath);
            if (promptAppend) {
                override.promptAppend = promptAppend;
            }
            if (Object.keys(override).length > 0) {
                next.categories[catKey] = {
                    ...next.categories[catKey],
                    ...override,
                };
            }
        }
    }
    const disabledAgents = normalizeStringArray(patch.disabledAgents);
    if (disabledAgents) {
        next.disabledAgents = uniqueStrings([...next.disabledAgents, ...disabledAgents]);
    }
    const disabledHooks = normalizeStringArray(patch.disabledHooks);
    if (disabledHooks) {
        next.disabledHooks = uniqueStrings([...next.disabledHooks, ...disabledHooks]);
    }
    const disabledTools = normalizeStringArray(patch.disabledTools);
    if (disabledTools) {
        next.disabledTools = uniqueStrings([...next.disabledTools, ...disabledTools]);
    }
    const disabledCommands = normalizeStringArray(patch.disabledCommands);
    if (disabledCommands) {
        next.disabledCommands = uniqueStrings([...next.disabledCommands, ...disabledCommands]);
    }
    return next;
}
function getUserConfigPaths() {
    const copilotDir = path.join(os.homedir(), ".copilot");
    return [
        path.join(copilotDir, "openagent.jsonc"),
        path.join(copilotDir, "openagent.json"),
    ];
}
function getProjectConfigPaths(cwd) {
    return [
        path.join(cwd, ".github", "openagent.jsonc"),
        path.join(cwd, ".github", "openagent.json"),
        path.join(cwd, ".openagent.jsonc"),
        path.join(cwd, ".openagent.json"),
    ];
}
export function loadOpenAgentConfig(cwd) {
    const sources = [];
    let config = cloneDefaultConfig();
    for (const filePath of [...getUserConfigPaths(), ...getProjectConfigPaths(cwd)]) {
        if (!existsSync(filePath)) {
            continue;
        }
        const parsed = readConfigFile(filePath);
        if (!parsed) {
            continue;
        }
        config = applyConfigPatch(config, parsed, filePath);
        sources.push(filePath);
    }
    return {
        cwd,
        config,
        sources,
    };
}
export function formatConfigSummary(resolution) {
    const { config, cwd, sources } = resolution;
    const lines = [
        `cwd: ${cwd}`,
        `config sources: ${sources.length > 0 ? sources.join(", ") : "defaults only"}`,
        `default agent: ${config.defaultAgent}`,
        `auto-select agent: ${config.autoSelectAgent ? "yes" : "no"}`,
        `notes directory: files/${config.workspace.notesDirectory}/`,
        `tool result truncation: ${config.guardrails.truncateToolResultsOver} chars`,
    ];
    const customAgentCount = Object.keys(config.agents).length;
    if (customAgentCount > 0) {
        lines.push(`custom agent definitions: ${customAgentCount}`);
    }
    const disabledCounts = [];
    if (config.disabledAgents.length > 0) {
        disabledCounts.push(`${config.disabledAgents.length} agents`);
    }
    if (config.disabledHooks.length > 0) {
        disabledCounts.push(`${config.disabledHooks.length} hooks`);
    }
    if (config.disabledTools.length > 0) {
        disabledCounts.push(`${config.disabledTools.length} tools`);
    }
    if (config.disabledCommands.length > 0) {
        disabledCounts.push(`${config.disabledCommands.length} commands`);
    }
    if (disabledCounts.length > 0) {
        lines.push(`disabled: ${disabledCounts.join(", ")}`);
    }
    return lines.join("\n");
}
