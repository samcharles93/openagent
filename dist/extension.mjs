// src/extension.mts
import { joinSession } from "@github/copilot-sdk/extension";

// src/agent-models.ts
var READ_ONLY_AGENT_DENIED_TOOLS = [
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
  "openagent_task_update"
];
var NO_EDIT_AGENT_DENIED_TOOLS = [
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
  "openagent_task_update"
];
var DEFAULT_AGENT_MODEL_CONFIGS = {
  conductor: {
    reasoningEffort: "high",
    fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }]
  },
  architect: {
    reasoningEffort: "high",
    deniedTools: ["bash", "powershell", "shell", "edit", "create", "write", "apply_patch"],
    fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }]
  },
  skeptic: {
    preferredModel: "claude-sonnet-4",
    reasoningEffort: "high",
    deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
    fallbackModels: [{ model: "gpt-5.4", reasoningEffort: "high" }, { model: "gpt-4.1" }]
  },
  scout: {
    preferredModel: "gpt-5.4-mini",
    reasoningEffort: "low",
    deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
    fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }]
  },
  builder: {
    reasoningEffort: "medium",
    deniedTools: [
      "openagent_task_update",
      "openagent_route_phase",
      "openagent_delegate",
      "openagent_bootstrap_task",
      "openagent_plan_review"
    ],
    fallbackModels: [{ model: "gpt-4.1" }, { model: "claude-sonnet-4" }]
  },
  auditor: {
    reasoningEffort: "high",
    deniedTools: ["edit", "create", "write", "apply_patch"],
    fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }]
  },
  oracle: {
    preferredModel: "gpt-5.4",
    reasoningEffort: "high",
    deniedTools: [...READ_ONLY_AGENT_DENIED_TOOLS],
    fallbackModels: [{ model: "claude-sonnet-4" }, { model: "gpt-4.1" }]
  },
  tester: {
    preferredModel: "claude-sonnet-4",
    reasoningEffort: "medium",
    deniedTools: [...NO_EDIT_AGENT_DENIED_TOOLS],
    fallbackModels: [{ model: "gpt-5.4", reasoningEffort: "medium" }, { model: "gpt-4.1" }]
  },
  sleuth: {
    reasoningEffort: "medium",
    deniedTools: ["edit", "create", "write", "apply_patch"],
    fallbackModels: [{ model: "gpt-4.1" }, { model: "claude-sonnet-4" }]
  }
};
function cloneModelTarget(target) {
  return {
    model: target.model,
    reasoningEffort: target.reasoningEffort
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
async function switchSessionModelTarget(session, target) {
  try {
    await session.rpc.model.switchTo({
      modelId: target.model,
      reasoningEffort: target.reasoningEffort
    });
    return true;
  } catch {}
  try {
    await session.setModel(target.model, {
      reasoningEffort: target.reasoningEffort
    });
    return true;
  } catch {
    return false;
  }
}
function getAgentModelConfig(agentName, userOverrides) {
  const base = DEFAULT_AGENT_MODEL_CONFIGS[agentName];
  const override = userOverrides?.[agentName];
  if (!override) {
    return {
      ...base,
      allowedTools: base.allowedTools ? [...base.allowedTools] : undefined,
      deniedTools: base.deniedTools ? [...base.deniedTools] : undefined,
      fallbackModels: cloneModelTargets(base.fallbackModels),
      promptAppend: base.promptAppend
    };
  }
  return {
    preferredModel: override.preferredModel ?? base.preferredModel,
    reasoningEffort: override.reasoningEffort ?? base.reasoningEffort,
    allowedTools: override.allowedTools ?? (base.allowedTools ? [...base.allowedTools] : undefined),
    deniedTools: override.deniedTools ?? (base.deniedTools ? [...base.deniedTools] : undefined),
    fallbackModels: override.fallbackModels ?? cloneModelTargets(base.fallbackModels),
    promptAppend: override.promptAppend ?? base.promptAppend
  };
}
async function applyAgentModelConfig(session, agentName, userOverrides) {
  const config = getAgentModelConfig(agentName, userOverrides);
  if (config.preferredModel) {
    const switched = await switchSessionModelTarget(session, {
      model: config.preferredModel,
      reasoningEffort: config.reasoningEffort
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
          reasoningEffort: config.reasoningEffort
        });
        return;
      }
    } catch {}
    try {
      const currentModel = await session.rpc.model.getCurrent();
      if (currentModel.modelId) {
        await session.setModel(currentModel.modelId, {
          reasoningEffort: config.reasoningEffort
        });
      }
    } catch {}
  }
}
function isToolDeniedForAgent(toolName, agentName, userOverrides) {
  const config = getAgentModelConfig(agentName, userOverrides);
  if (config.allowedTools && config.allowedTools.length > 0) {
    return !config.allowedTools.includes(toolName);
  }
  return (config.deniedTools ?? []).includes(toolName);
}
function getFallbackChain(agentName, userOverrides) {
  const config = getAgentModelConfig(agentName, userOverrides);
  return cloneModelTargets(config.fallbackModels) ?? [];
}
function getNextFallbackModel(agentName, currentTarget, userOverrides) {
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
  return nextIndex < chain.length && chain[nextIndex] ? cloneModelTarget(chain[nextIndex]) : null;
}

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parse } from "jsonc-parser";
var OPENAGENT_AGENT_NAMES = [
  "conductor",
  "architect",
  "skeptic",
  "sleuth",
  "scout",
  "builder",
  "auditor",
  "oracle",
  "tester"
];
var DEFAULT_CONFIG = {
  autoSelectAgent: true,
  defaultAgent: "conductor",
  systemDirectives: [
    "Plan before heavy implementation work.",
    "Prefer precise, tool-backed reasoning over speculation.",
    "Keep durable notes in the session workspace when they can help future turns."
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
    "scaffold"
  ],
  ultraworkAliases: ["ultrawork", "ulw"],
  guardrails: {
    dangerousShellPatterns: [
      "rm\\s+-rf\\b",
      "git\\s+reset\\s+--hard\\b",
      "git\\s+clean\\s+-fd\\b",
      "Remove-Item\\b.*-Recurse\\b.*-Force\\b",
      "del\\s+/f\\s+/s\\s+/q\\b"
    ],
    truncateToolResultsOver: 12000
  },
  workspace: {
    notesDirectory: "openagent"
  },
  agentOverrides: {},
  agents: {},
  categories: {},
  disabledAgents: [],
  disabledTools: [],
  disabledCommands: []
};
function cloneDefaultConfig() {
  return {
    ...DEFAULT_CONFIG,
    systemDirectives: [...DEFAULT_CONFIG.systemDirectives],
    planningKeywords: [...DEFAULT_CONFIG.planningKeywords],
    ultraworkAliases: [...DEFAULT_CONFIG.ultraworkAliases],
    guardrails: {
      ...DEFAULT_CONFIG.guardrails,
      dangerousShellPatterns: [...DEFAULT_CONFIG.guardrails.dangerousShellPatterns]
    },
    workspace: {
      ...DEFAULT_CONFIG.workspace
    },
    agentOverrides: {},
    agents: {},
    categories: {},
    disabledAgents: [],
    disabledTools: [],
    disabledCommands: []
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
    return;
  }
  const normalized = value.filter((entry) => typeof entry === "string").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return normalized.length > 0 ? uniqueStrings(normalized) : undefined;
}
function normalizeReasoningEffort(value) {
  return value === "low" || value === "medium" || value === "high" ? value : undefined;
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
    model: value.model.trim()
  };
  const reasoningEffort = normalizeReasoningEffort(value.reasoningEffort);
  if (reasoningEffort) {
    target.reasoningEffort = reasoningEffort;
  }
  return target;
}
function normalizeModelTargetArray(value) {
  if (!Array.isArray(value)) {
    return;
  }
  const seen = new Set;
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
function formatModelTarget(target) {
  return target.reasoningEffort ? `${target.model} (${target.reasoningEffort})` : target.model;
}
function formatModelTargets(targets) {
  return targets.length > 0 ? targets.map((target) => formatModelTarget(target)).join(" -> ") : "none";
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
  return;
}
function isOpenAgentAgentName(value) {
  return OPENAGENT_AGENT_NAMES.includes(value);
}
function normalizeNotesDirectory(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const segments = value.replace(/\\/g, "/").split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    return fallback;
  }
  return segments.join("/");
}
function resolvePromptFilePath(sourcePath, fileTarget) {
  const expanded = fileTarget.startsWith("~/") ? path.join(os.homedir(), fileTarget.slice(2)) : fileTarget;
  return path.isAbsolute(expanded) ? expanded : path.resolve(path.dirname(sourcePath), expanded);
}
function resolvePromptText(value, sourcePath) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return;
  }
  const trimmed = value.trim();
  if (!trimmed.startsWith("file://")) {
    return trimmed;
  }
  const fileTarget = trimmed.slice("file://".length).trim();
  if (fileTarget.length === 0) {
    return;
  }
  try {
    return readFileSync(resolvePromptFilePath(sourcePath, fileTarget), "utf8").trim();
  } catch {
    return;
  }
}
function readConfigFile(filePath) {
  const content = readFileSync(filePath, "utf8");
  const errors = [];
  const parsed = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false
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
      dangerousShellPatterns: [...base.guardrails.dangerousShellPatterns]
    },
    workspace: {
      ...base.workspace
    },
    agents: { ...base.agents },
    categories: { ...base.categories },
    disabledAgents: [...base.disabledAgents],
    disabledTools: [...base.disabledTools],
    disabledCommands: [...base.disabledCommands]
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
      ...systemDirectives
    ]);
  }
  const planningKeywords = normalizeStringArray(patch.planningKeywords);
  if (planningKeywords) {
    next.planningKeywords = uniqueStrings([
      ...next.planningKeywords,
      ...planningKeywords
    ]);
  }
  const ultraworkAliases = normalizeStringArray(patch.ultraworkAliases);
  if (ultraworkAliases) {
    next.ultraworkAliases = uniqueStrings([
      ...next.ultraworkAliases,
      ...ultraworkAliases
    ]);
  }
  if (isRecord(patch.guardrails)) {
    const dangerousShellPatterns = normalizeStringArray(patch.guardrails.dangerousShellPatterns);
    if (dangerousShellPatterns) {
      next.guardrails.dangerousShellPatterns = uniqueStrings([
        ...next.guardrails.dangerousShellPatterns,
        ...dangerousShellPatterns
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
          ...override
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
          ...definition
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
      } else if (typeof rawOverride.fallbackModel === "string" && rawOverride.fallbackModel.trim().length > 0) {
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
          ...override
        };
      }
    }
  }
  const disabledAgents = normalizeStringArray(patch.disabledAgents);
  if (disabledAgents) {
    next.disabledAgents = uniqueStrings([...next.disabledAgents, ...disabledAgents]);
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
    path.join(copilotDir, "openagent.json")
  ];
}
function getProjectConfigPaths(cwd) {
  return [
    path.join(cwd, ".github", "openagent.jsonc"),
    path.join(cwd, ".github", "openagent.json"),
    path.join(cwd, ".openagent.jsonc"),
    path.join(cwd, ".openagent.json")
  ];
}
function loadOpenAgentConfig(cwd) {
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
    sources
  };
}
function formatConfigSummary(resolution) {
  const { config, cwd, sources } = resolution;
  const lines = [
    `cwd: ${cwd}`,
    `config sources: ${sources.length > 0 ? sources.join(", ") : "defaults only"}`,
    `default agent: ${config.defaultAgent}`,
    `auto-select agent: ${config.autoSelectAgent ? "yes" : "no"}`,
    `notes directory: files/${config.workspace.notesDirectory}/`,
    `tool result truncation: ${config.guardrails.truncateToolResultsOver} chars`
  ];
  const customAgentCount = Object.keys(config.agents).length;
  if (customAgentCount > 0) {
    lines.push(`custom agent definitions: ${customAgentCount}`);
  }
  const disabledCounts = [];
  if (config.disabledAgents.length > 0) {
    disabledCounts.push(`${config.disabledAgents.length} agents`);
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
  return lines.join(`
`);
}

// src/hooks.ts
import { existsSync as existsSync8 } from "node:fs";
import { mkdir as mkdir5, writeFile as writeFile5 } from "node:fs/promises";
import * as path8 from "node:path";

// src/agents-md.ts
import { existsSync as existsSync2 } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path2 from "node:path";
var DEFAULT_MAX_DEPTH = 4;
var MAX_CONTEXT_CHARS = 6000;
var MAX_SINGLE_AGENT_CHARS = 2000;
var IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);
function formatRelativeDir(root, dir) {
  const relative2 = path2.relative(root, dir);
  return relative2.length > 0 ? relative2.replace(/\\/g, "/") : ".";
}
async function summarizeDirectory(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => !entry.name.startsWith(".")).slice(0, 8).map((entry) => `${entry.isDirectory() ? "dir" : "file"}: ${entry.name}`);
  } catch {
    return [];
  }
}
async function collectDirectories(dir, depth, maxDepth, output) {
  output.push(dir);
  if (depth >= maxDepth) {
    return;
  }
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) {
      continue;
    }
    await collectDirectories(path2.join(dir, entry.name), depth + 1, maxDepth, output);
  }
}
function buildAgentsFileContent(args) {
  const relativeDir = formatRelativeDir(args.root, args.dir);
  const scopeLabel = relativeDir === "." ? "the repository root" : `\`${relativeDir}\``;
  const sampleSection = args.sampleEntries.length > 0 ? args.sampleEntries.map((entry) => `- ${entry}`).join(`
`) : "- No visible child entries at generation time";
  return [
    "# AGENTS.md",
    "",
    `This file applies to ${scopeLabel} and its descendants.`,
    "",
    "## Local guidance",
    "- Keep edits scoped to this subtree unless the change clearly crosses boundaries.",
    "- Reuse nearby patterns before introducing new abstractions.",
    "- Update tests, docs, and config in this subtree when behavior changes here.",
    "- Call out cross-directory dependencies explicitly when work spans beyond this scope.",
    "",
    "## Visible entries",
    sampleSection
  ].join(`
`);
}
async function initializeDeepAgents(args) {
  const root = path2.resolve(args.cwd);
  const maxDepth = typeof args.maxDepth === "number" && args.maxDepth >= 0 ? Math.min(Math.floor(args.maxDepth), 8) : DEFAULT_MAX_DEPTH;
  const force = args.force === true;
  const directories = [];
  await collectDirectories(root, 0, maxDepth, directories);
  const written = [];
  const skipped = [];
  for (const dir of directories) {
    const agentFilePath = path2.join(dir, "AGENTS.md");
    const relativeFilePath = formatRelativeDir(root, agentFilePath);
    if (!force && existsSync2(agentFilePath)) {
      skipped.push(relativeFilePath);
      continue;
    }
    const sampleEntries = await summarizeDirectory(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(agentFilePath, buildAgentsFileContent({ root, dir, sampleEntries }), "utf8");
    written.push(relativeFilePath);
  }
  return { root, written, skipped };
}
async function tryReadAgentFile(filePath) {
  try {
    if (!existsSync2(filePath)) {
      return null;
    }
    const raw = await readFile(filePath, "utf8");
    const truncated = raw.length > MAX_SINGLE_AGENT_CHARS;
    return {
      source: filePath,
      content: truncated ? raw.slice(0, MAX_SINGLE_AGENT_CHARS) : raw,
      truncated
    };
  } catch {
    return null;
  }
}
async function loadAncestorAgentContext(args) {
  const root = path2.resolve(args.cwd);
  const absoluteTarget = path2.resolve(root, args.targetPath);
  const relativeTarget = path2.relative(root, absoluteTarget);
  if (relativeTarget.startsWith("..") || path2.isAbsolute(relativeTarget)) {
    return [];
  }
  const targetDir = path2.dirname(absoluteTarget);
  const files = [];
  let currentDir = targetDir;
  let totalChars = 0;
  while (true) {
    const candidate = path2.join(currentDir, "AGENTS.md");
    if (candidate !== absoluteTarget) {
      const result = await tryReadAgentFile(candidate);
      if (result) {
        const nextLength = totalChars + result.content.length;
        if (nextLength > MAX_CONTEXT_CHARS) {
          break;
        }
        files.push({
          ...result,
          source: path2.relative(root, candidate).replace(/\\/g, "/")
        });
        totalChars = nextLength;
      }
    }
    if (currentDir === root) {
      break;
    }
    const parentDir = path2.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  return files.reverse();
}

// src/memory.ts
import * as os2 from "node:os";
import * as path3 from "node:path";
import { existsSync as existsSync3 } from "node:fs";
import { mkdir as mkdir2, readFile as readFile2, readdir as readdir2, writeFile as writeFile2 } from "node:fs/promises";
function sanitizeSegment(value) {
  return value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function normalizeTopic(rawTopic) {
  const segments = rawTopic.replace(/\\/g, "/").split("/").map(sanitizeSegment).filter((segment) => segment.length > 0 && segment !== ".");
  if (segments.length === 0 || segments.some((segment) => segment === "..")) {
    throw new Error("Memory topic must stay inside the OpenAgent memory store.");
  }
  const joined = segments.join("/");
  return path3.posix.extname(joined).length > 0 ? joined : `${joined}.md`;
}
function buildRepoKey(cwd) {
  const resolved = path3.resolve(cwd).replace(/\\/g, "/");
  const key = resolved.split("/").map(sanitizeSegment).filter((segment) => segment.length > 0).join("-");
  return key.length > 0 ? key : "workspace";
}
function getMemoryRoot(cwd) {
  const repoKey = buildRepoKey(cwd);
  return {
    repoKey,
    root: path3.join(os2.homedir(), ".copilot", "openagent", "memory", repoKey)
  };
}
async function collectTopics(root, prefix = "") {
  if (!existsSync3(root)) {
    return [];
  }
  const entries = await readdir2(root, { withFileTypes: true });
  const topics = await Promise.all(entries.map(async (entry) => {
    const relativePath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path3.join(root, entry.name);
    if (entry.isDirectory()) {
      return collectTopics(fullPath, relativePath);
    }
    return [relativePath.replace(/\\/g, "/")];
  }));
  return topics.flat().sort();
}
async function writeOpenAgentMemory(args) {
  const { cwd, content } = args;
  const mode = args.mode === "replace" ? "replace" : "append";
  const { repoKey, root } = getMemoryRoot(cwd);
  const relativePath = normalizeTopic(args.topic);
  const fullPath = path3.join(root, ...relativePath.split("/"));
  await mkdir2(path3.dirname(fullPath), { recursive: true });
  let nextContent = content;
  if (mode === "append" && existsSync3(fullPath)) {
    const current = await readFile2(fullPath, "utf8");
    nextContent = `${current.trimEnd()}

${content}`;
  }
  await writeFile2(fullPath, nextContent, "utf8");
  return {
    repoKey,
    fullPath,
    relativePath,
    nextContent
  };
}
async function readOpenAgentMemory(args) {
  const { cwd } = args;
  const { repoKey, root } = getMemoryRoot(cwd);
  const relativePath = normalizeTopic(args.topic);
  const fullPath = path3.join(root, ...relativePath.split("/"));
  if (!existsSync3(fullPath)) {
    return {
      repoKey,
      fullPath,
      relativePath,
      content: null
    };
  }
  return {
    repoKey,
    fullPath,
    relativePath,
    content: await readFile2(fullPath, "utf8")
  };
}
async function listOpenAgentMemoryTopics(args) {
  const { repoKey, root } = getMemoryRoot(args.cwd);
  return {
    repoKey,
    root,
    topics: await collectTopics(root)
  };
}

// src/workspace.ts
import { existsSync as existsSync4 } from "node:fs";
import { mkdir as mkdir3, readFile as readFile3, writeFile as writeFile3 } from "node:fs/promises";
import * as path4 from "node:path";
function isOpenAgentWorkspaceAvailable(session) {
  return typeof session.workspacePath === "string" && session.workspacePath.length > 0;
}
function formatOpenAgentWorkspaceRequirement(action) {
  return `${action} requires the session workspace because OpenAgent persists durable handoffs and notes under files/openagent/.`;
}
function requireOpenAgentWorkspacePath(session, action = "This action") {
  const { workspacePath } = session;
  if (typeof workspacePath !== "string" || workspacePath.length === 0) {
    throw new Error(formatOpenAgentWorkspaceRequirement(action));
  }
  return workspacePath;
}
function normalizeOpenAgentRelativePath(rawPath) {
  const normalized = rawPath.replace(/\\/g, "/").split("/").map((segment) => segment.trim()).filter((segment) => segment.length > 0 && segment !== ".");
  if (normalized.length === 0 || normalized.some((segment) => segment === "..")) {
    throw new Error("Workspace note path must stay inside the OpenAgent notes directory.");
  }
  const joined = normalized.join("/");
  return path4.posix.extname(joined).length > 0 ? joined : `${joined}.md`;
}
function getOpenAgentWorkspacePaths(args) {
  const { session, config } = args;
  const workspacePath = requireOpenAgentWorkspacePath(session);
  const notesRoot = path4.join(workspacePath, "files", ...config.workspace.notesDirectory.split("/"));
  return {
    workspacePath,
    notesRoot,
    routingRoot: path4.join(notesRoot, "routing"),
    handoffsRoot: path4.join(notesRoot, "routing", "handoffs"),
    routeStateFile: path4.join(notesRoot, "routing", "route-state.json")
  };
}
async function writeOpenAgentWorkspaceNote(args) {
  const { session, config, content } = args;
  const fileMode = args.mode === "replace" ? "replace" : "append";
  const relativePath = normalizeOpenAgentRelativePath(args.relativePath);
  const paths = getOpenAgentWorkspacePaths({ session, config });
  const fullPath = path4.join(paths.notesRoot, ...relativePath.split("/"));
  await mkdir3(path4.dirname(fullPath), { recursive: true });
  let nextContent = content;
  if (fileMode === "append" && existsSync4(fullPath)) {
    const current = await readFile3(fullPath, "utf8");
    nextContent = `${current.trimEnd()}

${content}`;
  }
  await writeFile3(fullPath, nextContent, "utf8");
  return {
    fullPath,
    workspaceRelativePath: path4.relative(paths.workspacePath, fullPath),
    nextContent
  };
}

// src/continuous-improvement.ts
function toBullets(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function toSection(title, lines) {
  if (lines.length === 0) {
    return [];
  }
  return [title, toBullets(lines), ""];
}
function sanitizeSlug(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}
function buildPromotionGuidance(source) {
  const sourceSpecific = source === "doctor" ? "If the same environment or config issue recurs, promote the setup guidance into `.openagent/rules/` or `AGENTS.md` instead of leaving it in isolated doctor reports." : source === "review-workflow" ? "After the merged review verdict lands, promote repeated findings into `.openagent/rules/`, `AGENTS.md`, repo memory, or follow-up tasks." : "If the same session-level lesson repeats, promote it from memory into `.openagent/rules/` or `AGENTS.md` so future runs inherit it automatically.";
  return [
    sourceSpecific,
    "Use `.openagent/rules/*.md` for stable repo-wide operating rules.",
    "Use `AGENTS.md` for runtime-facing workflow and architecture guidance that should appear early in loaded context.",
    "Use repo-scoped memory for recurring repo-specific notes that are useful but not yet stable enough to become rules.",
    "Turn unresolved improvement work into tasks or plan items instead of leaving it as prose only."
  ];
}
function buildArtifactContent(args) {
  return [
    "# OpenAgent continuous improvement note",
    "",
    `Timestamp: ${args.timestamp}`,
    `Source: ${args.source}`,
    `Title: ${args.title}`,
    "",
    "## Summary",
    args.summary.trim(),
    "",
    ...toSection("## Evidence", args.evidence),
    ...toSection("## Recommendations", args.recommendations),
    "## Promotion guidance",
    toBullets(buildPromotionGuidance(args.source))
  ].join(`
`);
}
async function recordContinuousImprovementArtifact(args) {
  const timestamp = new Date().toISOString();
  const evidence = args.evidence?.filter((item) => item.trim().length > 0) ?? [];
  const recommendations = args.recommendations?.filter((item) => item.trim().length > 0) ?? [];
  const content = buildArtifactContent({
    timestamp,
    source: args.source,
    title: args.title,
    summary: args.summary,
    evidence,
    recommendations
  });
  const memoryPath = await writeOpenAgentMemory({
    cwd: args.cwd,
    topic: `continuous-improvement/${args.source}/${timestamp.replace(/[:.]/g, "-")}`,
    content,
    mode: "replace"
  });
  let workspaceRelativePath = null;
  if (args.session && args.config && isOpenAgentWorkspaceAvailable(args.session)) {
    const slugBase = sanitizeSlug(args.title) || args.source;
    const note = await writeOpenAgentWorkspaceNote({
      session: args.session,
      config: args.config,
      relativePath: `improvements/${args.source}/${timestamp.replace(/[:.]/g, "-")}-${slugBase}.md`,
      content,
      mode: "replace"
    });
    workspaceRelativePath = note.workspaceRelativePath;
  }
  return {
    memoryRelativePath: memoryPath.relativePath,
    workspaceRelativePath,
    content
  };
}

// src/context-loader.ts
import { existsSync as existsSync6 } from "node:fs";
import { readFile as readFile5, readdir as readdir3 } from "node:fs/promises";
import * as path6 from "node:path";

// src/skill-loader.ts
import { existsSync as existsSync5, readdirSync } from "node:fs";
import { readFile as readFile4 } from "node:fs/promises";
import * as os3 from "node:os";
import * as path5 from "node:path";
var MAX_SKILLS = 20;
function parseSkillFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const frontmatterBlock = match[1];
  const content = match[2].trim();
  let name;
  let description;
  const triggers = [];
  const lines = frontmatterBlock.split(/\r?\n/);
  let parsingTriggers = false;
  for (const line of lines) {
    if (/^name:\s*/.test(line)) {
      name = line.replace(/^name:\s*/, "").trim();
      parsingTriggers = false;
      continue;
    }
    if (/^description:\s*/.test(line)) {
      description = line.replace(/^description:\s*/, "").trim();
      parsingTriggers = false;
      continue;
    }
    if (/^triggers:\s*$/.test(line)) {
      parsingTriggers = true;
      continue;
    }
    if (parsingTriggers && /^\s+-\s+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, "").trim();
      if (value.length > 0) {
        triggers.push(value);
      }
      continue;
    }
    if (/^\S/.test(line)) {
      parsingTriggers = false;
    }
  }
  if (!name || !description) {
    return null;
  }
  return { name, description, triggers, content };
}
function scanSkillDirectory(dir) {
  try {
    if (!existsSync5(dir)) {
      return [];
    }
    const entries = readdirSync(dir, { withFileTypes: true });
    const paths = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = path5.join(dir, entry.name, "SKILL.md");
      if (existsSync5(skillFile)) {
        paths.push(skillFile);
      }
    }
    return paths;
  } catch {
    return [];
  }
}
function discoverSkillFiles(cwd) {
  const projectDir = path5.join(cwd, ".openagent", "skills");
  const userDir = path5.join(os3.homedir(), ".copilot", "skills");
  return [...scanSkillDirectory(projectDir), ...scanSkillDirectory(userDir)];
}
async function loadSkills(cwd) {
  const files = discoverSkillFiles(cwd);
  const skills = [];
  for (const filePath of files) {
    if (skills.length >= MAX_SKILLS) {
      break;
    }
    try {
      const raw = await readFile4(filePath, "utf-8");
      const parsed = parseSkillFrontmatter(raw);
      if (!parsed) {
        continue;
      }
      skills.push({
        name: parsed.name,
        description: parsed.description,
        triggers: parsed.triggers,
        content: parsed.content,
        source: filePath
      });
    } catch {
      continue;
    }
  }
  return skills;
}
function formatSkillsForPrompt(skills) {
  if (skills.length === 0) {
    return "";
  }
  const lines = ["Available OpenAgent skills:"];
  for (const skill of skills) {
    const triggerNote = skill.triggers.length > 0 ? ` (triggers: ${skill.triggers.join(", ")})` : "";
    lines.push(`- ${skill.name}: ${skill.description}${triggerNote}`);
  }
  return lines.join(`
`);
}
function matchSkillByTrigger(skills, userPrompt) {
  const normalized = userPrompt.toLowerCase();
  const words = new Set(normalized.split(/\s+/));
  return skills.filter((skill) => skill.triggers.some((trigger) => words.has(trigger.toLowerCase()) || normalized.includes(trigger.toLowerCase())));
}

// src/context-loader.ts
var MAX_SINGLE_FILE_CHARS = 4000;
var README_TRUNCATE_CHARS = 2000;
var TOTAL_CONTEXT_BUDGET = 12000;
async function tryReadFile(filePath, maxChars) {
  try {
    if (!existsSync6(filePath)) {
      return null;
    }
    const raw = await readFile5(filePath, "utf-8");
    if (raw.length > maxChars) {
      return { content: raw.slice(0, maxChars), truncated: true };
    }
    return { content: raw, truncated: false };
  } catch {
    return null;
  }
}
async function discoverRuleFiles(cwd) {
  const rulesDir = path6.join(cwd, ".openagent", "rules");
  try {
    if (!existsSync6(rulesDir)) {
      return [];
    }
    const entries = await readdir3(rulesDir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort().map((name) => path6.join(".openagent", "rules", name));
  } catch {
    return [];
  }
}
function formatProjectContext(files) {
  const parts = files.map((f) => `--- ${f.source} ---
${f.content}
--- end ${f.source} ---`);
  return `<openagent_project_context>
${parts.join(`

`)}
</openagent_project_context>`;
}
async function loadProjectContext(cwd) {
  const candidates = [];
  candidates.push({ relativePath: "AGENTS.md", maxChars: MAX_SINGLE_FILE_CHARS });
  candidates.push({ relativePath: path6.join(".openagent", "last-session.md"), maxChars: 1500 });
  candidates.push({ relativePath: "README.md", maxChars: README_TRUNCATE_CHARS });
  const ruleFiles = await discoverRuleFiles(cwd);
  for (const rel of ruleFiles) {
    candidates.push({ relativePath: rel, maxChars: MAX_SINGLE_FILE_CHARS });
  }
  candidates.push({
    relativePath: path6.join(".github", "copilot-instructions.md"),
    maxChars: MAX_SINGLE_FILE_CHARS
  });
  const files = [];
  let totalChars = 0;
  for (const candidate of candidates) {
    const fullPath = path6.join(cwd, candidate.relativePath);
    const result = await tryReadFile(fullPath, candidate.maxChars);
    if (!result) {
      continue;
    }
    if (totalChars + result.content.length > TOTAL_CONTEXT_BUDGET) {
      break;
    }
    files.push({
      source: candidate.relativePath,
      content: result.content,
      truncated: result.truncated
    });
    totalChars += result.content.length;
  }
  const skills = await loadSkills(cwd);
  if (skills.length > 0) {
    const skillsSection = formatSkillsForPrompt(skills);
    if (totalChars + skillsSection.length <= TOTAL_CONTEXT_BUDGET) {
      files.push({
        source: "openagent-skills",
        content: skillsSection,
        truncated: false
      });
      totalChars += skillsSection.length;
    }
  }
  const summary = files.length === 0 ? "No project context files found." : `Loaded ${files.length} context files (${totalChars} chars): ${files.map((f) => f.source).join(", ")}`;
  return { files, totalChars, summary };
}

// src/telemetry.ts
var EDIT_LIKE_PREFIXES = new Set(["edit", "create", "write", "apply_patch"]);
var READ_LIKE_PREFIXES = new Set(["read", "view"]);
var telemetry = {
  sessionStartedAt: new Date().toISOString(),
  toolCalls: 0,
  toolFailures: 0,
  toolDenials: 0,
  editToolCalls: 0,
  readToolCalls: 0,
  fallbackSwitches: 0,
  lastFallback: null,
  loopStarts: 0,
  loopIterations: 0,
  loopCancels: 0,
  loopCompletions: 0,
  compactionsStarted: 0,
  compactionsCompleted: 0,
  compactionFailures: 0,
  lastUsageRatio: null,
  lastUsageTokens: null,
  tokenLimit: null,
  lspCalls: 0,
  astCalls: 0,
  lookAtCalls: 0
};
function isEditLikeTool(toolName) {
  return EDIT_LIKE_PREFIXES.has(toolName) || toolName === "openagent_safe_edit" || toolName === "openagent_lsp_rename" || toolName === "openagent_ast_replace";
}
function isReadLikeTool(toolName) {
  return READ_LIKE_PREFIXES.has(toolName) || toolName === "openagent_lsp_diagnostics" || toolName === "openagent_lsp_goto_definition" || toolName === "openagent_lsp_find_references" || toolName === "openagent_ast_search" || toolName === "openagent_look_at";
}
function recordToolCall(toolName) {
  telemetry.toolCalls += 1;
  if (isEditLikeTool(toolName)) {
    telemetry.editToolCalls += 1;
  }
  if (isReadLikeTool(toolName)) {
    telemetry.readToolCalls += 1;
  }
  if (toolName.startsWith("openagent_lsp_")) {
    telemetry.lspCalls += 1;
  }
  if (toolName.startsWith("openagent_ast_")) {
    telemetry.astCalls += 1;
  }
  if (toolName === "openagent_look_at") {
    telemetry.lookAtCalls += 1;
  }
}
function recordLookAtInvocation() {
  telemetry.lookAtCalls += 1;
}
function recordToolFailure() {
  telemetry.toolFailures += 1;
}
function recordToolDenied() {
  telemetry.toolDenials += 1;
}
function recordFallbackSwitch(agentName, target) {
  telemetry.fallbackSwitches += 1;
  telemetry.lastFallback = `${agentName} -> ${target.model}${target.reasoningEffort ? ` (${target.reasoningEffort})` : ""}`;
}
function recordLoopStart() {
  telemetry.loopStarts += 1;
}
function recordLoopIteration() {
  telemetry.loopIterations += 1;
}
function recordLoopCancel() {
  telemetry.loopCancels += 1;
}
function recordLoopComplete() {
  telemetry.loopCompletions += 1;
}
function recordUsageInfo(currentTokens, tokenLimit) {
  telemetry.lastUsageTokens = currentTokens;
  telemetry.tokenLimit = tokenLimit;
  telemetry.lastUsageRatio = tokenLimit > 0 ? Math.max(0, Math.min(currentTokens / tokenLimit, 1)) : null;
}
function recordCompactionStart() {
  telemetry.compactionsStarted += 1;
}
function recordCompactionComplete(success) {
  if (success) {
    telemetry.compactionsCompleted += 1;
    return;
  }
  telemetry.compactionFailures += 1;
}
function getOpenAgentTelemetrySnapshot() {
  return { ...telemetry };
}
function formatOpenAgentTelemetry(snapshot = getOpenAgentTelemetrySnapshot()) {
  const usage = snapshot.lastUsageRatio === null || snapshot.lastUsageTokens === null || snapshot.tokenLimit === null ? "usage: unknown" : `usage: ${(snapshot.lastUsageRatio * 100).toFixed(1)}% (${snapshot.lastUsageTokens}/${snapshot.tokenLimit} tokens)`;
  return [
    "OpenAgent telemetry",
    `session started: ${snapshot.sessionStartedAt}`,
    `tools: ${snapshot.toolCalls} calls, ${snapshot.toolFailures} failures, ${snapshot.toolDenials} denied`,
    `tool mix: ${snapshot.readToolCalls} read-like, ${snapshot.editToolCalls} edit-like, ${snapshot.lspCalls} LSP, ${snapshot.astCalls} AST, ${snapshot.lookAtCalls} look_at`,
    `fallbacks: ${snapshot.fallbackSwitches}${snapshot.lastFallback ? ` (last: ${snapshot.lastFallback})` : ""}`,
    `loops: ${snapshot.loopStarts} starts, ${snapshot.loopIterations} continuations, ${snapshot.loopCompletions} completions, ${snapshot.loopCancels} cancels`,
    `compactions: ${snapshot.compactionsStarted} started, ${snapshot.compactionsCompleted} completed, ${snapshot.compactionFailures} failed`,
    usage
  ].join(`
`);
}

// src/model-fallback.ts
var fallbackStates = new Map;
function initFallbackState(agentName, currentModel) {
  fallbackStates.set(agentName, {
    agentName,
    originalModel: currentModel,
    attemptedModels: currentModel !== null ? [currentModel] : [],
    currentFallback: null,
    exhausted: false
  });
}
function syncFallbackState(agentName, currentModelId) {
  initFallbackState(agentName, currentModelId !== null ? { model: currentModelId } : null);
}
function advanceFallback(agentName, config) {
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
  const nextIndex = chain.findIndex((target) => target.model === nextTarget.model && target.reasoningEffort === nextTarget.reasoningEffort);
  const isLast = nextIndex === chain.length - 1;
  return { target: nextTarget, exhausted: isLast };
}
function formatFallbackStatus() {
  if (fallbackStates.size === 0) {
    return "Model fallback: no active fallback states.";
  }
  const lines = ["Model fallback states:"];
  for (const [agentName, state] of fallbackStates) {
    const status = state.exhausted ? "exhausted" : state.currentFallback ? `active (${formatModelTarget(state.currentFallback)})` : "idle";
    lines.push(`  ${agentName}: ${status} | attempted: [${state.attemptedModels.map((target) => formatModelTarget(target)).join(", ")}]`);
  }
  return lines.join(`
`);
}

// src/prompt.ts
function toBullets2(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function buildSystemPrompt(config) {
  const corePrinciples = [
    "Act like an orchestration-first engineering harness instead of a generic chat assistant.",
    "For multi-step work, create or refine a plan before editing or executing long workflows.",
    "Use tools and repository evidence to drive decisions instead of guessing.",
    "Keep context lean by storing durable artifacts in the session workspace when they will help later turns.",
    "Conclude with a crisp outcome statement that names the meaningful result and any remaining risk."
  ];
  const harnessCapabilities = [
    "Use openagent_runtime_status to inspect the harness runtime, active mode, selected model, and session workspace.",
    "Use openagent_bootstrap_task to turn a raw request into an initial plan, selected phase, and durable handoff in one step.",
    "Use openagent_plan_note to create or update session plan content when the work spans multiple steps.",
    `Use openagent_workspace_note to persist reusable notes and artifacts under files/${config.workspace.notesDirectory}/.`,
    "Use openagent_memory_write/openagent_memory_read/openagent_memory_list to persist durable repo-scoped memories across sessions when conventions or follow-up notes should survive.",
    "Promote stable repo-wide lessons into `.openagent/rules/*.md`, and move early runtime-facing guidance into `AGENTS.md` when future sessions should see it immediately.",
    "Use openagent_route_phase when you intentionally move work between planner, researcher, reviewer, or orchestrator phases, including specialist agent variants inside those phases.",
    "Use openagent_fleet to register implementation tasks and get ready-to-dispatch agent payloads — then call the `agent` tool for each task in one response to dispatch builders in parallel.",
    "Use the OpenAgent custom agents when a conductor, architect, skeptic, scout, sleuth, builder, auditor, oracle, or tester mindset would improve the result."
  ];
  return [
    "You are OpenAgent, a Copilot CLI extension harness for disciplined software delivery.",
    "",
    "Core operating principles:",
    toBullets2(corePrinciples),
    "",
    "Harness capabilities:",
    toBullets2(harnessCapabilities),
    "",
    "Project directives:",
    toBullets2(config.systemDirectives)
  ].join(`
`);
}
function buildPromptContext(resolution, options) {
  const lines = [
    `OpenAgent is active for ${resolution.cwd}.`,
    options.forcePlan ? "This request looks multi-step. Prefer openagent_bootstrap_task or /oa-start to initialize the plan, route, and handoff before heavy implementation." : "If the task expands beyond a quick change, use openagent_bootstrap_task or /oa-start before proceeding so the plan and route stay explicit.",
    `Persist durable notes in files/${resolution.config.workspace.notesDirectory}/ when they will help future turns.`,
    "Use repo memory for recurring repo-specific notes, and promote stable repeated lessons into `.openagent/rules/` or `AGENTS.md` instead of leaving them in one-off outputs.",
    "When changing phases, use openagent_route_phase so the handoff is durable and the correct agent is selected. For implementation work, use openagent_fleet instead.",
    "Prefer using the OpenAgent conductor, architect, skeptic, scout, sleuth, builder, auditor, oracle, or tester personas when they improve quality or keep context lean."
  ];
  if (resolution.config.systemDirectives.length > 0) {
    lines.push(`Project directives: ${resolution.config.systemDirectives.join(" | ")}`);
  }
  return lines.join(`
`);
}
function looksComplexPrompt(prompt, config) {
  const normalized = prompt.trim().toLowerCase();
  if (normalized.length >= 180) {
    return true;
  }
  if (normalized.split(/\r?\n/).length >= 3) {
    return true;
  }
  return config.planningKeywords.some((keyword) => normalized.includes(keyword.toLowerCase()));
}
function isUltraworkPrompt(prompt, config) {
  const normalized = prompt.trim().toLowerCase();
  return config.ultraworkAliases.some((alias) => alias.toLowerCase() === normalized);
}
function expandUltraworkPrompt() {
  return [
    "Start by using openagent_bootstrap_task when the request still needs an initial plan and phase selection.",
    "Plan the work, execute it end-to-end, and keep going until the task is actually complete.",
    "Use the most appropriate OpenAgent persona for each phase, keep the plan current, and store durable notes in the session workspace when they help.",
    "Finish with a concise handoff that states the result and any remaining risk or follow-up."
  ].join(" ");
}

// src/session-history.ts
import { existsSync as existsSync7 } from "node:fs";
import { mkdir as mkdir4, readFile as readFile6, writeFile as writeFile4 } from "node:fs/promises";
import * as path7 from "node:path";
var MAX_HISTORY_ENTRIES = 100;
function isRecord2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getSessionHistoryPath(session, config) {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path7.join(paths.notesRoot, "sessions", "history.json");
}
function getSessionHistoryPathFromWorkspace(workspacePath, config) {
  return path7.join(workspacePath, "files", ...config.workspace.notesDirectory.split("/"), "sessions", "history.json");
}
function sanitizeEntry(value) {
  if (!isRecord2(value)) {
    return null;
  }
  if (typeof value.sessionId !== "string" || typeof value.startedAt !== "string" || typeof value.endedAt !== "string" || typeof value.reason !== "string" || typeof value.summary !== "string") {
    return null;
  }
  return {
    sessionId: value.sessionId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    reason: value.reason,
    summary: value.summary,
    agentName: typeof value.agentName === "string" ? value.agentName : null,
    phasesVisited: Array.isArray(value.phasesVisited) ? value.phasesVisited.filter((v) => typeof v === "string") : [],
    keyFiles: Array.isArray(value.keyFiles) ? value.keyFiles.filter((v) => typeof v === "string") : []
  };
}
function sanitizeHistory(value) {
  const empty = { entries: [], updatedAt: new Date().toISOString() };
  if (!isRecord2(value)) {
    return empty;
  }
  const entries = Array.isArray(value.entries) ? value.entries.map(sanitizeEntry).filter((entry) => entry !== null) : [];
  return {
    entries,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : empty.updatedAt
  };
}
async function readHistoryFromPath(historyPath) {
  if (!existsSync7(historyPath)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = await readFile6(historyPath, "utf8");
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}
async function writeHistoryToPath(historyPath, history) {
  await mkdir4(path7.dirname(historyPath), { recursive: true });
  await writeFile4(historyPath, JSON.stringify(history, null, 2), "utf8");
}
async function readSessionHistory(session, config) {
  const historyPath = getSessionHistoryPath(session, config);
  return readHistoryFromPath(historyPath);
}
async function searchSessionHistory(session, config, query) {
  const history = await readSessionHistory(session, config);
  const lowerQuery = query.toLowerCase();
  return history.entries.filter((entry) => {
    if (entry.summary.toLowerCase().includes(lowerQuery)) {
      return true;
    }
    if (entry.keyFiles.some((file) => file.toLowerCase().includes(lowerQuery))) {
      return true;
    }
    return false;
  });
}
function formatSessionHistoryEntry(entry) {
  const lines = [
    `Session: ${entry.sessionId}`,
    `Started: ${entry.startedAt}`,
    `Ended: ${entry.endedAt}`,
    `Reason: ${entry.reason}`,
    `Agent: ${entry.agentName ?? "none"}`,
    `Summary: ${entry.summary}`
  ];
  if (entry.phasesVisited.length > 0) {
    lines.push(`Phases visited: ${entry.phasesVisited.join(", ")}`);
  }
  if (entry.keyFiles.length > 0) {
    lines.push(`Key files: ${entry.keyFiles.join(", ")}`);
  }
  return lines.join(`
`);
}
async function recordSessionEnd(workspacePath, config, entry) {
  if (!workspacePath || workspacePath.length === 0) {
    return;
  }
  const historyPath = getSessionHistoryPathFromWorkspace(workspacePath, config);
  const history = await readHistoryFromPath(historyPath);
  const fullEntry = {
    ...entry,
    endedAt: new Date().toISOString()
  };
  history.entries.push(fullEntry);
  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries = history.entries.slice(-MAX_HISTORY_ENTRIES);
  }
  history.updatedAt = new Date().toISOString();
  await writeHistoryToPath(historyPath, history);
}

// src/hooks.ts
var SHELL_TOOL_NAMES = new Set(["bash", "powershell", "shell"]);
var EDIT_LIKE_TOOL_NAMES = new Set([
  "edit",
  "create",
  "write",
  "apply_patch",
  "openagent_safe_edit",
  "openagent_ast_replace",
  "openagent_lsp_rename"
]);
var WRITE_TOOL_NAMES = new Set(["create", "write"]);
var EDIT_TOOL_NAMES = new Set([
  "edit",
  "apply_patch",
  "openagent_safe_edit",
  "openagent_ast_replace",
  "openagent_lsp_rename"
]);
var READ_CONTEXT_TOOL_NAMES = new Set(["read", "view"]);
var currentAgentName = null;
var editedFilesThisSession = new Set;
var phasesVisitedThisSession = new Set;
function setCurrentAgentName(agentName) {
  currentAgentName = agentName;
}
function getCurrentAgentName() {
  return currentAgentName;
}
function isRecord3(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function extractShellCommand(toolArgs) {
  if (!isRecord3(toolArgs)) {
    return null;
  }
  const candidateKeys = ["command", "cmd", "script"];
  for (const key of candidateKeys) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}
function truncatePlainText(value, maxChars) {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}...`;
}
function extractFilePath(toolArgs) {
  if (!isRecord3(toolArgs)) {
    return null;
  }
  const candidateKeys = ["path", "file_path", "file"];
  for (const key of candidateKeys) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}
function truncateToolResult(toolResult, maxChars) {
  if (toolResult.textResultForLlm.length <= maxChars) {
    return;
  }
  const hiddenChars = toolResult.textResultForLlm.length - maxChars;
  return {
    ...toolResult,
    textResultForLlm: `${toolResult.textResultForLlm.slice(0, maxChars)}

` + `[OpenAgent truncated ${hiddenChars} trailing characters to keep the context focused.]`
  };
}
function safeGetSession(getSession) {
  if (!getSession) {
    return null;
  }
  try {
    return getSession();
  } catch {
    return null;
  }
}
function classifyRecoveryError(error) {
  const normalized = error.toLowerCase();
  if (normalized.includes("context window") || normalized.includes("maximum context") || normalized.includes("token limit") || normalized.includes("too long")) {
    return {
      kind: "context-window",
      description: "a context-window limit",
      shouldPersistNote: true
    };
  }
  if (normalized.includes("tool result") || normalized.includes("missing tool") || normalized.includes("tool call id") || normalized.includes("tool-part")) {
    return {
      kind: "tool-results",
      description: "a missing or malformed tool-result state",
      shouldPersistNote: false
    };
  }
  if (normalized.includes("thinking block") || normalized.includes("reasoning block")) {
    return {
      kind: "thinking-mismatch",
      description: "a thinking-block mismatch",
      shouldPersistNote: false
    };
  }
  if (normalized.includes("empty message") || normalized.includes("message content is empty") || normalized.includes("no message content")) {
    return {
      kind: "empty-message",
      description: "an empty-message response",
      shouldPersistNote: false
    };
  }
  if (normalized.includes("json") && normalized.includes("parse")) {
    return {
      kind: "json-parse",
      description: "a JSON parse failure",
      shouldPersistNote: false
    };
  }
  return {
    kind: "generic",
    description: "a recoverable runtime failure",
    shouldPersistNote: false
  };
}
function createHooks(args) {
  const { initialCwd, getSession } = args;
  const sessionStartTime = new Date().toISOString();
  return {
    onSessionStart: async (input) => {
      const cwd = input.workingDirectory || initialCwd;
      const resolution = loadOpenAgentConfig(cwd);
      const promptContext = buildPromptContext(resolution, {
        forcePlan: Boolean(input.initialPrompt)
      });
      const projectContext = await loadProjectContext(cwd);
      const additionalContext = projectContext.files.length > 0 ? `${promptContext}

${formatProjectContext(projectContext.files)}` : promptContext;
      return { additionalContext };
    },
    onUserPromptSubmitted: async (input) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      const session = safeGetSession(getSession);
      if (session && currentAgentName) {
        try {
          const currentModel = await session.rpc.model.getCurrent();
          syncFallbackState(currentAgentName, currentModel.modelId ?? null);
        } catch {
          syncFallbackState(currentAgentName, null);
        }
      }
      if (isUltraworkPrompt(input.prompt, resolution.config)) {
        return {
          modifiedPrompt: expandUltraworkPrompt(),
          additionalContext: buildPromptContext(resolution, { forcePlan: true })
        };
      }
      if (looksComplexPrompt(input.prompt, resolution.config)) {
        return {
          additionalContext: buildPromptContext(resolution, { forcePlan: true })
        };
      }
      const cwd = input.workingDirectory || initialCwd;
      const skills = await loadSkills(cwd);
      if (skills.length > 0) {
        const matched = matchSkillByTrigger(skills, input.prompt);
        if (matched.length > 0) {
          const skillDescriptions = matched.map((s) => `${s.name}: ${s.description}`).join("; ");
          return {
            additionalContext: `Matched OpenAgent skills for this request: ${skillDescriptions}. Use the skill content for guidance.`
          };
        }
      }
      return;
    },
    onPreToolUse: async (input) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      recordToolCall(input.toolName);
      if (EDIT_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath) {
          editedFilesThisSession.add(filePath);
        }
      }
      if (input.toolName === "openagent_route_phase") {
        const phase = isRecord3(input.toolArgs) && typeof input.toolArgs.phase === "string" ? input.toolArgs.phase : null;
        if (phase) {
          phasesVisitedThisSession.add(phase);
        }
      }
      if (SHELL_TOOL_NAMES.has(input.toolName)) {
        const command = extractShellCommand(input.toolArgs);
        if (command && resolution.config.guardrails.dangerousShellPatterns.some((pattern) => new RegExp(pattern, "i").test(command))) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason: "OpenAgent blocked a destructive shell command based on its guardrail policy."
          };
        }
      }
      if (WRITE_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath && existsSync8(filePath)) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason: "OpenAgent blocked creating a file that already exists. Use edit instead of create for existing files."
          };
        }
      }
      if (currentAgentName) {
        const agentName = currentAgentName;
        if (isToolDeniedForAgent(input.toolName, agentName, resolution.config.agentOverrides)) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason: `OpenAgent blocked tool "${input.toolName}" because the ${agentName} agent is not permitted to use it.`
          };
        }
      }
      if (READ_CONTEXT_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath) {
          const ancestorAgentFiles = await loadAncestorAgentContext({
            cwd: input.workingDirectory || initialCwd,
            targetPath: filePath
          });
          if (ancestorAgentFiles.length > 0) {
            return {
              additionalContext: formatProjectContext(ancestorAgentFiles)
            };
          }
        }
      }
      return;
    },
    onPostToolUse: async (input) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      if (input.toolResult.resultType === "failure") {
        recordToolFailure();
      }
      const modifiedResult = truncateToolResult(input.toolResult, resolution.config.guardrails.truncateToolResultsOver);
      const contextParts = [];
      if (EDIT_LIKE_TOOL_NAMES.has(input.toolName)) {
        contextParts.push("OpenAgent reminder: after meaningful edits, reconcile the plan and consider what validation would prove the change.");
      }
      if (EDIT_TOOL_NAMES.has(input.toolName) && input.toolResult.resultType === "failure") {
        contextParts.push("OpenAgent detected an edit failure. Common fixes: (1) re-read the file to get fresh content, (2) use a smaller/more targeted old_str, (3) check that the file hasn't been modified by another tool since you last read it.");
      }
      const additionalContext = contextParts.length > 0 ? contextParts.join(`
`) : undefined;
      if (!modifiedResult && !additionalContext) {
        return;
      }
      return {
        modifiedResult,
        additionalContext
      };
    },
    onSessionEnd: async (input) => {
      const parts = [`OpenAgent session ended with reason "${input.reason}".`];
      if (input.finalMessage) {
        parts.push(`Final response preview: ${truncatePlainText(input.finalMessage, 240)}`);
      }
      const summary = parts.join(" ");
      try {
        const session = safeGetSession(getSession);
        const inputRecord = input;
        const workspacePath = typeof inputRecord.sessionWorkspacePath === "string" ? inputRecord.sessionWorkspacePath : typeof inputRecord.workspacePath === "string" ? inputRecord.workspacePath : null;
        const cwd = typeof inputRecord.workingDirectory === "string" ? inputRecord.workingDirectory : initialCwd;
        const resolution = loadOpenAgentConfig(cwd);
        if (workspacePath && workspacePath.length > 0) {
          await recordSessionEnd(workspacePath, resolution.config, {
            sessionId: `session-${Date.now()}`,
            startedAt: sessionStartTime,
            reason: typeof input.reason === "string" ? input.reason : "unknown",
            summary,
            agentName: currentAgentName,
            phasesVisited: [...phasesVisitedThisSession],
            keyFiles: [...editedFilesThisSession]
          });
        }
        const lastSessionContent = [
          `# Last Session`,
          ``,
          `**Ended:** ${new Date().toISOString()}`,
          `**Agent:** ${currentAgentName ?? "none"}`,
          `**Reason:** ${typeof input.reason === "string" ? input.reason : "unknown"}`,
          phasesVisitedThisSession.size > 0 ? `**Phases:** ${[...phasesVisitedThisSession].join(", ")}` : `**Phases:** none`,
          ``,
          `## Summary`,
          ``,
          summary,
          ``,
          `## Files Touched`,
          ``,
          editedFilesThisSession.size > 0 ? [...editedFilesThisSession].map((f) => `- ${f}`).join(`
`) : "_No files edited._"
        ].join(`
`);
        const openagentDir = path8.join(cwd, ".openagent");
        await mkdir5(openagentDir, { recursive: true });
        await writeFile5(path8.join(openagentDir, "last-session.md"), lastSessionContent, "utf8");
        const gitignorePath = path8.join(openagentDir, ".gitignore");
        if (!existsSync8(gitignorePath)) {
          await writeFile5(gitignorePath, `last-session.md
`, "utf8");
        }
        await recordContinuousImprovementArtifact({
          cwd,
          source: "session-end",
          title: "Session follow-up candidate",
          summary,
          evidence: [
            `Session reason: ${typeof input.reason === "string" ? input.reason : "unknown"}`,
            currentAgentName ? `Agent at session end: ${currentAgentName}` : "Agent at session end: none",
            input.finalMessage ? `Final message preview: ${truncatePlainText(input.finalMessage, 240)}` : "Final message preview unavailable"
          ],
          recommendations: [
            "Promote repeated lessons into `.openagent/rules/*.md` or `AGENTS.md` instead of relying on isolated session outputs.",
            "Store recurring but not-yet-stable repo guidance in repo-scoped memory."
          ],
          session: session ?? undefined,
          config: resolution.config
        });
      } catch {}
      return {
        sessionSummary: summary
      };
    },
    onErrorOccurred: async (input) => {
      if (!input.recoverable) {
        return {
          errorHandling: "abort",
          userNotification: "OpenAgent stopped because the Copilot host marked the error as unrecoverable."
        };
      }
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      const recovery = classifyRecoveryError(input.error);
      const session = safeGetSession(getSession);
      const agentName = getCurrentAgentName();
      if (agentName) {
        let currentModelId = null;
        if (session) {
          try {
            const currentModel = await session.rpc.model.getCurrent();
            currentModelId = currentModel.modelId ?? null;
          } catch {
            currentModelId = null;
          }
        }
        const result = advanceFallback(agentName, {
          currentModelId,
          userOverrides: resolution.config.agentOverrides
        });
        if (result !== null && session) {
          const switched = await switchSessionModelTarget(session, result.target);
          if (switched) {
            syncFallbackState(agentName, result.target.model);
            return {
              errorHandling: "retry",
              retryCount: 1,
              userNotification: `OpenAgent switched to fallback model ${formatModelTarget(result.target)} ` + `after ${recovery.description}.`
            };
          }
        }
        if (result !== null) {
          return {
            errorHandling: "retry",
            retryCount: 1,
            userNotification: `OpenAgent prepared fallback target ${formatModelTarget(result.target)} ` + `after ${recovery.description}.`
          };
        }
      }
      if (session && recovery.shouldPersistNote && isOpenAgentWorkspaceAvailable(session)) {
        try {
          const note = await writeOpenAgentWorkspaceNote({
            session,
            config: resolution.config,
            relativePath: `recovery/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
            content: [
              "# OpenAgent recovery note",
              "",
              `Timestamp: ${new Date().toISOString()}`,
              `Error context: ${input.errorContext}`,
              `Recovery kind: ${recovery.kind}`,
              "",
              "## Error",
              input.error
            ].join(`
`),
            mode: "replace"
          });
          return {
            errorHandling: "retry",
            retryCount: 1,
            userNotification: `OpenAgent is retrying after ${recovery.description}. ` + `Recovery note saved to ${note.workspaceRelativePath}.`
          };
        } catch {}
      }
      return {
        errorHandling: "retry",
        retryCount: 1,
        userNotification: `OpenAgent is retrying after ${recovery.description}.`
      };
    }
  };
}

// src/agent-selection.ts
async function syncOpenAgentAgentState(args) {
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
async function selectOpenAgentAgent(args) {
  const { session, agentName, config } = args;
  const result = await session.rpc.agent.select({ name: agentName });
  await syncOpenAgentAgentState({ session, agentName, config });
  return result;
}
async function initializeOpenAgentAgentState(args) {
  const { session, config } = args;
  const current = await session.rpc.agent.getCurrent();
  const currentAgentName2 = current.agent?.name;
  if (!currentAgentName2 || !isOpenAgentAgentName(currentAgentName2)) {
    return null;
  }
  await syncOpenAgentAgentState({
    session,
    agentName: currentAgentName2,
    config
  });
  return currentAgentName2;
}

// src/agents.ts
function appendProjectDirectives(config) {
  return config.systemDirectives.length > 0 ? `

Project directives:
${config.systemDirectives.map((directive) => `- ${directive}`).join(`
`)}` : "";
}
function createCustomAgents(config) {
  const directives = appendProjectDirectives(config);
  const builtinAgents = [
    {
      name: "conductor",
      displayName: "Conductor",
      description: "Lead engineer that owns the full task. Invokes specialist agents, verifies all outputs, and gates every transition.",
      prompt: [
        "You are the Conductor. You are the lead engineer. You own the full task, the plan, and every decision.",
        "Invoke specialists for bounded jobs — planner for plans, critic for plan review, researcher/explorer for context, implementer for code changes, reviewer/QA/oracle for verification.",
        "Verify every implementer output before trusting it: read the changed code, run build and test commands, and check that the work satisfies the plan.",
        "Only mark a task complete after verification passes. Do not trust an implementer's self-reported 'done'.",
        "You are the gate at every transition. Route work to specialists and receive their output. Never hand off final decision-making.",
        "Do not edit code or run shell commands yourself — delegate all implementation."
      ].join(" ")
    },
    {
      name: "architect",
      displayName: "Architect",
      description: "Subagent that turns ambiguous work into a concrete implementation plan with sequenced tasks, dependencies, and verification steps.",
      prompt: [
        "You are the Architect. You are invoked to produce a concrete, executable plan.",
        "Break down the request into sequenced tasks with explicit dependencies and file conflict warnings.",
        "Include verification steps for each task — what to check, what command to run, what behavior to expect.",
        "Ground the plan in the actual codebase. Reference real files, patterns, and constraints.",
        "Return the plan to the orchestrator. Do not decide whether to proceed, and do not implement.",
        "Do not edit code or run shell commands."
      ].join(" ")
    },
    {
      name: "skeptic",
      displayName: "Skeptic",
      description: "Dead-end subagent that reviews a plan and returns a verdict. Does not pass work to anyone — returns to the orchestrator.",
      prompt: [
        "You are the Skeptic. You are a dead-end reviewer. You take a plan, inspect it, and return a verdict. You never pass work to the implementer.",
        "Answer one question: can a capable developer execute this plan without getting stuck?",
        "Verify that referenced files exist and line numbers are correct. Check that each task provides a starting point — a file, a pattern, or a concrete direction.",
        "Only reject for truly blocking issues: missing information, contradictions, nonexistent references, tasks with zero actionable context.",
        "Do NOT reject for: missing edge cases, style preferences, minor ambiguities, architecture preferences, or code quality opinions.",
        "Return [OKAY] if the plan is executable (80% clear is good enough). Return [REJECT] with at most three specific, actionable blocking issues.",
        "Do not edit code or run commands. Do not suggest alternative plans. Return your verdict to the orchestrator."
      ].join(" ")
    },
    {
      name: "scout",
      displayName: "Scout",
      description: "Fast, read-only background subagent for locating files, symbols, and code paths. Returns compact evidence-backed summaries.",
      prompt: [
        "You are the Scout. You are a fast, read-only background subagent.",
        "Locate files by pattern, find symbol definitions and references, and trace data flow through the codebase.",
        "Return a compact, evidence-backed summary with file paths and line references.",
        "Prefer fast, targeted searches over exhaustive sweeps. The caller wants answers, not a dump.",
        "Do not edit code, do not implement, do not make decisions. Return findings to the caller."
      ].join(" ")
    },
    {
      name: "builder",
      displayName: "Builder",
      description: "Subagent that executes assigned plan tasks. Returns code changes and a report. Does not mark its own work complete — the orchestrator verifies.",
      prompt: [
        "You are the Builder. You execute assigned tasks from the plan and return a report.",
        "Read the assigned task from the plan. Understand exactly what you are being asked to do before touching code.",
        "Make precise, surgical changes. Prefer targeted edits over broad refactors.",
        "Run the project's build, lint, and test commands after each meaningful change.",
        "Return a clear report: exactly what files changed, why, what commands you ran to verify, and what the orchestrator should check.",
        "Do not work on tasks outside your assignment. Do not claim the work is 'done' — the orchestrator verifies. Do not route to other phases."
      ].join(" ")
    },
    {
      name: "auditor",
      displayName: "Auditor",
      description: "Post-implementation subagent that reviews code for correctness, regressions, edge cases, and missing follow-through.",
      prompt: [
        "You are the Auditor. You review completed implementation work for correctness and quality.",
        "Check correctness (does the code do what was specified?), regressions (could this break existing behavior?), edge cases (empty input, errors, boundaries), and pattern consistency.",
        "Classify findings as CRITICAL (likely bug, crash, data loss), MAJOR (should fix before merge), or MINOR (worthwhile but not blocking). Only CRITICAL and MAJOR are blocking.",
        "Run the project's build and test commands to verify no regressions.",
        "Return a structured review: verdict (PASS/FAIL), blocking issues with file paths and line references, and a summary.",
        "Do not comment on style, naming, or formatting. Do not edit code — report issues, do not fix them. Do not run the app or do hands-on testing — that is QA's role."
      ].join(" ")
    },
    {
      name: "oracle",
      displayName: "Oracle",
      description: "Post-implementation subagent for architecture review, goal verification, security audit, and cross-cutting design critique.",
      prompt: [
        "You are the Oracle. You review architecture, verify goals, and reason about cross-cutting concerns.",
        "Check goal completeness (does the implementation satisfy the original request and all explicit constraints?), architecture (are module boundaries and data flow sound?), over-engineering (scope creep?), and security (input validation, secrets, auth, data exposure).",
        "Anchor conclusions in repository evidence, not speculation.",
        "Return a structured review: verdict (PASS/FAIL) with confidence, goal breakdown with evidence, architecture and security findings with file paths.",
        "Do not edit code or run commands. Do not review plan sequencing — that is the critic's role. Do not review code style — that is the reviewer's role."
      ].join(" ")
    },
    {
      name: "tester",
      displayName: "Tester",
      description: "Post-implementation subagent that verifies behavior by running the app. Hands-on testing, not code review.",
      prompt: [
        "You are the Tester specialist. Your job is to RUN the application and verify it works through hands-on testing. You do not review code — you test behavior.",
        "Brainstorm test scenarios (happy paths, boundary conditions, error paths, regressions), classify them as P0/P1/P2, then execute systematically.",
        "Adapt to the project: navigate and interact with web apps, run commands with args for CLIs, write import scripts for libraries, use curl for APIs.",
        "For each test: execute steps, record actual vs expected result, mark PASS/FAIL, capture evidence if failed.",
        "If the app cannot start or build, immediately report FAIL.",
        "Return: verdict (PASS/FAIL), confidence, scenario coverage, per-test results, and blocking issues (P0 and P1 failures only).",
        "Do not change code. Do not review code for correctness — that is the reviewer's role. Do not review architecture — that is the oracle's role."
      ].join(" ")
    },
    {
      name: "sleuth",
      displayName: "Sleuth",
      description: "Background subagent for deep investigation of unfamiliar code, APIs, architecture, or external references. Returns grounded findings.",
      prompt: [
        "You are the Sleuth. You investigate unfamiliar territory and return structured findings.",
        "Gather evidence from the codebase, documentation, and external references.",
        "Bias toward concrete references (file paths, line numbers, doc links) and minimal speculation. Clearly separate evidence from inference.",
        "Return a structured summary: what was investigated, key findings with source references, open questions, and recommended next step.",
        "Do not edit code or start implementing. Do not make decisions — return findings to the caller."
      ].join(" ")
    }
  ];
  function finalizePrompt(agentName, prompt) {
    const promptAppend = config.agents[agentName]?.promptAppend;
    const parts = [prompt.trim()];
    if (promptAppend && promptAppend.trim().length > 0) {
      parts.push(promptAppend.trim());
    }
    if (directives.length > 0) {
      parts.push(directives.trim());
    }
    return parts.join(`

`);
  }
  const agentsByName = new Map(builtinAgents.map((agent) => [agent.name, agent]));
  for (const [agentKey, definition] of Object.entries(config.agents)) {
    const existing = agentsByName.get(agentKey);
    if (existing) {
      if (definition.displayName) {
        existing.displayName = definition.displayName;
      }
      if (definition.description) {
        existing.description = definition.description;
      }
      if (definition.prompt) {
        existing.prompt = definition.prompt;
      }
    } else {
      if (definition.displayName && definition.description && definition.prompt) {
        const newAgent = {
          name: agentKey,
          displayName: definition.displayName,
          description: definition.description,
          prompt: definition.prompt
        };
        builtinAgents.push(newAgent);
        agentsByName.set(agentKey, newAgent);
      }
    }
  }
  const disabledSet = new Set(config.disabledAgents);
  return builtinAgents.filter((agent) => !disabledSet.has(agent.name)).map((agent) => ({
    ...agent,
    prompt: finalizePrompt(agent.name, agent.prompt)
  }));
}

// src/commands.ts
import { existsSync as existsSync16 } from "node:fs";
import * as path15 from "node:path";

// src/bootstrap-confidence.ts
function computeBootstrapConfidence(input) {
  const factors = [];
  if (input.isExplicitOverride) {
    factors.push("caller explicitly selected the phase");
    return { score: 1, factors };
  }
  let score = 0.4;
  if (input.keywordMatchCount >= 3) {
    score += 0.3;
    factors.push(`${input.keywordMatchCount} keyword matches (strong signal)`);
  } else if (input.keywordMatchCount >= 1) {
    score += 0.15;
    factors.push(`${input.keywordMatchCount} keyword match(es)`);
  } else {
    factors.push("no keyword matches (relying on heuristics)");
  }
  if (input.hasExplicitScope) {
    score += 0.15;
    factors.push("request references explicit files, tools, or paths");
  }
  if (input.isShortSingleLine && input.hasImplementationVerb && input.hasExplicitScope) {
    score += 0.1;
    factors.push("tightly scoped single-line implementation request");
  }
  if (input.looksComplex) {
    score += 0.05;
    factors.push("request heuristically looks multi-step");
  }
  if (!input.hasExplicitScope && input.keywordMatchCount === 0) {
    score -= 0.1;
    factors.push("no scope signal and no keywords (low confidence in classification)");
  }
  const clampedScore = Math.max(0.1, Math.min(1, score));
  return { score: parseFloat(clampedScore.toFixed(2)), factors };
}

// src/bootstrap-history.ts
import { existsSync as existsSync9 } from "node:fs";
import { mkdir as mkdir6, readFile as readFile7, writeFile as writeFile6 } from "node:fs/promises";
import * as path9 from "node:path";
var MAX_HISTORY_ENTRIES2 = 50;
function isRecord4(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getBootstrapHistoryPath(session, config) {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path9.join(paths.notesRoot, "bootstrap", "history.json");
}
function sanitizeEntry2(value) {
  if (!isRecord4(value)) {
    return null;
  }
  if (typeof value.timestamp !== "string" || typeof value.requestSummary !== "string" || typeof value.selectedPhase !== "string" || typeof value.phaseReason !== "string" || typeof value.requestedBy !== "string" || typeof value.explicitOverride !== "boolean" || !isRecord4(value.confidence) || typeof value.confidence.score !== "number" || !Array.isArray(value.confidence.factors)) {
    return null;
  }
  return {
    timestamp: value.timestamp,
    requestSummary: value.requestSummary,
    selectedPhase: value.selectedPhase,
    phaseReason: value.phaseReason,
    confidence: {
      score: value.confidence.score,
      factors: value.confidence.factors.filter((factor) => typeof factor === "string")
    },
    requestedBy: value.requestedBy,
    explicitOverride: value.explicitOverride
  };
}
function sanitizeHistory2(value) {
  const empty = { entries: [], updatedAt: new Date().toISOString() };
  if (!isRecord4(value)) {
    return empty;
  }
  const entries = Array.isArray(value.entries) ? value.entries.map(sanitizeEntry2).filter((entry) => entry !== null) : [];
  return {
    entries,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : empty.updatedAt
  };
}
async function readBootstrapHistory(session, config) {
  const historyPath = getBootstrapHistoryPath(session, config);
  if (!existsSync9(historyPath)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = await readFile7(historyPath, "utf8");
    return sanitizeHistory2(JSON.parse(raw));
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}
async function appendBootstrapHistory(session, config, entry) {
  const history = await readBootstrapHistory(session, config);
  const historyPath = getBootstrapHistoryPath(session, config);
  history.entries.push(entry);
  if (history.entries.length > MAX_HISTORY_ENTRIES2) {
    history.entries = history.entries.slice(-MAX_HISTORY_ENTRIES2);
  }
  history.updatedAt = new Date().toISOString();
  await mkdir6(path9.dirname(historyPath), { recursive: true });
  await writeFile6(historyPath, JSON.stringify(history, null, 2), "utf8");
  return history;
}
function formatBootstrapHistorySummary(history) {
  if (history.entries.length === 0) {
    return "No bootstrap history in this session.";
  }
  const latest = history.entries[history.entries.length - 1];
  const phaseCounts = new Map;
  let totalConfidence = 0;
  for (const entry of history.entries) {
    phaseCounts.set(entry.selectedPhase, (phaseCounts.get(entry.selectedPhase) ?? 0) + 1);
    totalConfidence += entry.confidence.score;
  }
  const avgConfidence = totalConfidence / history.entries.length;
  const phaseBreakdown = Array.from(phaseCounts.entries()).sort((a, b) => b[1] - a[1]).map(([phase, count]) => `${phase}=${count}`).join(", ");
  const lines = [
    `bootstrap invocations: ${history.entries.length}`,
    `phase breakdown: ${phaseBreakdown}`,
    `average confidence: ${avgConfidence.toFixed(2)}`,
    `latest bootstrap: ${latest.selectedPhase} (confidence: ${latest.confidence.score.toFixed(2)}, ${latest.explicitOverride ? "explicit override" : "auto-classified"})`,
    `latest reason: ${latest.phaseReason}`
  ];
  if (latest.confidence.factors.length > 0) {
    lines.push(`latest confidence factors: ${latest.confidence.factors.join("; ")}`);
  }
  return lines.join(`
`);
}

// src/plan.ts
async function updateSessionPlan(args) {
  const { session, content } = args;
  const requestedMode = args.mode === "replace" ? "replace" : "append";
  const currentPlan = await session.rpc.plan.read();
  const previousContent = currentPlan.content ?? "";
  const mode = requestedMode === "replace" || previousContent.trim().length === 0 ? "replace" : "append";
  const nextContent = mode === "replace" ? content : `${previousContent.trimEnd()}

${content}`;
  await session.rpc.plan.update({ content: nextContent });
  return {
    path: currentPlan.path ?? null,
    mode,
    previousContent,
    nextContent
  };
}

// src/routing.ts
import { existsSync as existsSync10 } from "node:fs";
import { mkdir as mkdir7, readFile as readFile8, writeFile as writeFile7 } from "node:fs/promises";
var OPENAGENT_PHASES = [
  "orchestrator",
  "planner",
  "researcher",
  "implementer",
  "reviewer"
];
var PHASE_DEFINITIONS = {
  orchestrator: {
    agent: "conductor",
    agents: ["conductor"],
    mode: "interactive",
    description: "Coordinate the full task, choose the next phase, and keep the overall plan coherent."
  },
  planner: {
    agent: "architect",
    agents: ["architect", "skeptic"],
    mode: "plan",
    description: "Clarify scope, sequence the work, and produce an implementation-ready plan."
  },
  researcher: {
    agent: "sleuth",
    agents: ["sleuth", "scout"],
    mode: "interactive",
    description: "Investigate unfamiliar code or APIs and return grounded findings."
  },
  implementer: {
    agent: "builder",
    agents: ["builder"],
    mode: "autopilot",
    description: "Execute the planned change and carry the implementation through to completion."
  },
  reviewer: {
    agent: "auditor",
    agents: ["auditor", "oracle", "tester"],
    mode: "interactive",
    description: "Review the work for correctness, regressions, and missing follow-through."
  }
};
function isRecord5(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOpenAgentMode(value) {
  return value === "interactive" || value === "plan" || value === "autopilot";
}
function isOpenAgentPhase(value) {
  return OPENAGENT_PHASES.includes(value);
}
function listOpenAgentPhases() {
  return OPENAGENT_PHASES.join(", ");
}
function inferAgentName(rawAgentName) {
  if (rawAgentName && isOpenAgentAgentName(rawAgentName)) {
    return rawAgentName;
  }
  return PHASE_DEFINITIONS.orchestrator.agent;
}
function inferOpenAgentPhase(rawAgentName) {
  const agentName = inferAgentName(rawAgentName);
  switch (agentName) {
    case "architect":
    case "skeptic":
      return "planner";
    case "sleuth":
    case "scout":
      return "researcher";
    case "builder":
      return "implementer";
    case "auditor":
    case "oracle":
    case "tester":
      return "reviewer";
    default:
      return "orchestrator";
  }
}
function resolveTargetAgent(phase, requestedAgent) {
  const definition = PHASE_DEFINITIONS[phase];
  if (!requestedAgent) {
    return definition.agent;
  }
  if (!definition.agents.includes(requestedAgent)) {
    throw new Error(`Agent "${requestedAgent}" is not available for phase "${phase}". Allowed agents: ${definition.agents.join(", ")}.`);
  }
  return requestedAgent;
}
function sanitizeTransitions(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => {
    if (!isRecord5(entry)) {
      return false;
    }
    return typeof entry.timestamp === "string" && typeof entry.objective === "string" && typeof entry.handoffPath === "string" && typeof entry.requestedBy === "string" && typeof entry.fromAgent === "string" && isOpenAgentAgentName(entry.fromAgent) && typeof entry.toAgent === "string" && isOpenAgentAgentName(entry.toAgent) && typeof entry.fromPhase === "string" && isOpenAgentPhase(entry.fromPhase) && typeof entry.toPhase === "string" && isOpenAgentPhase(entry.toPhase) && isOpenAgentMode(entry.fromMode) && isOpenAgentMode(entry.toMode);
  });
}
function sanitizeBootstrapContext(value) {
  if (!isRecord5(value)) {
    return null;
  }
  if (typeof value.lastBootstrapPhase !== "string" || typeof value.lastBootstrapConfidence !== "number" || typeof value.lastBootstrapReason !== "string" || typeof value.totalBootstraps !== "number") {
    return null;
  }
  return {
    lastBootstrapPhase: value.lastBootstrapPhase,
    lastBootstrapConfidence: value.lastBootstrapConfidence,
    lastBootstrapReason: value.lastBootstrapReason,
    totalBootstraps: value.totalBootstraps
  };
}
function sanitizeRouteState(value) {
  if (!isRecord5(value)) {
    return null;
  }
  if (typeof value.currentPhase !== "string" || !isOpenAgentPhase(value.currentPhase) || typeof value.currentAgent !== "string" || !isOpenAgentAgentName(value.currentAgent) || !isOpenAgentMode(value.currentMode) || typeof value.updatedAt !== "string") {
    return null;
  }
  return {
    currentPhase: value.currentPhase,
    currentAgent: value.currentAgent,
    currentMode: value.currentMode,
    latestHandoffPath: typeof value.latestHandoffPath === "string" ? value.latestHandoffPath : null,
    updatedAt: value.updatedAt,
    transitions: sanitizeTransitions(value.transitions),
    bootstrapContext: sanitizeBootstrapContext(value.bootstrapContext)
  };
}
async function readOpenAgentRouteState(args) {
  const { session, config } = args;
  if (!session.workspacePath) {
    return null;
  }
  const { routeStateFile } = getOpenAgentWorkspacePaths({ session, config });
  if (!existsSync10(routeStateFile)) {
    return null;
  }
  try {
    const content = await readFile8(routeStateFile, "utf8");
    const parsed = JSON.parse(content);
    return sanitizeRouteState(parsed);
  } catch {
    return null;
  }
}
async function writeOpenAgentRouteState(args) {
  const { session, config, state } = args;
  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir7(paths.routingRoot, { recursive: true });
  await writeFile7(paths.routeStateFile, JSON.stringify(state, null, 2), "utf8");
}
async function syncPlanForRoute(args) {
  const { session, request, fromPhase, handoffWorkspacePath, targetAgent, targetMode } = args;
  if (request.syncPlan === false) {
    return false;
  }
  const section = [
    `## OpenAgent phase route ${new Date().toISOString()}`,
    `- from: ${fromPhase}`,
    `- to: ${request.phase}`,
    `- target agent: ${targetAgent}`,
    `- target mode: ${targetMode}`,
    `- objective: ${request.objective}`,
    `- handoff note: ${handoffWorkspacePath}`
  ].join(`
`);
  await updateSessionPlan({
    session,
    content: section,
    mode: "append"
  });
  return true;
}
async function routeOpenAgentPhase(args) {
  const { session, config, request } = args;
  if (request.phase === "implementer") {
    throw new Error("Direct routing to the implementer phase is not supported. Use the `openagent_fleet` tool to register implementation tasks, then dispatch builders via the `agent` tool. This keeps the conductor in orchestrator phase while builders run in parallel.");
  }
  requireOpenAgentWorkspacePath(session, "OpenAgent routing");
  const timestamp = new Date().toISOString();
  const existingState = await readOpenAgentRouteState({ session, config });
  const [currentAgentResult, currentModeResult] = await Promise.all([
    session.rpc.agent.getCurrent(),
    session.rpc.mode.get()
  ]);
  const fromAgent = inferAgentName(currentAgentResult.agent?.name);
  const fromPhase = existingState?.currentPhase ?? inferOpenAgentPhase(currentAgentResult.agent?.name);
  const fromMode = isOpenAgentMode(currentModeResult) ? currentModeResult : PHASE_DEFINITIONS[fromPhase].mode;
  const targetDefinition = PHASE_DEFINITIONS[request.phase];
  const targetAgent = resolveTargetAgent(request.phase, request.agent);
  const targetMode = request.mode && request.mode !== "default" ? request.mode : targetDefinition.mode;
  const requestedBy = request.requestedBy?.trim() || "openagent";
  const slug = timestamp.replace(/[:.]/g, "-");
  const handoffContent = [
    "# OpenAgent phase handoff",
    "",
    `Timestamp: ${timestamp}`,
    `From phase: ${fromPhase}`,
    `To phase: ${request.phase}`,
    `From agent: ${fromAgent}`,
    `To agent: ${targetAgent}`,
    `From mode: ${fromMode}`,
    `To mode: ${targetMode}`,
    `Requested by: ${requestedBy}`,
    "",
    "## Objective",
    request.objective.trim(),
    "",
    "## Handoff",
    request.handoff.trim()
  ].join(`
`);
  const note = await writeOpenAgentWorkspaceNote({
    session,
    config,
    relativePath: `routing/handoffs/${slug}-${request.phase}.md`,
    content: handoffContent,
    mode: "replace"
  });
  const planUpdated = await syncPlanForRoute({
    session,
    request,
    fromPhase,
    handoffWorkspacePath: note.workspaceRelativePath,
    targetAgent,
    targetMode
  });
  const agentResult = await selectOpenAgentAgent({
    session,
    agentName: targetAgent,
    config
  });
  if (targetMode !== currentModeResult) {
    await session.rpc.mode.set({ mode: targetMode });
  }
  const nextState = {
    currentPhase: request.phase,
    currentAgent: inferAgentName(agentResult.agent.name),
    currentMode: targetMode,
    latestHandoffPath: note.workspaceRelativePath,
    updatedAt: timestamp,
    transitions: [
      ...existingState?.transitions ?? [],
      {
        timestamp,
        fromPhase,
        toPhase: request.phase,
        fromAgent,
        toAgent: targetAgent,
        fromMode,
        toMode: targetMode,
        objective: request.objective.trim(),
        handoffPath: note.workspaceRelativePath,
        requestedBy
      }
    ].slice(-25),
    bootstrapContext: request.bootstrapContext ?? existingState?.bootstrapContext ?? null
  };
  await writeOpenAgentRouteState({ session, config, state: nextState });
  return {
    phase: request.phase,
    agent: nextState.currentAgent,
    mode: nextState.currentMode,
    handoffWorkspacePath: note.workspaceRelativePath,
    planUpdated,
    previousPhase: fromPhase
  };
}
async function formatOpenAgentRoutingStatus(args) {
  const { session, config } = args;
  const [currentAgentResult, currentModeResult, state] = await Promise.all([
    session.rpc.agent.getCurrent(),
    session.rpc.mode.get(),
    readOpenAgentRouteState({ session, config })
  ]);
  const currentPhase = state?.currentPhase ?? inferOpenAgentPhase(currentAgentResult.agent?.name);
  const currentAgent = inferAgentName(currentAgentResult.agent?.name);
  const currentMode = isOpenAgentMode(currentModeResult) ? currentModeResult : PHASE_DEFINITIONS[currentPhase].mode;
  const lines = [
    "OpenAgent routing",
    `phase: ${currentPhase}`,
    `phase description: ${PHASE_DEFINITIONS[currentPhase].description}`,
    `phase agent: ${currentAgent}`,
    `phase mode: ${currentMode}`,
    `latest handoff: ${state?.latestHandoffPath ?? "none"}`,
    `recorded transitions: ${state?.transitions.length ?? 0}`
  ];
  if (state?.bootstrapContext) {
    const ctx = state.bootstrapContext;
    lines.push(`bootstrap-originated phase: ${ctx.lastBootstrapPhase}`, `bootstrap confidence: ${ctx.lastBootstrapConfidence.toFixed(2)}`, `bootstrap reason: ${ctx.lastBootstrapReason}`, `total bootstraps in route: ${ctx.totalBootstraps}`);
  }
  return lines.join(`
`);
}

// src/bootstrap.ts
var OPENAGENT_BOOTSTRAP_PHASES = [
  "planner",
  "researcher",
  "orchestrator"
];
var RESEARCH_KEYWORDS = [
  "analyze",
  "debug",
  "diagnose",
  "explore",
  "inspect",
  "investigate",
  "research",
  "root cause",
  "trace",
  "understand",
  "why"
];
var IMPLEMENTATION_KEYWORDS = [
  "add",
  "change",
  "create",
  "expose",
  "fix",
  "implement",
  "refactor",
  "remove",
  "rename",
  "replace",
  "update",
  "wire"
];
var EXPLICIT_SCOPE_PATTERN = /`[^`]+`|\/oa-[a-z0-9-]+|openagent_[a-z0-9_]+|\b[a-z0-9._-]+\.(?:ts|mts|js|json|md)\b|(?:^|\s)(?:src|files|\.github)[\\/]/i;
function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function summarizeRequest(request, maxChars = 140) {
  const normalized = normalizeWhitespace(request);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
function toBullets3(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function toNumberedList(lines) {
  return lines.map((line, index) => `${index + 1}. ${line}`).join(`
`);
}
function toBlockquote(value) {
  return value.trim().split(/\r?\n/).map((line) => `> ${line}`).join(`
`);
}
function includesAnyKeyword(normalizedRequest, keywords) {
  return keywords.some((keyword) => new RegExp(`(?:^|\\b)${escapeRegExp(keyword)}(?:\\b|$)`, "i").test(normalizedRequest));
}
function isTightlyScopedImplementerTask(request, normalizedRequest) {
  const lineCount = request.trim().split(/\r?\n/).length;
  const shortEnough = normalizeWhitespace(request).length <= 140;
  const hasExplicitScope = EXPLICIT_SCOPE_PATTERN.test(request);
  const hasImplementationVerb = includesAnyKeyword(normalizedRequest, IMPLEMENTATION_KEYWORDS);
  return lineCount === 1 && shortEnough && hasExplicitScope && hasImplementationVerb;
}
function isOpenAgentBootstrapPhase(value) {
  return OPENAGENT_BOOTSTRAP_PHASES.includes(value);
}
function listOpenAgentBootstrapPhases() {
  return OPENAGENT_BOOTSTRAP_PHASES.join(", ");
}
function classifyBootstrapPhase(request, config) {
  const normalizedRequest = normalizeWhitespace(request).toLowerCase();
  const looksComplex = looksComplexPrompt(request, config);
  const researchKeywordCount = RESEARCH_KEYWORDS.filter((kw) => includesAnyKeyword(normalizedRequest, [kw])).length;
  const implementKeywordCount = IMPLEMENTATION_KEYWORDS.filter((kw) => includesAnyKeyword(normalizedRequest, [kw])).length;
  const hasExplicitScope = EXPLICIT_SCOPE_PATTERN.test(request);
  const lineCount = request.trim().split(/\r?\n/).length;
  const shortEnough = normalizeWhitespace(request).length <= 140;
  const isShortSingleLine = lineCount === 1 && shortEnough;
  const hasImplementationVerb = includesAnyKeyword(normalizedRequest, IMPLEMENTATION_KEYWORDS);
  if (includesAnyKeyword(normalizedRequest, RESEARCH_KEYWORDS)) {
    return {
      phase: "researcher",
      reason: "The request uses investigate/debug/explore language, so OpenAgent should gather evidence before committing to edits.",
      confidence: computeBootstrapConfidence({
        keywordMatchCount: researchKeywordCount,
        hasExplicitScope,
        isShortSingleLine,
        hasImplementationVerb,
        looksComplex,
        isExplicitOverride: false
      })
    };
  }
  if (isTightlyScopedImplementerTask(request, normalizedRequest)) {
    return {
      phase: "orchestrator",
      reason: "The request is already tightly scoped to an explicit target, so OpenAgent can start in orchestrator and dispatch builders directly.",
      confidence: computeBootstrapConfidence({
        keywordMatchCount: implementKeywordCount,
        hasExplicitScope,
        isShortSingleLine,
        hasImplementationVerb,
        looksComplex,
        isExplicitOverride: false
      })
    };
  }
  return {
    phase: "planner",
    reason: looksComplex ? "The request looks multi-step, so OpenAgent should bootstrap it with an explicit plan before heavier execution." : "OpenAgent plans by default unless the request clearly calls for research or a tightly scoped implementation pass.",
    confidence: computeBootstrapConfidence({
      keywordMatchCount: researchKeywordCount + implementKeywordCount,
      hasExplicitScope,
      isShortSingleLine,
      hasImplementationVerb,
      looksComplex,
      isExplicitOverride: false
    })
  };
}
function buildBootstrapObjective(phase, requestSummary) {
  switch (phase) {
    case "researcher":
      return `Investigate the request and return grounded findings: ${requestSummary}`;
    case "orchestrator":
      return `Execute the scoped request end-to-end using fleet dispatch: ${requestSummary}`;
    default:
      return `Turn the request into an implementation-ready plan: ${requestSummary}`;
  }
}
function buildPhaseApproach(phase) {
  switch (phase) {
    case "researcher":
      return [
        "Inspect the relevant code, commands, or extension surfaces and collect concrete evidence.",
        "Explain the current behavior or gap before proposing edits.",
        "Turn the findings into a narrow implementation path before heavy changes.",
        "Capture follow-up notes or risks that should survive later turns."
      ];
    case "orchestrator":
      return [
        "Inspect the target files and understand the scope before delegating.",
        "Use `openagent_fleet` to register implementation tasks, then dispatch builders via the `agent` tool.",
        "Validate each wave by reading changed code and running build/test commands.",
        "Return a clear summary: what changed, what commands ran, and the results.",
        "Do not route to the implementer phase — dispatch builders directly."
      ];
    default:
      return [
        "Inspect the current codebase and constraints before committing to an approach.",
        "Break the work into concrete implementation tasks, dependencies, and verification steps.",
        "Return the plan to the conductor when ready. Do not route directly to implementation.",
        "The conductor decides whether to send the plan to the skeptic or proceed to fleet dispatch."
      ];
  }
}
function buildInitialPlan(args) {
  const timestamp = args.timestamp ?? new Date().toISOString();
  const requestSummary = summarizeRequest(args.request);
  const lines = [];
  if (args.includeTitle) {
    lines.push("# OpenAgent plan", "");
  }
  lines.push(`## OpenAgent bootstrap ${timestamp}`, `- requested by: ${args.requestedBy}`, `- request summary: ${requestSummary}`, `- selected phase: ${args.phase}`, `- phase rationale: ${args.phaseReason}`, `- classification confidence: ${args.confidence.score.toFixed(2)}`, `- confidence factors: ${args.confidence.factors.join("; ")}`, "", "### Raw request", toBlockquote(args.request), "", "### Initial approach", toNumberedList(buildPhaseApproach(args.phase)), "", "### Notes", toBullets3([
    "Route phase changes through the orchestrator so the handoff stays durable.",
    "Persist reusable artifacts under files/openagent/ when they will help later turns."
  ]));
  return lines.join(`
`);
}
function buildBootstrapHandoff(args) {
  return [
    "This task was bootstrapped from a raw request so the next phase can start with an explicit plan anchor and route.",
    "",
    `Requested by: ${args.requestedBy}`,
    `Selected starting phase: ${args.phase}`,
    `Phase rationale: ${args.phaseReason}`,
    "",
    "## Raw request",
    args.request.trim(),
    "",
    "## Immediate expectations",
    toBullets3(buildPhaseApproach(args.phase)),
    "",
    "## Coordination notes",
    toBullets3([
      "Keep the session plan current as the work becomes more concrete.",
      "Route through the orchestrator whenever the active phase should change.",
      "Persist durable follow-up artifacts under files/openagent/ when they will help future turns."
    ])
  ].join(`
`);
}
function formatOpenAgentBootstrapResult(result) {
  return [
    `OpenAgent bootstrapped the task for: ${result.requestSummary}`,
    `Selected phase: ${result.phase}`,
    `Selection reason: ${result.phaseReason}`,
    `Classification confidence: ${result.confidence.score.toFixed(2)}`,
    `Confidence factors: ${result.confidence.factors.join("; ")}`,
    `Selected agent: ${result.agent}`,
    `Mode: ${result.mode}`,
    `Plan updated: ${result.planWriteMode}`,
    `Plan path: ${result.planPath ?? "workspace-managed plan.md"}`,
    `Handoff note: ${result.handoffWorkspacePath}`,
    `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`
  ].join(`
`);
}
async function bootstrapOpenAgentTask(args) {
  const request = args.request.trim();
  if (request.length === 0) {
    throw new Error("OpenAgent bootstrap requires a non-empty request.");
  }
  requireOpenAgentWorkspacePath(args.session, "OpenAgent bootstrap");
  const requestedBy = args.requestedBy?.trim() || "openagent_bootstrap_task";
  const isExplicitOverride = Boolean(args.phase && args.phase !== "auto");
  const selection = isExplicitOverride && args.phase !== "auto" ? {
    phase: args.phase,
    reason: `The caller explicitly selected the ${args.phase} phase for bootstrap.`,
    confidence: computeBootstrapConfidence({
      keywordMatchCount: 0,
      hasExplicitScope: false,
      isShortSingleLine: false,
      hasImplementationVerb: false,
      looksComplex: false,
      isExplicitOverride: true
    })
  } : classifyBootstrapPhase(request, args.config);
  const currentPlan = await args.session.rpc.plan.read();
  const hasPlanContent = (currentPlan.content ?? "").trim().length > 0;
  const plan = await updateSessionPlan({
    session: args.session,
    mode: hasPlanContent ? "append" : "replace",
    content: buildInitialPlan({
      request,
      requestedBy,
      phase: selection.phase,
      phaseReason: selection.reason,
      confidence: selection.confidence,
      includeTitle: !hasPlanContent
    })
  });
  const existingHistory = await readBootstrapHistory(args.session, args.config);
  const totalBootstraps = existingHistory.entries.length + 1;
  const routeResult = await routeOpenAgentPhase({
    session: args.session,
    config: args.config,
    request: {
      phase: selection.phase,
      objective: buildBootstrapObjective(selection.phase, summarizeRequest(request)),
      handoff: buildBootstrapHandoff({
        request,
        requestedBy,
        phase: selection.phase,
        phaseReason: selection.reason
      }),
      requestedBy,
      syncPlan: args.syncPlan === false ? false : true,
      mode: args.mode,
      bootstrapContext: {
        lastBootstrapPhase: selection.phase,
        lastBootstrapConfidence: selection.confidence.score,
        lastBootstrapReason: selection.reason,
        totalBootstraps
      }
    }
  });
  const historyEntry = {
    timestamp: new Date().toISOString(),
    requestSummary: summarizeRequest(request),
    selectedPhase: selection.phase,
    phaseReason: selection.reason,
    confidence: selection.confidence,
    requestedBy,
    explicitOverride: isExplicitOverride
  };
  await appendBootstrapHistory(args.session, args.config, historyEntry);
  return {
    ...routeResult,
    planPath: plan.path,
    planWriteMode: plan.mode,
    requestSummary: summarizeRequest(request),
    phaseReason: selection.reason,
    confidence: selection.confidence
  };
}

// src/command-loader.ts
import { existsSync as existsSync11, readdirSync as readdirSync2, readFileSync as readFileSync2 } from "node:fs";
import * as os4 from "node:os";
import * as path10 from "node:path";
var MAX_CUSTOM_COMMANDS = 50;
function parseCommandFrontmatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return null;
  }
  const frontmatterBlock = match[1];
  const content = match[2].trim();
  let name;
  let description;
  for (const line of frontmatterBlock.split(/\r?\n/)) {
    if (/^name:\s*/.test(line)) {
      name = line.replace(/^name:\s*/, "").trim();
      continue;
    }
    if (/^description:\s*/.test(line)) {
      description = line.replace(/^description:\s*/, "").trim();
    }
  }
  if (!name || !description || content.length === 0) {
    return null;
  }
  return { name, description, content };
}
function scanCommandDirectory(dir) {
  try {
    if (!existsSync11(dir)) {
      return [];
    }
    return readdirSync2(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".md")).map((entry) => path10.join(dir, entry.name));
  } catch {
    return [];
  }
}
function pushUniquePath(output, value) {
  const resolved = path10.resolve(value);
  if (!output.includes(resolved)) {
    output.push(resolved);
  }
}
function getDefaultUserCommandDirectories(args) {
  const platform = args?.platform ?? process.platform;
  const env = args?.env ?? process.env;
  const homedir5 = args?.homedir ?? os4.homedir();
  const directories = [];
  if (platform === "win32") {
    const appData = env.APPDATA?.trim() || path10.join(homedir5, "AppData", "Roaming");
    pushUniquePath(directories, path10.join(appData, "openagent", "commands"));
    pushUniquePath(directories, path10.join(homedir5, ".config", "openagent", "commands"));
    return directories;
  }
  if (platform === "darwin") {
    pushUniquePath(directories, path10.join(homedir5, "Library", "Application Support", "openagent", "commands"));
  }
  const xdgConfigHome = env.XDG_CONFIG_HOME?.trim() ? path10.resolve(env.XDG_CONFIG_HOME.trim()) : path10.join(homedir5, ".config");
  pushUniquePath(directories, path10.join(xdgConfigHome, "openagent", "commands"));
  return directories;
}
function discoverCommandFiles(cwd) {
  const projectDir = path10.join(cwd, ".openagent", "commands");
  return [
    ...scanCommandDirectory(projectDir),
    ...getDefaultUserCommandDirectories().flatMap((dir) => scanCommandDirectory(dir))
  ];
}
function loadCustomCommands(cwd) {
  const commands = [];
  const seenNames = new Set;
  for (const filePath of discoverCommandFiles(cwd)) {
    if (commands.length >= MAX_CUSTOM_COMMANDS) {
      break;
    }
    try {
      const raw = readFileSync2(filePath, "utf8");
      const parsed = parseCommandFrontmatter(raw);
      if (!parsed || seenNames.has(parsed.name)) {
        continue;
      }
      seenNames.add(parsed.name);
      commands.push({
        name: parsed.name,
        description: parsed.description,
        content: parsed.content,
        source: filePath
      });
    } catch {
      continue;
    }
  }
  return commands;
}
function renderCustomCommandPrompt(command, args) {
  const trimmedArgs = args.trim();
  if (command.content.includes("{{args}}")) {
    return command.content.replaceAll("{{args}}", trimmedArgs);
  }
  if (trimmedArgs.length === 0) {
    return command.content;
  }
  return [
    command.content,
    "",
    "## Command arguments",
    trimmedArgs
  ].join(`
`);
}

// src/doctor.ts
import { spawnSync } from "node:child_process";

// src/bundled-deps.ts
import { existsSync as existsSync12, readFileSync as readFileSync3 } from "node:fs";
import { createRequire } from "node:module";
import * as path11 from "node:path";
var require2 = createRequire(import.meta.url);
function tryResolve(value) {
  try {
    const resolved = value();
    return existsSync12(resolved) ? resolved : null;
  } catch {
    return null;
  }
}
function resolveBundledAstGrepBinary() {
  const packageJsonPath = tryResolve(() => require2.resolve("@ast-grep/cli/package.json"));
  if (!packageJsonPath) {
    return null;
  }
  const packageRoot = path11.dirname(packageJsonPath);
  const directCandidates = process.platform === "win32" ? [
    path11.join(packageRoot, "ast-grep.exe"),
    path11.join(packageRoot, "sg.exe"),
    path11.join(packageRoot, "ast-grep"),
    path11.join(packageRoot, "sg")
  ] : [path11.join(packageRoot, "ast-grep"), path11.join(packageRoot, "sg")];
  const directBinary = directCandidates.find((candidate) => existsSync12(candidate)) ?? null;
  if (directBinary) {
    if (path11.extname(directBinary).toLowerCase() === ".exe") {
      return directBinary;
    }
    try {
      const shimPreview = readFileSync3(directBinary, "utf8");
      if (!shimPreview.includes("shim file was executed")) {
        return directBinary;
      }
    } catch {
      return directBinary;
    }
  }
  const parts = [process.platform, process.arch];
  if (process.platform === "linux") {
    const report = process.report?.getReport();
    const isMusl = !report?.header?.glibcVersionRuntime;
    if (isMusl) {
      parts.push("musl");
    } else if (process.arch === "arm") {
      parts.push("gnueabihf");
    } else {
      parts.push("gnu");
    }
  } else if (process.platform === "win32") {
    parts.push("msvc");
  }
  const platformPackage = tryResolve(() => require2.resolve(`@ast-grep/cli-${parts.join("-")}/package.json`));
  if (!platformPackage) {
    return directBinary;
  }
  const platformRoot = path11.dirname(platformPackage);
  const binaryName = process.platform === "win32" ? "ast-grep.exe" : "ast-grep";
  return path11.join(platformRoot, binaryName);
}
function resolveBundledCopilotCliPath() {
  const sdkEntry = tryResolve(() => require2.resolve("@github/copilot-sdk"));
  if (!sdkEntry) {
    return null;
  }
  const sdkPackageRoot = path11.resolve(path11.dirname(sdkEntry), "..", "..");
  const copilotPackageRoot = path11.resolve(sdkPackageRoot, "../copilot");
  const candidates = [
    path11.join(copilotPackageRoot, "npm-loader.js"),
    path11.join(copilotPackageRoot, "index.js")
  ];
  return candidates.find((candidate) => existsSync12(candidate)) ?? null;
}

// src/doctor.ts
function getBinaryLookupCommand(platform = process.platform) {
  return platform === "win32" ? "where.exe" : "which";
}
function parseBinaryLookupOutput(stdout) {
  return stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? null;
}
function checkBinary(name) {
  const result = spawnSync(getBinaryLookupCommand(), [name], { encoding: "utf8" });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      return { name, path: null };
    }
    throw result.error;
  }
  const resolvedPath = result.status === 0 ? parseBinaryLookupOutput(result.stdout) : null;
  return {
    name,
    path: resolvedPath
  };
}
function formatBinaryLine(check) {
  return `- ${check.name}: ${check.path ?? "missing"}`;
}
async function runOpenAgentDoctor(args) {
  const { session, cwd, resolution } = args;
  const shouldWriteReport = args.writeReport !== false;
  const [mode, model, agent, plan, routingStatus] = await Promise.all([
    session.rpc.mode.get(),
    session.rpc.model.getCurrent(),
    session.rpc.agent.getCurrent(),
    session.rpc.plan.read(),
    formatOpenAgentRoutingStatus({
      session,
      config: resolution.config
    })
  ]);
  const binaryChecks = [
    "node",
    "npm",
    "git",
    "rg",
    "gh",
    "ast-grep",
    "tsserver",
    "typescript-language-server",
    "pdftotext",
    "pdfinfo",
    "identify",
    "file"
  ].map(checkBinary);
  const bundledChecks = [
    {
      name: "bundled ast-grep",
      path: resolveBundledAstGrepBinary()
    },
    {
      name: "bundled copilot cli",
      path: resolveBundledCopilotCliPath()
    }
  ];
  const missingBinaryNames = binaryChecks.filter((check) => {
    if (check.name === "ast-grep") {
      return check.path === null && bundledChecks[0].path === null;
    }
    return check.path === null;
  }).map((check) => check.name);
  const report = [
    "# OpenAgent doctor report",
    "",
    `cwd: ${cwd}`,
    `workspace path: ${session.workspacePath ?? "disabled"}`,
    `current mode: ${mode}`,
    `current model: ${model.modelId ?? "host default"}`,
    `current agent: ${agent.agent?.name ?? "host default"}`,
    `plan path: ${plan.path ?? "not available"}`,
    `plan exists: ${plan.exists ? "yes" : "no"}`,
    "",
    "## Config",
    formatConfigSummary(resolution),
    "",
    "## Routing",
    routingStatus,
    "",
    "## Binary checks",
    ...binaryChecks.map(formatBinaryLine),
    "",
    "## Bundled runtimes",
    ...bundledChecks.map(formatBinaryLine)
  ].join(`
`);
  let reportWorkspacePath = null;
  if (shouldWriteReport && isOpenAgentWorkspaceAvailable(session)) {
    const note = await writeOpenAgentWorkspaceNote({
      session,
      config: resolution.config,
      relativePath: `doctor/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      content: report,
      mode: "replace"
    });
    reportWorkspacePath = note.workspaceRelativePath;
  }
  const improvement = await recordContinuousImprovementArtifact({
    cwd,
    source: "doctor",
    title: "Doctor follow-up candidate",
    summary: missingBinaryNames.length > 0 ? `Doctor found missing local binaries: ${missingBinaryNames.join(", ")}. Promote stable setup guidance if these tools are routinely expected in this repo.` : "Doctor completed without missing binary checks. If doctor output reveals recurring config or workflow confusion, promote that guidance into rules or AGENTS.",
    evidence: [
      `Report path: ${reportWorkspacePath ?? "not written to workspace"}`,
      `Current mode: ${mode}`,
      `Current agent: ${agent.agent?.name ?? "host default"}`
    ],
    recommendations: [
      missingBinaryNames.length > 0 ? `Decide whether ${missingBinaryNames.join(", ")} should be documented in repo guidance.` : "Review whether any config, routing, or environment advice should become durable repo guidance.",
      "Promote repeated setup guidance into `.openagent/rules/*.md` before relying on repeated doctor runs."
    ],
    session,
    config: resolution.config
  });
  return {
    report,
    reportWorkspacePath,
    improvementWorkspacePath: improvement.workspaceRelativePath,
    improvementMemoryPath: improvement.memoryRelativePath
  };
}

// src/handoff.ts
import { existsSync as existsSync13 } from "node:fs";
import { readFile as readFile9 } from "node:fs/promises";
import * as path12 from "node:path";
function isRecord6(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function normalizeStringArray2(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((entry) => typeof entry === "string" && entry.length > 0);
}
function sanitizeArtifact(value) {
  if (!isRecord6(value)) {
    return null;
  }
  if (value.version !== 2 || typeof value.createdAt !== "string" || typeof value.requestedBy !== "string" || typeof value.fromPhase !== "string" || typeof value.fromAgent !== "string" || typeof value.fromMode !== "string" || typeof value.toPhase !== "string" || typeof value.toAgent !== "string" || typeof value.goal !== "string") {
    return null;
  }
  return {
    version: 2,
    createdAt: value.createdAt,
    requestedBy: value.requestedBy,
    fromPhase: value.fromPhase,
    fromAgent: value.fromAgent,
    fromMode: value.fromMode,
    toPhase: value.toPhase,
    toAgent: value.toAgent,
    goal: value.goal,
    workDone: normalizeStringArray2(value.workDone),
    openRisks: normalizeStringArray2(value.openRisks),
    nextSteps: normalizeStringArray2(value.nextSteps),
    touchedFiles: normalizeStringArray2(value.touchedFiles),
    refs: normalizeStringArray2(value.refs),
    latestHandoffPath: typeof value.latestHandoffPath === "string" ? value.latestHandoffPath : null
  };
}
function toBullets4(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function formatOptionalSection(title, lines) {
  return lines.length > 0 ? ["", title, toBullets4(lines)] : [];
}
function buildOpenAgentResumeHandoff(artifact, extraContext) {
  return [
    "Resume this handoff artifact exactly as the durable source of truth.",
    "",
    `Created at: ${artifact.createdAt}`,
    `Requested by: ${artifact.requestedBy}`,
    `From: ${artifact.fromPhase} / ${artifact.fromAgent} / ${artifact.fromMode}`,
    `To: ${artifact.toPhase} / ${artifact.toAgent}`,
    "",
    "## Goal",
    artifact.goal,
    ...formatOptionalSection("## Work done", artifact.workDone),
    ...formatOptionalSection("## Open risks", artifact.openRisks),
    ...formatOptionalSection("## Next steps", artifact.nextSteps),
    ...formatOptionalSection("## Touched files", artifact.touchedFiles),
    ...formatOptionalSection("## References", artifact.refs),
    ...extraContext && extraContext.trim().length > 0 ? ["", "## Resume note", extraContext.trim()] : []
  ].join(`
`);
}
async function writeOpenAgentHandoffArtifact(args) {
  requireOpenAgentWorkspacePath(args.session, "OpenAgent handoff");
  const [agentResult, modeResult, planResult, routeState] = await Promise.all([
    args.session.rpc.agent.getCurrent(),
    args.session.rpc.mode.get(),
    args.session.rpc.plan.read(),
    readOpenAgentRouteState({
      session: args.session,
      config: args.config
    })
  ]);
  const fromAgent = args.fromAgent ?? routeState?.currentAgent ?? agentResult.agent?.name ?? "conductor";
  const fromPhase = args.fromPhase ?? routeState?.currentPhase ?? inferOpenAgentPhase(fromAgent);
  const fromMode = args.fromMode ?? routeState?.currentMode ?? modeResult ?? "interactive";
  const latestHandoffPath = args.latestHandoffPath ?? routeState?.latestHandoffPath ?? null;
  const toPhase = inferOpenAgentPhase(args.targetAgent);
  const artifact = {
    version: 2,
    createdAt: new Date().toISOString(),
    requestedBy: args.requestedBy,
    fromPhase,
    fromAgent,
    fromMode,
    toPhase,
    toAgent: args.targetAgent,
    goal: args.goal.trim(),
    workDone: args.workDone && args.workDone.length > 0 ? args.workDone : [
      `Current phase before handoff: ${fromPhase}`,
      `Current agent before handoff: ${fromAgent}`,
      ...planResult.path ? [`Active plan: ${planResult.path}`] : [],
      ...latestHandoffPath ? [`Latest handoff note: ${latestHandoffPath}`] : []
    ],
    openRisks: args.openRisks ?? [],
    nextSteps: [args.nextStep?.trim() || `Continue the current work as ${args.targetAgent}.`],
    touchedFiles: args.touchedFiles ?? [],
    refs: args.refs && args.refs.length > 0 ? args.refs : [
      ...planResult.path ? [planResult.path] : [],
      ...latestHandoffPath ? [latestHandoffPath] : []
    ],
    latestHandoffPath
  };
  const note = await writeOpenAgentWorkspaceNote({
    session: args.session,
    config: args.config,
    relativePath: `handoffs/${artifact.createdAt.replace(/[:.]/g, "-")}-${args.targetAgent}.json`,
    content: JSON.stringify(artifact, null, 2),
    mode: "replace"
  });
  return {
    artifact,
    workspaceRelativePath: note.workspaceRelativePath
  };
}
async function readOpenAgentHandoffArtifact(args) {
  const workspacePath = requireOpenAgentWorkspacePath(args.session, "OpenAgent resume handoff");
  const workspacePaths = getOpenAgentWorkspacePaths({
    session: args.session,
    config: args.config
  });
  const candidates = [
    args.artifactPath,
    path12.resolve(args.cwd, args.artifactPath),
    path12.resolve(workspacePath, args.artifactPath),
    path12.resolve(workspacePath, "files", args.artifactPath),
    path12.resolve(workspacePaths.notesRoot, args.artifactPath)
  ];
  const resolvedPath = candidates.find((candidate) => existsSync13(candidate));
  if (!resolvedPath) {
    throw new Error(`Could not find handoff artifact "${args.artifactPath}".`);
  }
  const raw = await readFile9(resolvedPath, "utf8");
  const parsed = sanitizeArtifact(JSON.parse(raw));
  if (!parsed) {
    throw new Error(`"${resolvedPath}" is not a valid OpenAgent handoff v2 artifact.`);
  }
  return parsed;
}

// src/loop-state.ts
import { existsSync as existsSync14 } from "node:fs";
import { mkdir as mkdir8, readFile as readFile10, rm, writeFile as writeFile8 } from "node:fs/promises";
import * as path13 from "node:path";
var OPENAGENT_LOOP_DONE_SENTINEL = "<promise>DONE</promise>";
function getLoopStateFile(session, config) {
  requireOpenAgentWorkspacePath(session, "OpenAgent loop");
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path13.join(paths.notesRoot, "loops", "state.json");
}
function buildOpenAgentLoopPrompt(args) {
  return [
    `Continue working on this goal until it is actually complete: ${args.goal}`,
    "",
    `This is continuation iteration ${args.iterations + 1} of ${args.maxIterations}.`,
    "When you believe the goal is complete, verify your work: read every changed file, run the project's build and test commands, and confirm the output matches expectations.",
    `Only after verification passes, include the exact sentinel ${OPENAGENT_LOOP_DONE_SENTINEL} in your final response. The orchestrator will perform a final review before accepting completion.`,
    "If the goal is not complete yet, keep making progress and leave the session in a state where the next continuation can pick up cleanly.",
    "Use the current session plan, routing state, and workspace notes as the durable source of truth."
  ].join(`
`);
}
async function readOpenAgentLoopState(args) {
  const filePath = getLoopStateFile(args.session, args.config);
  if (!existsSync14(filePath)) {
    return null;
  }
  try {
    const raw = await readFile10(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.active ? parsed : null;
  } catch {
    return null;
  }
}
async function writeOpenAgentLoopState(args) {
  const filePath = getLoopStateFile(args.session, args.config);
  await mkdir8(path13.dirname(filePath), { recursive: true });
  await writeFile8(filePath, JSON.stringify(args.state, null, 2), "utf8");
}
async function clearOpenAgentLoopState(args) {
  const filePath = getLoopStateFile(args.session, args.config);
  if (!existsSync14(filePath)) {
    return;
  }
  await rm(filePath, { force: true });
}

// src/look-at.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync15 } from "node:fs";
import { readFile as readFile11 } from "node:fs/promises";
import * as path14 from "node:path";

// src/copilot-setup.ts
import {
  CopilotClient,
  RuntimeConnection,
  approveAll
} from "@github/copilot-sdk";
function getBundledCopilotCliPathOrThrow() {
  const cliPath = resolveBundledCopilotCliPath();
  if (!cliPath) {
    throw new Error("Bundled Copilot CLI runtime is unavailable.");
  }
  return cliPath;
}
function createBundledCopilotClient() {
  return new CopilotClient({
    connection: RuntimeConnection.forStdio({ path: getBundledCopilotCliPathOrThrow() }),
    useLoggedInUser: true,
    logLevel: "error",
    env: {
      ...process.env,
      COPILOT_AUTO_UPDATE: "false",
      SESSION_ID: undefined
    }
  });
}
async function createBundledCopilotSession(args) {
  const client = createBundledCopilotClient();
  const session = await client.createSession({
    ...args.sessionConfig,
    onPermissionRequest: approveAll,
    workingDirectory: args.cwd
  });
  return {
    client,
    session,
    dispose: async () => {
      await session.disconnect().catch(() => {});
      await client.stop().catch(() => []);
    }
  };
}

// src/look-at.ts
var EXTENSION_MIME_TYPES = new Map([
  [".bmp", "image/bmp"],
  [".cjs", "text/plain"],
  [".cmd", "text/plain"],
  [".css", "text/css"],
  [".csv", "text/csv"],
  [".cts", "text/plain"],
  [".gif", "image/gif"],
  [".htm", "text/html"],
  [".html", "text/html"],
  [".ico", "image/x-icon"],
  [".ini", "text/plain"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/plain"],
  [".json", "application/json"],
  [".jsx", "text/plain"],
  [".md", "text/markdown"],
  [".mjs", "text/plain"],
  [".mts", "text/plain"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ps1", "text/plain"],
  [".psd1", "text/plain"],
  [".psm1", "text/plain"],
  [".scss", "text/plain"],
  [".sh", "text/plain"],
  [".svg", "image/svg+xml"],
  [".tif", "image/tiff"],
  [".tiff", "image/tiff"],
  [".toml", "text/plain"],
  [".ts", "text/plain"],
  [".tsv", "text/tab-separated-values"],
  [".tsx", "text/plain"],
  [".txt", "text/plain"],
  [".webp", "image/webp"],
  [".xml", "text/xml"],
  [".yaml", "text/yaml"],
  [".yml", "text/yaml"]
]);
var BASENAME_MIME_TYPES = new Map([
  [".editorconfig", "text/plain"],
  [".env", "text/plain"],
  [".gitattributes", "text/plain"],
  [".gitignore", "text/plain"],
  ["changelog", "text/plain"],
  ["dockerfile", "text/plain"],
  ["license", "text/plain"],
  ["makefile", "text/plain"],
  ["notice", "text/plain"],
  ["readme", "text/plain"]
]);
function resolveTargetPath(cwd, rawPath) {
  const absolute = path14.isAbsolute(rawPath) ? rawPath : path14.resolve(cwd, rawPath);
  if (!existsSync15(absolute)) {
    throw new Error(`look_at target "${rawPath}" does not exist.`);
  }
  return absolute;
}
function runCommand(name, args) {
  const result = spawnSync2(name, args, { encoding: "utf8" });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      return null;
    }
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    return null;
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}
function inferMimeTypeFromPath(filePath) {
  const extension = path14.extname(filePath).toLowerCase();
  const extensionMimeType = EXTENSION_MIME_TYPES.get(extension);
  if (extensionMimeType) {
    return extensionMimeType;
  }
  return BASENAME_MIME_TYPES.get(path14.basename(filePath).toLowerCase()) ?? null;
}
function detectMimeType(filePath) {
  return inferMimeTypeFromPath(filePath) ?? runCommand("file", ["-b", "--mime-type", filePath]) ?? "application/octet-stream";
}
function truncate(value, maxChars) {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
function buildPdfFallback(filePath, prompt) {
  const info = runCommand("pdfinfo", [filePath]);
  const text = runCommand("pdftotext", ["-layout", filePath, "-"]);
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this PDF.",
    "",
    "## PDF metadata",
    info ?? "pdfinfo is unavailable.",
    "",
    "## Extracted text preview",
    text ? truncate(text, 6000) : "pdftotext is unavailable or the PDF text could not be extracted."
  ].join(`
`);
}
function buildImageFallback(filePath, prompt) {
  const mime = detectMimeType(filePath);
  const identify = runCommand("identify", [filePath]);
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this image.",
    "",
    `MIME type: ${mime}`,
    "## Image metadata",
    identify ?? "ImageMagick identify is unavailable.",
    "",
    "## Local fallback",
    "OpenAgent could not complete bundled model-based inspection, so this result is limited to local metadata."
  ].join(`
`);
}
async function buildTextFallback(filePath, prompt) {
  const content = await readFile11(filePath, "utf8");
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this text artifact.",
    "",
    "## Text preview",
    truncate(content, 6000)
  ].join(`
`);
}
function buildBinaryFallback(mimeType, prompt) {
  return [
    prompt?.trim().length ? `Requested analysis: ${prompt.trim()}` : "Requested analysis: inspect this binary artifact.",
    "",
    `MIME type: ${mimeType}`,
    "OpenAgent could not inspect this file with the bundled Copilot runtime and has no local extractor for this artifact type."
  ].join(`
`);
}
async function buildFallbackOutput(args) {
  if (args.mimeType === "application/pdf") {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "pdf",
      output: buildPdfFallback(args.filePath, args.prompt)
    };
  }
  if (args.mimeType.startsWith("image/")) {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "image",
      output: buildImageFallback(args.filePath, args.prompt)
    };
  }
  if (args.mimeType.startsWith("text/") || args.mimeType === "application/json") {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "text",
      output: await buildTextFallback(args.filePath, args.prompt)
    };
  }
  return {
    filePath: args.filePath,
    mimeType: args.mimeType,
    strategy: "binary",
    output: buildBinaryFallback(args.mimeType, args.prompt)
  };
}
function buildOpenAgentLookAtPrompt(args) {
  return [
    args.prompt?.trim().length ? `Inspect the attached file and answer this request: ${args.prompt.trim()}` : "Inspect the attached file. Extract the important visible or embedded text, describe the content concisely, and call out anything risky, surprising, or relevant to the current task.",
    "",
    `Attached file: ${path14.basename(args.filePath)}`,
    "Prefer concrete extraction over vague description."
  ].join(`
`);
}
async function runBundledAssistantLookAt(args) {
  let handle;
  try {
    handle = await createBundledCopilotSession({
      cwd: args.cwd,
      sessionConfig: {
        streaming: false,
        infiniteSessions: { enabled: false }
      }
    });
    const response = await handle.session.sendAndWait({
      prompt: buildOpenAgentLookAtPrompt({
        filePath: args.filePath,
        prompt: args.prompt
      }),
      attachments: [{ type: "file", path: args.filePath }]
    }, 90000);
    const content = response?.data.content?.trim();
    if (!content) {
      throw new Error("Bundled Copilot inspection returned no content.");
    }
    return content;
  } finally {
    if (handle) {
      await handle.dispose();
    }
  }
}
async function runOpenAgentLookAt(args) {
  const filePath = resolveTargetPath(args.cwd, args.file);
  const mimeType = detectMimeType(filePath);
  try {
    const output = await runBundledAssistantLookAt({
      cwd: args.cwd,
      filePath,
      prompt: args.prompt
    });
    return {
      filePath,
      mimeType,
      strategy: "assistant",
      output
    };
  } catch (error) {
    const fallback = await buildFallbackOutput({
      filePath,
      mimeType,
      prompt: args.prompt
    });
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallback,
      output: [
        `Primary bundled inspection failed: ${message}`,
        "",
        fallback.output
      ].join(`
`)
    };
  }
}

// src/plan-review.ts
function normalizeWhitespace2(value) {
  return value.replace(/\s+/g, " ").trim();
}
function summarizeRequest2(request, maxChars = 140) {
  const normalized = normalizeWhitespace2(request);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
function toBullets5(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function buildPlanReviewWorkflowNote(args) {
  return [
    "# OpenAgent plan review workflow",
    "",
    `Timestamp: ${args.timestamp}`,
    `Requested by: ${args.requestedBy}`,
    `Request summary: ${args.requestSummary}`,
    "",
    "## Raw request",
    args.request.trim(),
    "",
    "## Required sequence",
    "1. Orchestrator routes to Architect to draft or refine the implementation plan.",
    "2. Planner returns the plan to the orchestrator. Orchestrator decides whether critique is needed.",
    "3. If needed, orchestrator routes to Skeptic. The critic reviews the plan and returns a verdict to the orchestrator.",
    "4. The critic is a dead-end — it does NOT route to the implementer. Only the orchestrator decides next steps.",
    "5. Orchestrator may route back to planner for revisions, or proceed to implementation when the plan is sound.",
    "",
    "## Specialist handoff guidance",
    toBullets5([
      'Route to phase "planner" for plan creation. The planner returns to the orchestrator when done.',
      'Route to phase "planner" with agent "skeptic" for plan review. The critic returns a verdict to the orchestrator — it never routes onward.',
      'Route to phase "implementer" only after the orchestrator is satisfied the plan is executable.',
      'Use agent "oracle" for read-only architecture review, or agent "tester" when implementation exists and needs hands-on verification.'
    ])
  ].join(`
`);
}
function buildPlanReviewHandoff(args) {
  return [
    "Start the plan-review workflow before implementation.",
    "",
    `Requested by: ${args.requestedBy}`,
    `Workflow note: ${args.workflowWorkspacePath}`,
    "",
    "## Raw request",
    args.request.trim(),
    "",
    "## Expectations",
    toBullets5([
      "Read the workflow note before writing or revising the plan.",
      "Draft a concrete implementation plan with explicit sequencing, boundaries, and validation.",
      "When the plan is actionable, return to the orchestrator with the plan summary.",
      "The orchestrator will decide whether to send the plan to the critic or proceed to implementation.",
      "The critic is a dead-end — it returns a verdict to the orchestrator. Only the orchestrator routes to the implementer."
    ])
  ].join(`
`);
}
function formatOpenAgentPlanReviewResult(result) {
  return [
    `OpenAgent started the plan-review workflow for: ${result.requestSummary}`,
    `Selected phase: ${result.phase}`,
    `Selected agent: ${result.agent}`,
    `Mode: ${result.mode}`,
    `Workflow note: ${result.workflowWorkspacePath}`,
    `Handoff note: ${result.handoffWorkspacePath}`,
    `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`
  ].join(`
`);
}
async function startPlanReviewWorkflow(args) {
  const request = args.request.trim();
  if (request.length === 0) {
    throw new Error("OpenAgent plan review requires a non-empty request.");
  }
  requireOpenAgentWorkspacePath(args.session, "OpenAgent plan review");
  const timestamp = new Date().toISOString();
  const requestedBy = args.requestedBy?.trim() || "openagent_plan_review";
  const requestSummary = summarizeRequest2(request);
  const slug = timestamp.replace(/[:.]/g, "-");
  const workflowNote = await writeOpenAgentWorkspaceNote({
    session: args.session,
    config: args.config,
    relativePath: `workflows/plan-review/${slug}.md`,
    content: buildPlanReviewWorkflowNote({
      timestamp,
      requestedBy,
      request,
      requestSummary
    }),
    mode: "replace"
  });
  const routeResult = await routeOpenAgentPhase({
    session: args.session,
    config: args.config,
    request: {
      phase: "planner",
      agent: "architect",
      objective: `Draft and pressure-test an implementation plan: ${requestSummary}`,
      handoff: buildPlanReviewHandoff({
        request,
        requestedBy,
        workflowWorkspacePath: workflowNote.workspaceRelativePath
      }),
      requestedBy,
      syncPlan: args.syncPlan === false ? false : true,
      mode: args.mode
    }
  });
  return {
    ...routeResult,
    workflowWorkspacePath: workflowNote.workspaceRelativePath,
    requestSummary
  };
}

// src/review-workflow.ts
function normalizeWhitespace3(value) {
  return value.replace(/\s+/g, " ").trim();
}
function summarizeScope(scope, maxChars = 140) {
  const normalized = normalizeWhitespace3(scope);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
function toBullets6(lines) {
  return lines.map((line) => `- ${line}`).join(`
`);
}
function buildReviewWorkflowNote(args) {
  return [
    "# OpenAgent parallel review workflow",
    "",
    `Timestamp: ${args.timestamp}`,
    `Requested by: ${args.requestedBy}`,
    `Scope summary: ${args.scopeSummary}`,
    "",
    "## Review scope",
    args.scope.trim(),
    "",
    "## Required fan-out",
    "Launch exactly four review lanes and merge them into one verdict.",
    "",
    "1. Correctness review — use auditor to check code for bugs, regressions, and edge cases.",
    "2. Architecture/security review — use oracle for deeper reasoning about design, unsafe assumptions, and security risks.",
    "3. QA verification — use tester to RUN the application and verify behavior through hands-on testing. QA executes the app, it does not inspect code.",
    "4. Goal verification — use oracle to confirm the implementation satisfies the original request and all constraints.",
    "",
    "## Merge rules",
    toBullets6([
      "Launch the four review lanes and merge their outputs into one verdict.",
      "Each lane must return only concrete findings with file evidence, not style feedback.",
      'The final merged verdict should say "pass" only if every lane passes with no blocking issue.',
      "If any lane finds a blocking issue, the final verdict is fail and must name the blocking lane first."
    ])
  ].join(`
`);
}
function buildReviewHandoff(args) {
  return [
    "Run the parallel review workflow before accepting the work as complete.",
    "",
    `Requested by: ${args.requestedBy}`,
    `Workflow note: ${args.workflowWorkspacePath}`,
    "",
    "## Review scope",
    args.scope.trim(),
    "",
    "## Expectations",
    toBullets6([
      "Read the workflow note first.",
      "Route to each review lane in sequence and collect their outputs.",
      "Reviewer and oracle lanes are read-only — they inspect code and design. QA must execute the app and run tests.",
      "Merge the lane outputs into one concise verdict that names blockers first and passes only if every lane passes.",
      "Do not spend time on cosmetic feedback; focus on correctness, regressions, risky assumptions, and missing verification.",
      "After the verdict, return to the orchestrator with the merged results."
    ])
  ].join(`
`);
}
function formatOpenAgentReviewWorkflowResult(result) {
  return [
    `OpenAgent started the parallel review workflow for: ${result.scopeSummary}`,
    `Selected phase: ${result.phase}`,
    `Selected agent: ${result.agent}`,
    `Mode: ${result.mode}`,
    `Workflow note: ${result.workflowWorkspacePath}`,
    `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
    `Improvement memory: ${result.improvementMemoryPath}`,
    `Handoff note: ${result.handoffWorkspacePath}`,
    `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`
  ].join(`
`);
}
async function startOpenAgentReviewWorkflow(args) {
  const scope = args.scope.trim();
  if (scope.length === 0) {
    throw new Error("OpenAgent review workflow requires a non-empty scope.");
  }
  requireOpenAgentWorkspacePath(args.session, "OpenAgent review workflow");
  const timestamp = new Date().toISOString();
  const requestedBy = args.requestedBy?.trim() || "oa-review";
  const scopeSummary = summarizeScope(scope);
  const slug = timestamp.replace(/[:.]/g, "-");
  const workflowNote = await writeOpenAgentWorkspaceNote({
    session: args.session,
    config: args.config,
    relativePath: `workflows/review/${slug}.md`,
    content: buildReviewWorkflowNote({
      timestamp,
      requestedBy,
      scope,
      scopeSummary
    }),
    mode: "replace"
  });
  const improvement = await recordContinuousImprovementArtifact({
    cwd: process.cwd(),
    source: "review-workflow",
    title: "Review follow-up candidate",
    summary: `Parallel review workflow started for "${scopeSummary}". When the merged verdict is available, promote repeated findings into rules, AGENTS, repo memory, or follow-up tasks.`,
    evidence: [`Workflow note: ${workflowNote.workspaceRelativePath}`],
    recommendations: [
      "If the verdict reveals a stable engineering rule, update `.openagent/rules/*.md`.",
      "If the verdict changes runtime-facing workflow guidance, update `AGENTS.md`.",
      "If the finding is recurring but not yet stable, persist or update repo-scoped memory."
    ],
    session: args.session,
    config: args.config
  });
  const routeResult = await routeOpenAgentPhase({
    session: args.session,
    config: args.config,
    request: {
      phase: "orchestrator",
      objective: `Run a parallel review fan-out: ${scopeSummary}`,
      handoff: buildReviewHandoff({
        scope,
        requestedBy,
        workflowWorkspacePath: workflowNote.workspaceRelativePath
      }),
      requestedBy,
      syncPlan: args.syncPlan === false ? false : true,
      mode: args.mode
    }
  });
  return {
    ...routeResult,
    workflowWorkspacePath: workflowNote.workspaceRelativePath,
    improvementWorkspacePath: improvement.workspaceRelativePath,
    improvementMemoryPath: improvement.memoryRelativePath,
    scopeSummary
  };
}

// src/compaction.ts
var OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD = 0.7;
var OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD = 0.9;
var compactionState = {
  lastUsage: null,
  inProgress: false,
  lastCompactedAt: null,
  lastCheckpointPath: null,
  lastWorkspaceNotePath: null,
  lastSummaryPreview: null,
  lastResult: null
};
function truncateSummary(value, maxChars = 240) {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
function toPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}
function recordOpenAgentUsage(args) {
  const snapshot = {
    tokenLimit: args.tokenLimit,
    currentTokens: args.currentTokens,
    messagesLength: args.messagesLength,
    ratio: args.tokenLimit > 0 ? args.currentTokens / args.tokenLimit : 0,
    systemTokens: args.systemTokens,
    conversationTokens: args.conversationTokens,
    toolDefinitionsTokens: args.toolDefinitionsTokens,
    updatedAt: new Date().toISOString()
  };
  compactionState.lastUsage = snapshot;
  recordUsageInfo(args.currentTokens, args.tokenLimit);
  return snapshot;
}
function noteOpenAgentCompactionStart() {
  compactionState.inProgress = true;
  recordCompactionStart();
}
async function noteOpenAgentCompactionComplete(args) {
  compactionState.inProgress = false;
  compactionState.lastCompactedAt = new Date().toISOString();
  compactionState.lastCheckpointPath = args.checkpointPath ?? null;
  compactionState.lastSummaryPreview = args.summaryContent ? truncateSummary(args.summaryContent) : null;
  compactionState.lastResult = args.success ? "success" : "failure";
  if (typeof args.postCompactionTokens === "number" && compactionState.lastUsage?.tokenLimit) {
    recordUsageInfo(args.postCompactionTokens, compactionState.lastUsage.tokenLimit);
  }
  recordCompactionComplete(args.success);
  const usage = compactionState.lastUsage;
  const noteContent = [
    "# OpenAgent compaction checkpoint",
    "",
    `Completed at: ${compactionState.lastCompactedAt}`,
    `Result: ${args.success ? "success" : "failure"}`,
    usage ? `Latest observed usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit} tokens, ${usage.messagesLength} messages)` : "Latest observed usage: unknown",
    `Pre-compaction tokens: ${args.preCompactionTokens ?? "unknown"}`,
    `Post-compaction tokens: ${args.postCompactionTokens ?? "unknown"}`,
    `Messages removed: ${args.messagesRemoved ?? "unknown"}`,
    `Tokens removed: ${args.tokensRemoved ?? "unknown"}`,
    `Checkpoint number: ${args.checkpointNumber ?? "unknown"}`,
    `Checkpoint path: ${args.checkpointPath ?? "unknown"}`,
    "",
    "## Summary",
    args.summaryContent?.trim() || (args.success ? "No compaction summary returned." : "Compaction failed before a summary was produced."),
    ...args.error ? ["", "## Error", args.error] : []
  ].join(`
`);
  try {
    const note = await writeOpenAgentWorkspaceNote({
      session: args.session,
      config: args.config,
      relativePath: `compaction/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      content: noteContent,
      mode: "replace"
    });
    compactionState.lastWorkspaceNotePath = note.workspaceRelativePath;
  } catch {
    compactionState.lastWorkspaceNotePath = null;
  }
  return {
    workspaceNotePath: compactionState.lastWorkspaceNotePath,
    message: args.success ? `OpenAgent compaction completed${compactionState.lastWorkspaceNotePath ? ` and saved ${compactionState.lastWorkspaceNotePath}` : ""}.` : `OpenAgent compaction failed${args.error ? `: ${args.error}` : "."}`
  };
}
function formatOpenAgentCompactionStatus() {
  const usage = compactionState.lastUsage;
  const lines = [
    "OpenAgent compaction",
    `background threshold: ${toPercent(OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD)}`,
    `buffer threshold: ${toPercent(OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD)}`,
    `in progress: ${compactionState.inProgress ? "yes" : "no"}`
  ];
  if (usage) {
    lines.push(`latest usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit} tokens, ${usage.messagesLength} messages)`);
  } else {
    lines.push("latest usage: unknown");
  }
  if (compactionState.lastResult) {
    lines.push(`last result: ${compactionState.lastResult}`);
  }
  if (compactionState.lastCheckpointPath) {
    lines.push(`last checkpoint: ${compactionState.lastCheckpointPath}`);
  }
  if (compactionState.lastWorkspaceNotePath) {
    lines.push(`last workspace note: ${compactionState.lastWorkspaceNotePath}`);
  }
  if (compactionState.lastSummaryPreview) {
    lines.push(`last summary: ${compactionState.lastSummaryPreview}`);
  }
  return lines.join(`
`);
}

// src/commands.ts
function parseInitDeepArgs(rawArgs) {
  const args = rawArgs.trim().split(/\s+/).filter((part) => part.length > 0);
  let force = false;
  let maxDepth;
  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }
    const match = arg.match(/^--max-depth=(\d+)$/);
    if (match) {
      maxDepth = Number(match[1]);
    }
  }
  return { force, maxDepth };
}
function parseRouteCommandArgs(rawArgs) {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return null;
  }
  const separatorIndex = trimmed.indexOf("|");
  const left = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const right = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
  const [phase, ...objectiveParts] = left.split(/\s+/);
  const objective = objectiveParts.join(" ").trim();
  if (!phase || !objective) {
    return null;
  }
  return {
    phase,
    objective,
    handoff: right.length > 0 ? right : objective
  };
}
function parseLoopCommandArgs(rawArgs) {
  const parts = rawArgs.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }
  let maxIterations = 8;
  const goalParts = [];
  for (const part of parts) {
    const match = part.match(/^--max-iterations=(\d+)$/);
    if (match) {
      maxIterations = Math.min(Math.max(Number(match[1]), 1), 25);
      continue;
    }
    goalParts.push(part);
  }
  const goal = goalParts.join(" ").trim();
  return goal.length > 0 ? { goal, maxIterations } : null;
}
function parseLookAtCommandArgs(rawArgs) {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return null;
  }
  const separatorIndex = trimmed.indexOf("|");
  const left = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const right = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
  if (!left) {
    return null;
  }
  return {
    file: left,
    prompt: right.length > 0 ? right : undefined
  };
}
function parseStartCommandArgs(rawArgs) {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return {};
  }
  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first === "--resume" || first.startsWith("--resume=")) {
    const resumePath = first === "--resume" ? parts[1] : first.slice("--resume=".length).trim();
    const consumed = first === "--resume" ? 2 : 1;
    const resumeNote = parts.slice(consumed).join(" ").trim();
    return {
      resumePath: resumePath && resumePath.length > 0 ? resumePath : undefined,
      resumeNote: resumeNote.length > 0 ? resumeNote : undefined
    };
  }
  return {
    request: trimmed
  };
}
function createCommands(args) {
  const { getSession, initialCwd } = args;
  const cwd = process.cwd() || initialCwd;
  const customCommands = loadCustomCommands(cwd);
  const allCommands = [
    {
      name: "oa-init-deep",
      description: "Generate AGENTS.md files across the repo and its key subdirectories.",
      handler: async (context) => {
        const session = getSession();
        const cwd2 = process.cwd() || initialCwd;
        const parsedArgs = parseInitDeepArgs(context.args);
        const result = await initializeDeepAgents({
          cwd: cwd2,
          force: parsedArgs.force,
          maxDepth: parsedArgs.maxDepth
        });
        await session.log([
          "OpenAgent generated hierarchical AGENTS.md files.",
          `Root: ${result.root}`,
          `Written: ${result.written.length}`,
          `Skipped existing: ${result.skipped.length}`,
          result.written.length > 0 ? `Files: ${result.written.join(", ")}` : "Files: none"
        ].join(`
`));
      }
    },
    {
      name: "oa-loop",
      description: "Start a continuation loop that keeps sending follow-up turns until the goal is done.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent loop"), {
            level: "warning"
          });
          return;
        }
        const parsedArgs = parseLoopCommandArgs(context.args);
        if (!parsedArgs) {
          await session.log("Usage: /oa-loop [--max-iterations=N] <goal>", {
            level: "warning"
          });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const timestamp = new Date().toISOString();
        await writeOpenAgentLoopState({
          session,
          config: resolution2.config,
          state: {
            goal: parsedArgs.goal,
            iterations: 0,
            maxIterations: parsedArgs.maxIterations,
            active: true,
            startedAt: timestamp,
            updatedAt: timestamp
          }
        });
        recordLoopStart();
        await session.log(`OpenAgent started /oa-loop for "${parsedArgs.goal}" with a ${parsedArgs.maxIterations}-iteration cap.`);
        await session.send({
          prompt: buildOpenAgentLoopPrompt({
            goal: parsedArgs.goal,
            iterations: 0,
            maxIterations: parsedArgs.maxIterations
          })
        });
      }
    },
    {
      name: "oa-loop-cancel",
      description: "Cancel the active OpenAgent continuation loop for this session.",
      handler: async () => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent loop cancel"), {
            level: "warning"
          });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        await clearOpenAgentLoopState({
          session,
          config: resolution2.config
        });
        recordLoopCancel();
        await session.log("OpenAgent cancelled the active continuation loop.");
      }
    },
    {
      name: "oa-doctor",
      description: "Inspect OpenAgent config, routing state, and local tool availability.",
      handler: async () => {
        const session = getSession();
        const cwd2 = process.cwd() || initialCwd;
        const resolution2 = loadOpenAgentConfig(cwd2);
        const result = await runOpenAgentDoctor({
          session,
          cwd: cwd2,
          resolution: resolution2,
          writeReport: true
        });
        await session.log([
          result.report,
          "",
          `Saved report: ${result.reportWorkspacePath ?? "not written to workspace"}`,
          `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
          `Improvement memory: ${result.improvementMemoryPath}`
        ].join(`
`));
      }
    },
    {
      name: "oa-status",
      description: "Show OpenAgent runtime configuration and session state.",
      handler: async () => {
        const session = getSession();
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const [mode, model, agent, routingStatus] = await Promise.all([
          session.rpc.mode.get(),
          session.rpc.model.getCurrent(),
          session.rpc.agent.getCurrent(),
          formatOpenAgentRoutingStatus({
            session,
            config: resolution2.config
          })
        ]);
        await session.log([
          "OpenAgent status",
          formatConfigSummary(resolution2),
          `mode: ${mode}`,
          `model: ${model.modelId ?? "host default"}`,
          `agent: ${agent.agent?.name ?? "host default"}`,
          `workspace path: ${session.workspacePath ?? "disabled"}`,
          "",
          routingStatus,
          "",
          formatOpenAgentCompactionStatus(),
          "",
          formatOpenAgentTelemetry()
        ].join(`
`));
      }
    },
    {
      name: "oa-plan",
      description: "Switch the current session to plan mode.",
      handler: async () => {
        const session = getSession();
        await session.rpc.mode.set({ mode: "plan" });
        await session.log("OpenAgent switched the current session to plan mode.");
      }
    },
    {
      name: "oa-autopilot",
      description: "Switch the current session to autopilot mode.",
      handler: async () => {
        const session = getSession();
        await session.rpc.mode.set({ mode: "autopilot" });
        await session.log("OpenAgent switched the current session to autopilot mode.");
      }
    },
    {
      name: "oa-agent",
      description: "Select an OpenAgent custom agent by name.",
      handler: async (context) => {
        const session = getSession();
        const requestedAgent = context.args.trim();
        if (!requestedAgent) {
          await session.log(`Choose one of: ${OPENAGENT_AGENT_NAMES.join(", ")}`, { level: "warning" });
          return;
        }
        if (!isOpenAgentAgentName(requestedAgent)) {
          await session.log(`Unknown OpenAgent agent "${requestedAgent}". Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`, { level: "warning" });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await selectOpenAgentAgent({
          session,
          agentName: requestedAgent,
          config: resolution2.config
        });
        await session.log(`OpenAgent selected ${result.agent.displayName}.`);
      }
    },
    {
      name: "oa-look-at",
      description: "Attach an image, PDF, or file to the active session for direct inspection.",
      handler: async (context) => {
        const session = getSession();
        const parsedArgs = parseLookAtCommandArgs(context.args);
        if (!parsedArgs) {
          await session.log("Usage: /oa-look-at <file> [| question]", { level: "warning" });
          return;
        }
        const cwd2 = process.cwd() || initialCwd;
        const filePath = path15.isAbsolute(parsedArgs.file) ? parsedArgs.file : path15.resolve(cwd2, parsedArgs.file);
        if (!existsSync16(filePath)) {
          await session.log(`OpenAgent could not find "${parsedArgs.file}".`, {
            level: "warning"
          });
          return;
        }
        recordLookAtInvocation();
        await session.log(`OpenAgent attached ${parsedArgs.file} for inspection.`, {
          ephemeral: true
        });
        await session.send({
          prompt: buildOpenAgentLookAtPrompt({
            filePath,
            prompt: parsedArgs.prompt
          }),
          attachments: [{ type: "file", path: filePath }]
        });
      }
    },
    {
      name: "oa-start",
      description: "Bootstrap a raw request or resume a structured handoff artifact.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent bootstrap"), {
            level: "warning"
          });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const parsedArgs = parseStartCommandArgs(context.args);
        if (parsedArgs.resumePath) {
          const artifact = await readOpenAgentHandoffArtifact({
            session,
            config: resolution2.config,
            cwd: process.cwd() || initialCwd,
            artifactPath: parsedArgs.resumePath
          });
          const resumePhase = artifact.toPhase === "implementer" ? "orchestrator" : artifact.toPhase;
          const result2 = await routeOpenAgentPhase({
            session,
            config: resolution2.config,
            request: {
              phase: resumePhase,
              agent: resumePhase === "orchestrator" ? undefined : artifact.toAgent,
              objective: `Resume handoff: ${artifact.goal}`,
              handoff: buildOpenAgentResumeHandoff(artifact, parsedArgs.resumeNote),
              requestedBy: "oa-start resume command",
              syncPlan: true
            }
          });
          await session.log([
            `OpenAgent resumed handoff artifact into ${result2.phase}.`,
            `Selected agent: ${result2.agent}`,
            `Mode: ${result2.mode}`,
            `Handoff note: ${result2.handoffWorkspacePath}`
          ].join(`
`));
          return;
        }
        const request = parsedArgs.request?.trim();
        if (!request) {
          await session.log("Usage: /oa-start <request> OR /oa-start --resume <artifact>", {
            level: "warning"
          });
          return;
        }
        const result = await bootstrapOpenAgentTask({
          session,
          config: resolution2.config,
          request,
          requestedBy: "oa-start command",
          syncPlan: true
        });
        await session.log(formatOpenAgentBootstrapResult(result));
      }
    },
    {
      name: "oa-plan-review",
      description: "Start a planner -> critic -> reviewer workflow before implementation begins.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent plan review"), {
            level: "warning"
          });
          return;
        }
        const request = context.args.trim();
        if (!request) {
          await session.log("Usage: /oa-plan-review <request>", { level: "warning" });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await startPlanReviewWorkflow({
          session,
          config: resolution2.config,
          request,
          requestedBy: "oa-plan-review command",
          syncPlan: true
        });
        await session.log(formatOpenAgentPlanReviewResult(result));
      }
    },
    {
      name: "oa-route",
      description: "Route to an OpenAgent phase with a durable handoff note.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent routing"), {
            level: "warning"
          });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const parsedArgs = parseRouteCommandArgs(context.args);
        if (!parsedArgs || !isOpenAgentPhase(parsedArgs.phase)) {
          await session.log(`Usage: /oa-route <phase> <objective> [| handoff]. Phases: ${listOpenAgentPhases()}`, { level: "warning" });
          return;
        }
        const result = await routeOpenAgentPhase({
          session,
          config: resolution2.config,
          request: {
            phase: parsedArgs.phase,
            objective: parsedArgs.objective,
            handoff: parsedArgs.handoff,
            requestedBy: "oa-route command",
            syncPlan: true
          }
        });
        await session.log([
          `OpenAgent routed from ${result.previousPhase} to ${result.phase}.`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Handoff note: ${result.handoffWorkspacePath}`,
          `Plan updated: ${result.planUpdated ? "yes" : "no"}`
        ].join(`
`));
      }
    },
    {
      name: "oa-refactor",
      description: "Start a guided refactoring workflow with LSP-backed safety checks.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent refactor"), {
            level: "warning"
          });
          return;
        }
        const target = context.args.trim();
        if (!target) {
          await session.log("Usage: /oa-refactor <target description>", { level: "warning" });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution2.config,
          request: {
            phase: "orchestrator",
            objective: `Execute refactoring: ${target}`,
            handoff: [
              "Refactoring objective: execute the scoped refactor described above.",
              "Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool.",
              "1. Break the refactor into non-overlapping scoped tasks per wave",
              "2. Dispatch all tasks in a wave simultaneously with the `agent` tool",
              "3. Verify each wave before dispatching the next",
              "4. Summarize what changed and any remaining risks"
            ].join(`
`),
            requestedBy: "oa-refactor command",
            syncPlan: true
          }
        });
        await session.log([
          `OpenAgent refactor routed to ${result.phase}.`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Handoff note: ${result.handoffWorkspacePath}`
        ].join(`
`));
      }
    },
    {
      name: "oa-handoff",
      description: "Hand off the current work to another OpenAgent persona and persist a resume artifact.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent handoff"), {
            level: "warning"
          });
          return;
        }
        const trimmed = context.args.trim();
        const spaceIndex = trimmed.indexOf(" ");
        const agentName = spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed;
        const description = spaceIndex >= 0 ? trimmed.slice(spaceIndex + 1).trim() : "";
        if (!agentName) {
          await session.log(`Usage: /oa-handoff <agent-name> <description>. Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`, { level: "warning" });
          return;
        }
        if (!isOpenAgentAgentName(agentName)) {
          await session.log(`Unknown agent "${agentName}". Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`, { level: "warning" });
          return;
        }
        const phase = inferOpenAgentPhase(agentName);
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const [currentAgentResult, currentModeResult] = await Promise.all([
          session.rpc.agent.getCurrent(),
          session.rpc.mode.get()
        ]);
        const fromAgent = isOpenAgentAgentName(currentAgentResult.agent?.name ?? "") ? currentAgentResult.agent.name : resolution2.config.defaultAgent;
        const fromPhase = inferOpenAgentPhase(fromAgent);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution2.config,
          request: {
            phase,
            agent: agentName,
            objective: description || `Handoff to ${agentName}`,
            handoff: description || `Continue the current work as ${agentName}.`,
            requestedBy: "oa-handoff command",
            syncPlan: true
          }
        });
        const artifact = await writeOpenAgentHandoffArtifact({
          session,
          config: resolution2.config,
          targetAgent: agentName,
          goal: description || `Handoff to ${agentName}`,
          requestedBy: "oa-handoff command",
          nextStep: description || `Continue the current work as ${agentName}.`,
          fromAgent,
          fromPhase,
          fromMode: currentModeResult === "interactive" || currentModeResult === "plan" || currentModeResult === "autopilot" ? currentModeResult : "interactive",
          refs: [result.handoffWorkspacePath],
          latestHandoffPath: result.handoffWorkspacePath
        });
        await session.log([
          `OpenAgent handed off from ${result.previousPhase} to ${result.phase}.`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Handoff note: ${result.handoffWorkspacePath}`,
          `Handoff artifact: ${artifact.workspaceRelativePath}`
        ].join(`
`));
      }
    },
    {
      name: "oa-review",
      description: "Start a parallel review fan-out across correctness, regressions, architecture, and QA.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent review"), {
            level: "warning"
          });
          return;
        }
        const scope = context.args.trim() || "all pending changes";
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await startOpenAgentReviewWorkflow({
          session,
          config: resolution2.config,
          scope,
          requestedBy: "oa-review command",
          syncPlan: true
        });
        await session.log(formatOpenAgentReviewWorkflowResult(result));
      }
    },
    {
      name: "oa-start-work",
      description: "Execute the current plan from the session workspace.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent start-work"), {
            level: "warning"
          });
          return;
        }
        const resolution2 = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution2.config,
          request: {
            phase: "orchestrator",
            objective: "Execute the active plan end-to-end",
            handoff: [
              "Execution objective: work through plan.md using fleet dispatch.",
              "Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool.",
              "1. Read plan.md from the session workspace",
              "2. Decompose planned tasks into non-overlapping scoped waves",
              "3. Dispatch all tasks in each wave simultaneously with the `agent` tool",
              "4. Verify each wave before proceeding to the next",
              "5. Keep plan.md updated with progress and completion status"
            ].join(`
`),
            requestedBy: "oa-start-work command",
            syncPlan: true
          }
        });
        await session.log([
          `OpenAgent start-work routed to ${result.phase}.`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Handoff note: ${result.handoffWorkspacePath}`
        ].join(`
`));
      }
    }
  ];
  const builtinCommandNames = new Set(allCommands.map((command) => command.name));
  for (const customCommand of customCommands) {
    if (builtinCommandNames.has(customCommand.name)) {
      continue;
    }
    allCommands.push({
      name: customCommand.name,
      description: customCommand.description,
      handler: async (context) => {
        const session = getSession();
        await session.log(`OpenAgent executing custom command /${customCommand.name} from ${customCommand.source}.`, { ephemeral: true });
        await session.send({
          prompt: renderCustomCommandPrompt(customCommand, context.args)
        });
      }
    });
  }
  const resolution = loadOpenAgentConfig(cwd);
  const disabledCommandSet = new Set(resolution.config.disabledCommands);
  return allCommands.filter((cmd) => !disabledCommandSet.has(cmd.name));
}

// src/permissions.ts
import * as os5 from "node:os";
import * as path16 from "node:path";
function deny(message) {
  return {
    kind: "reject",
    feedback: message
  };
}
function approve() {
  return { kind: "approved" };
}
function defer() {
  return { kind: "no-result" };
}
function isInsideRoot(candidatePath, rootPath) {
  const resolvedRoot = path16.resolve(rootPath);
  const resolvedCandidate = path16.resolve(candidatePath);
  const relative4 = path16.relative(resolvedRoot, resolvedCandidate);
  return relative4 === "" || !relative4.startsWith("..") && !path16.isAbsolute(relative4);
}
function collectAllowedRoots(initialCwd) {
  const cwd = process.cwd() || initialCwd;
  return [
    path16.resolve(cwd),
    path16.join(os5.homedir(), ".copilot", "session-state")
  ];
}
function areAllPathsAllowed(rawPaths, allowedRoots, initialCwd) {
  if (!Array.isArray(rawPaths)) {
    return true;
  }
  return rawPaths.every((entry) => {
    if (typeof entry !== "string" || entry.trim().length === 0) {
      return true;
    }
    const resolved = path16.resolve(process.cwd() || initialCwd, entry);
    return allowedRoots.some((root) => isInsideRoot(resolved, root));
  });
}
function hasPossibleUrls(rawUrls) {
  return Array.isArray(rawUrls) && rawUrls.length > 0;
}
function commandLooksSafe(rawCommand, initialCwd) {
  if (typeof rawCommand !== "string" || rawCommand.trim().length === 0) {
    return false;
  }
  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  return !resolution.config.guardrails.dangerousShellPatterns.some((pattern) => new RegExp(pattern, "i").test(rawCommand));
}
function hasReadOnlyCommands(rawCommands) {
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
    return false;
  }
  return rawCommands.every((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const readOnly = entry.readOnly;
    return readOnly === true;
  });
}
function getStringField(value, key) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value[key];
  return typeof candidate === "string" && candidate.trim().length > 0 ? candidate : null;
}
function createPermissionHandler(args) {
  const { initialCwd } = args;
  return async (request) => {
    const allowedRoots = collectAllowedRoots(initialCwd);
    switch (request.kind) {
      case "read": {
        const targetPath = getStringField(request, "path");
        if (!targetPath) {
          return defer();
        }
        return allowedRoots.some((root) => isInsideRoot(targetPath, root)) ? approve() : defer();
      }
      case "write": {
        const fileName = getStringField(request, "fileName");
        if (!fileName) {
          return defer();
        }
        return allowedRoots.some((root) => isInsideRoot(fileName, root)) ? approve() : defer();
      }
      case "shell": {
        const shellRequest = request;
        const fullCommandText = getStringField(shellRequest, "fullCommandText");
        if (!commandLooksSafe(fullCommandText, initialCwd)) {
          return deny("OpenAgent blocked a shell command that matched its dangerous-command policy.");
        }
        if (hasPossibleUrls(shellRequest.possibleUrls)) {
          return defer();
        }
        if (areAllPathsAllowed(shellRequest.possiblePaths, allowedRoots, initialCwd) || hasReadOnlyCommands(shellRequest.commands)) {
          return approve();
        }
        return defer();
      }
      case "mcp": {
        const mcpRequest = request;
        return mcpRequest.readOnly === true ? approve() : defer();
      }
      case "custom-tool":
        return approve();
      case "url":
        return defer();
      default:
        return defer();
    }
  };
}

// src/background-tasks.ts
var activeTasks = new Map;
var MAX_CONCURRENT_RUNNING = 5;
function registerBackgroundTask(args) {
  if (activeTasks.has(args.id)) {
    throw new Error(`Background task "${args.id}" already exists.`);
  }
  const runningCount = Array.from(activeTasks.values()).filter((task2) => task2.status === "running").length;
  if (runningCount >= MAX_CONCURRENT_RUNNING) {
    throw new Error(`Cannot register background task: concurrency limit reached (${MAX_CONCURRENT_RUNNING} running).`);
  }
  const task = {
    id: args.id,
    description: args.description,
    status: "running",
    owner: args.owner,
    startedAt: new Date().toISOString(),
    completedAt: null,
    result: null,
    error: null
  };
  activeTasks.set(args.id, task);
  return task;
}
function updateBackgroundTask(id, update) {
  const task = activeTasks.get(id);
  if (!task) {
    throw new Error(`Background task "${id}" not found.`);
  }
  if (update.status !== undefined) {
    task.status = update.status;
    if (update.status === "completed" || update.status === "failed" || update.status === "cancelled") {
      task.completedAt = new Date().toISOString();
    }
  }
  if (update.result !== undefined) {
    task.result = update.result;
  }
  if (update.error !== undefined) {
    task.error = update.error;
  }
  return task;
}
function listBackgroundTasks(filter) {
  const tasks = Array.from(activeTasks.values());
  if (filter?.status) {
    return tasks.filter((task) => task.status === filter.status);
  }
  return tasks;
}
function cancelBackgroundTask(id) {
  const task = activeTasks.get(id);
  if (!task) {
    throw new Error(`Background task "${id}" not found.`);
  }
  if (task.status !== "running") {
    throw new Error(`Cannot cancel background task "${id}": current status is "${task.status}".`);
  }
  task.status = "cancelled";
  task.completedAt = new Date().toISOString();
  return task;
}
function getBackgroundTaskStats() {
  const tasks = Array.from(activeTasks.values());
  return {
    total: tasks.length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    cancelled: tasks.filter((t) => t.status === "cancelled").length
  };
}
function formatBackgroundTasksSummary() {
  const tasks = Array.from(activeTasks.values());
  if (tasks.length === 0) {
    return "No background tasks tracked.";
  }
  const stats = getBackgroundTaskStats();
  const header = `Background tasks: ${stats.total} total (${stats.running} running, ${stats.completed} completed, ${stats.failed} failed, ${stats.cancelled} cancelled)`;
  const lines = tasks.map((task) => {
    const status = task.status.toUpperCase();
    const suffix = task.result ? ` - ${task.result}` : task.error ? ` - error: ${task.error}` : "";
    return `  [${status}] ${task.id}: ${task.description}${suffix}`;
  });
  return [header, ...lines].join(`
`);
}

// src/categories.ts
var DEFAULT_CATEGORIES = [
  {
    name: "deep",
    displayName: "Deep Reasoning",
    description: "Deep reasoning tasks requiring extended thinking",
    preferredModel: "claude-opus-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "orchestrator"
  },
  {
    name: "quick",
    displayName: "Quick Implementation",
    description: "Fast, scoped implementation tasks",
    preferredModel: "gpt-4.1",
    fallbackModels: [{ model: "claude-sonnet-4" }],
    reasoningEffort: "low",
    suggestedPhase: "orchestrator"
  },
  {
    name: "research",
    displayName: "Research",
    description: "Investigation and codebase exploration",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "medium",
    suggestedPhase: "researcher"
  },
  {
    name: "review",
    displayName: "Code Review",
    description: "Code review and quality assessment",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "reviewer"
  },
  {
    name: "planning",
    displayName: "Planning",
    description: "Architecture and design planning",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "planner"
  },
  {
    name: "writing",
    displayName: "Writing",
    description: "Documentation and content creation",
    preferredModel: "gpt-4.1",
    fallbackModels: [{ model: "claude-sonnet-4" }],
    reasoningEffort: "medium",
    suggestedPhase: "orchestrator"
  }
];
function getCategoryByName(name) {
  return DEFAULT_CATEGORIES.find((c) => c.name === name) ?? null;
}
function listCategoryNames() {
  return DEFAULT_CATEGORIES.map((c) => c.name);
}
function formatCategorySummary(categories = DEFAULT_CATEGORIES) {
  const lines = ["Task categories:"];
  for (const cat of categories) {
    lines.push(`  ${cat.name} (${cat.displayName}): ${cat.description} [model: ${cat.preferredModel}, fallbacks: ${formatModelTargets(cat.fallbackModels)}, effort: ${cat.reasoningEffort}, phase: ${cat.suggestedPhase}]`);
  }
  return lines.join(`
`);
}
function applyCategoryOverrides(overrides) {
  return DEFAULT_CATEGORIES.map((cat) => {
    const override = overrides[cat.name];
    if (!override) {
      return cat;
    }
    return {
      ...cat,
      preferredModel: override.preferredModel ?? cat.preferredModel,
      fallbackModels: override.fallbackModels ?? (override.fallbackModel ? [{ model: override.fallbackModel }] : cat.fallbackModels),
      reasoningEffort: override.reasoningEffort ?? cat.reasoningEffort,
      allowedTools: override.allowedTools ?? cat.allowedTools,
      deniedTools: override.deniedTools ?? cat.deniedTools,
      promptAppend: override.promptAppend ?? cat.promptAppend
    };
  });
}
var RESEARCH_KEYWORDS2 = [
  "investigate",
  "explore",
  "research",
  "search",
  "find",
  "look up",
  "understand",
  "trace",
  "analyze",
  "dig into",
  "survey"
];
var REVIEW_KEYWORDS = [
  "review",
  "audit",
  "check",
  "inspect",
  "assess",
  "evaluate",
  "lint",
  "quality",
  "correctness"
];
var PLANNING_KEYWORDS = [
  "plan",
  "design",
  "architect",
  "blueprint",
  "outline",
  "propose",
  "strategy",
  "roadmap",
  "scope"
];
var QUICK_KEYWORDS = [
  "quick",
  "fix",
  "small",
  "typo",
  "rename",
  "tweak",
  "patch",
  "hotfix",
  "minor",
  "simple",
  "trivial"
];
var WRITING_KEYWORDS = [
  "document",
  "docs",
  "readme",
  "changelog",
  "write up",
  "describe",
  "summarize",
  "content",
  "draft",
  "documentation"
];
function matchesKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}
function inferCategoryFromObjective(objective) {
  if (matchesKeywords(objective, RESEARCH_KEYWORDS2)) {
    return getCategoryByName("research");
  }
  if (matchesKeywords(objective, REVIEW_KEYWORDS)) {
    return getCategoryByName("review");
  }
  if (matchesKeywords(objective, PLANNING_KEYWORDS)) {
    return getCategoryByName("planning");
  }
  if (matchesKeywords(objective, QUICK_KEYWORDS)) {
    return getCategoryByName("quick");
  }
  if (matchesKeywords(objective, WRITING_KEYWORDS)) {
    return getCategoryByName("writing");
  }
  return getCategoryByName("deep");
}

// src/ast-grep.ts
import { spawnSync as spawnSync3 } from "node:child_process";
import * as path17 from "node:path";
var DEFAULT_AST_GREP_BINARY = "ast-grep";
function resolvePaths(cwd, pathsToSearch) {
  if (!pathsToSearch || pathsToSearch.length === 0) {
    return [cwd];
  }
  return pathsToSearch.map((target) => path17.isAbsolute(target) ? target : path17.resolve(cwd, target));
}
function runAstGrep(args) {
  const binary = args.binary?.trim() || resolveBundledAstGrepBinary() || DEFAULT_AST_GREP_BINARY;
  const commandArgs = ["run", "--pattern", args.pattern];
  if (args.rewrite) {
    commandArgs.push("--rewrite", args.rewrite);
    if (args.apply) {
      commandArgs.push("--update-all");
    }
  }
  if (args.language) {
    commandArgs.push("--lang", args.language);
  }
  for (const glob of args.globs ?? []) {
    commandArgs.push("--globs", glob);
  }
  if (args.json) {
    commandArgs.push("--json=stream");
  }
  commandArgs.push(...resolvePaths(args.cwd, args.paths));
  const result = spawnSync3(binary, commandArgs, {
    cwd: args.cwd,
    encoding: "utf8"
  });
  if (result.error) {
    const code = result.error.code;
    if (code === "ENOENT") {
      throw new Error(`OpenAgent could not find a bundled or PATH-visible ast-grep binary. Tried "${binary}".`);
    }
    throw result.error;
  }
  return {
    command: `${binary} ${commandArgs.join(" ")}`,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status ?? 1
  };
}
function runOpenAgentAstSearch(args) {
  return runAstGrep({
    cwd: args.cwd,
    pattern: args.pattern,
    language: args.language,
    globs: args.globs,
    paths: args.paths,
    json: args.json
  });
}
function runOpenAgentAstReplace(args) {
  const result = runAstGrep({
    cwd: args.cwd,
    pattern: args.pattern,
    rewrite: args.rewrite,
    language: args.language,
    globs: args.globs,
    paths: args.paths,
    apply: args.apply
  });
  return {
    ...result,
    applied: args.apply === true
  };
}

// src/lsp-lite.ts
import { existsSync as existsSync17 } from "node:fs";
import { readFile as readFile12, writeFile as writeFile9 } from "node:fs/promises";
import * as path18 from "node:path";
import ts from "typescript";
var SUPPORTED_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
  ".mjs",
  ".cjs"
]);
function normalizePath(filePath) {
  return path18.resolve(filePath);
}
function isPathInsideRoot(root, targetPath) {
  const relative5 = path18.relative(root, targetPath);
  return relative5 === "" || !relative5.startsWith("..") && !path18.isAbsolute(relative5);
}
function ensureSupportedFile(filePath) {
  const absolute = normalizePath(filePath);
  if (!existsSync17(absolute)) {
    throw new Error(`LSP-lite target "${filePath}" does not exist.`);
  }
  if (!SUPPORTED_EXTENSIONS.has(path18.extname(absolute))) {
    throw new Error(`LSP-lite only supports TypeScript and JavaScript files. Unsupported target: ${filePath}`);
  }
  return absolute;
}
function resolveTargetPath2(cwd, rawPath) {
  return ensureSupportedFile(path18.isAbsolute(rawPath) ? rawPath : path18.resolve(cwd, rawPath));
}
function resolveProjectFiles(cwd, targetFile) {
  const configPath = ts.findConfigFile(path18.dirname(targetFile), ts.sys.fileExists);
  if (configPath) {
    const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
    if (readResult.error) {
      throw new Error(ts.flattenDiagnosticMessageText(readResult.error.messageText, `
`));
    }
    const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, path18.dirname(configPath), undefined, configPath);
    if (parsed.errors.length > 0) {
      throw new Error(parsed.errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, `
`)).join(`
`));
    }
    const fileNames2 = new Set(parsed.fileNames.map(normalizePath));
    fileNames2.add(targetFile);
    return {
      configPath,
      fileNames: [...fileNames2],
      options: parsed.options
    };
  }
  const discovered = ts.sys.readDirectory(cwd, [...SUPPORTED_EXTENSIONS], undefined, undefined);
  const fileNames = new Set(discovered.map(normalizePath));
  fileNames.add(targetFile);
  return {
    configPath: null,
    fileNames: [...fileNames],
    options: {
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true
    }
  };
}
function createProjectContext(cwd, rawPath) {
  const absoluteFilePath = resolveTargetPath2(cwd, rawPath);
  const project = resolveProjectFiles(cwd, absoluteFilePath);
  const snapshots = new Map;
  const host = {
    getCompilationSettings: () => project.options,
    getScriptFileNames: () => project.fileNames,
    getScriptVersion: () => "1",
    getScriptSnapshot: (fileName) => {
      const absolute = normalizePath(fileName);
      if (!existsSync17(absolute)) {
        return;
      }
      const cached = snapshots.get(absolute);
      if (cached) {
        return cached;
      }
      const content = ts.sys.readFile(absolute);
      if (typeof content !== "string") {
        return;
      }
      const snapshot = ts.ScriptSnapshot.fromString(content);
      snapshots.set(absolute, snapshot);
      return snapshot;
    },
    getCurrentDirectory: () => cwd,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine
  };
  return {
    absoluteFilePath,
    configPath: project.configPath,
    service: ts.createLanguageService(host, ts.createDocumentRegistry())
  };
}
function getSourceFileOrThrow(service, filePath) {
  const sourceFile = service.getProgram()?.getSourceFile(filePath);
  if (!sourceFile) {
    throw new Error(`LSP-lite could not load source file "${filePath}".`);
  }
  return sourceFile;
}
function toOffset(sourceFile, position) {
  const line = Math.max(position.line - 1, 0);
  const character = Math.max(position.character - 1, 0);
  if (line >= sourceFile.getLineStarts().length) {
    throw new Error(`Line ${position.line} is outside ${sourceFile.fileName}.`);
  }
  return ts.getPositionOfLineAndCharacter(sourceFile, line, character);
}
function fromOffset(sourceFile, offset) {
  const { line, character } = ts.getLineAndCharacterOfPosition(sourceFile, offset);
  return {
    line: line + 1,
    character: character + 1
  };
}
function diagnosticCategoryName(category) {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    case ts.DiagnosticCategory.Suggestion:
      return "suggestion";
    case ts.DiagnosticCategory.Message:
      return "message";
    default:
      return "unknown";
  }
}
function extractContextLine(sourceFile, offset) {
  const start = sourceFile.getLineStarts();
  const { line } = ts.getLineAndCharacterOfPosition(sourceFile, offset);
  const lineStart = start[line];
  const lineEnd = line + 1 < start.length ? start[line + 1] : sourceFile.text.length;
  return sourceFile.text.slice(lineStart, lineEnd).trim();
}
function filePathFromTextSpan(service, filePath, span) {
  const sourceFile = getSourceFileOrThrow(service, filePath);
  return {
    start: fromOffset(sourceFile, span.start),
    end: fromOffset(sourceFile, span.start + span.length),
    context: extractContextLine(sourceFile, span.start)
  };
}
function getOpenAgentLspDiagnostics(args) {
  const context = createProjectContext(args.cwd, args.file);
  const diagnostics = context.service.getSemanticDiagnostics(context.absoluteFilePath).concat(context.service.getSyntacticDiagnostics(context.absoluteFilePath));
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const maxResults = Math.max(1, args.maxResults ?? 100);
  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    diagnostics: diagnostics.slice(0, maxResults).map((diagnostic) => ({
      filePath: diagnostic.file?.fileName ?? context.absoluteFilePath,
      category: diagnosticCategoryName(diagnostic.category),
      code: String(diagnostic.code),
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, `
`),
      start: typeof diagnostic.start === "number" ? fromOffset(diagnostic.file ?? sourceFile, diagnostic.start) : { line: 1, character: 1 }
    }))
  };
}
function getOpenAgentLspDefinitions(args) {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const quickInfo = context.service.getQuickInfoAtPosition(context.absoluteFilePath, offset);
  const definitions = context.service.getDefinitionAtPosition(context.absoluteFilePath, offset) ?? [];
  const maxResults = Math.max(1, args.maxResults ?? 25);
  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: quickInfo ? ts.displayPartsToString(quickInfo.displayParts) : "unknown symbol",
    definitions: definitions.slice(0, maxResults).map((definition) => ({
      filePath: definition.fileName,
      ...filePathFromTextSpan(context.service, definition.fileName, definition.textSpan)
    }))
  };
}
function getOpenAgentLspReferences(args) {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const quickInfo = context.service.getQuickInfoAtPosition(context.absoluteFilePath, offset);
  const references = context.service.getReferencesAtPosition(context.absoluteFilePath, offset) ?? [];
  const definitions = context.service.getDefinitionAtPosition(context.absoluteFilePath, offset) ?? [];
  const definitionKeys = new Set(definitions.map((definition) => `${definition.fileName}:${definition.textSpan.start}:${definition.textSpan.length}`));
  const includeDeclaration = args.includeDeclaration !== false;
  const filtered = includeDeclaration ? references : references.filter((reference) => !definitionKeys.has(`${reference.fileName}:${reference.textSpan.start}:${reference.textSpan.length}`));
  const maxResults = Math.max(1, args.maxResults ?? 100);
  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: quickInfo ? ts.displayPartsToString(quickInfo.displayParts) : "unknown symbol",
    references: filtered.slice(0, maxResults).map((reference) => {
      const span = filePathFromTextSpan(context.service, reference.fileName, reference.textSpan);
      return {
        filePath: reference.fileName,
        start: span.start,
        context: span.context,
        isDefinition: definitionKeys.has(`${reference.fileName}:${reference.textSpan.start}:${reference.textSpan.length}`)
      };
    })
  };
}
function applyTextChanges(content, edits, newName) {
  const ordered = [...edits].sort((left, right) => right.textSpan.start - left.textSpan.start);
  let nextContent = content;
  for (const edit of ordered) {
    nextContent = nextContent.slice(0, edit.textSpan.start) + newName + nextContent.slice(edit.textSpan.start + edit.textSpan.length);
  }
  return nextContent;
}
async function runOpenAgentLspRename(args) {
  const context = createProjectContext(args.cwd, args.file);
  const sourceFile = getSourceFileOrThrow(context.service, context.absoluteFilePath);
  const offset = toOffset(sourceFile, { line: args.line, character: args.character });
  const renameInfo = context.service.getRenameInfo(context.absoluteFilePath, offset, {
    allowRenameOfImportPath: false
  });
  if (!renameInfo.canRename) {
    throw new Error(renameInfo.localizedErrorMessage || "TypeScript cannot rename the target symbol.");
  }
  const locations = context.service.findRenameLocations(context.absoluteFilePath, offset, false, false, true) ?? [];
  const editsByFile = new Map;
  for (const location of locations) {
    const current = editsByFile.get(location.fileName) ?? [];
    current.push(location);
    editsByFile.set(location.fileName, current);
  }
  const fileEdits = [];
  for (const [filePath, locationsForFile] of editsByFile) {
    const fileSource = getSourceFileOrThrow(context.service, filePath);
    fileEdits.push({
      filePath,
      edits: locationsForFile.map((location) => ({
        start: fromOffset(fileSource, location.textSpan.start),
        end: fromOffset(fileSource, location.textSpan.start + location.textSpan.length),
        originalText: fileSource.text.slice(location.textSpan.start, location.textSpan.start + location.textSpan.length),
        newText: args.newName
      }))
    });
  }
  if (args.apply) {
    const disallowed = [...editsByFile.keys()].filter((filePath) => !isPathInsideRoot(args.cwd, filePath));
    if (disallowed.length > 0) {
      throw new Error(`Refusing to apply rename outside the workspace root. Offending files: ${disallowed.join(", ")}`);
    }
    for (const [filePath, locationsForFile] of editsByFile) {
      const currentContent = await readFile12(filePath, "utf8");
      const nextContent = applyTextChanges(currentContent, locationsForFile, args.newName);
      await writeFile9(filePath, nextContent, "utf8");
    }
  }
  return {
    filePath: context.absoluteFilePath,
    configPath: context.configPath,
    symbolName: renameInfo.displayName,
    canRename: true,
    fileEdits,
    applied: args.apply === true
  };
}

// src/safe-edit.ts
import { createHash } from "node:crypto";
import { readFile as readFile13, writeFile as writeFile10 } from "node:fs/promises";
import * as path19 from "node:path";
function isInsideRoot2(candidatePath, rootPath) {
  const resolvedRoot = path19.resolve(rootPath);
  const resolvedCandidate = path19.resolve(candidatePath);
  const relative6 = path19.relative(resolvedRoot, resolvedCandidate);
  return relative6 === "" || !relative6.startsWith("..") && !path19.isAbsolute(relative6);
}
function countOccurrences(haystack, needle) {
  if (needle.length === 0) {
    return 0;
  }
  let count = 0;
  let index = 0;
  while (true) {
    index = haystack.indexOf(needle, index);
    if (index === -1) {
      return count;
    }
    count += 1;
    index += needle.length;
  }
}
function hashSafeEditLine(line) {
  return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 16);
}
async function applyOpenAgentSafeEdit(args) {
  const resolvedFilePath = path19.resolve(args.cwd, args.file);
  const allowedRoots = [path19.resolve(args.cwd)];
  if (args.workspacePath) {
    allowedRoots.push(path19.resolve(args.workspacePath));
  }
  if (!allowedRoots.some((root) => isInsideRoot2(resolvedFilePath, root))) {
    throw new Error("openagent_safe_edit only allows files inside the repo or session workspace.");
  }
  if (args.oldBlock.length === 0) {
    throw new Error("openagent_safe_edit requires a non-empty oldBlock.");
  }
  const currentContent = await readFile13(resolvedFilePath, "utf8");
  const occurrenceCount = countOccurrences(currentContent, args.oldBlock);
  if (occurrenceCount === 0) {
    throw new Error("openagent_safe_edit could not find oldBlock in the target file.");
  }
  if (occurrenceCount > 1) {
    throw new Error("openagent_safe_edit found multiple oldBlock matches; refine the block.");
  }
  const matchIndex = currentContent.indexOf(args.oldBlock);
  const lineNumber = currentContent.slice(0, matchIndex).split(/\r?\n/).length;
  const currentFirstLine = args.oldBlock.split(/\r?\n/, 1)[0] ?? "";
  const currentHash = hashSafeEditLine(currentFirstLine);
  if (currentHash !== args.lineHash) {
    throw new Error(`openagent_safe_edit refused to edit because the target line hash drifted (expected ${args.lineHash}, found ${currentHash}).`);
  }
  const nextContent = currentContent.replace(args.oldBlock, args.newBlock);
  await writeFile10(resolvedFilePath, nextContent, "utf8");
  return {
    filePath: resolvedFilePath,
    lineNumber,
    nextContent
  };
}

// src/tasks.ts
import { existsSync as existsSync18 } from "node:fs";
import { mkdir as mkdir9, readFile as readFile14, writeFile as writeFile11, unlink } from "node:fs/promises";
import * as path20 from "node:path";
function getTasksRoot(session, config) {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path20.join(paths.notesRoot, "tasks");
}
function getTaskFilePath(tasksRoot, taskId) {
  return path20.join(tasksRoot, `${taskId}.json`);
}
function getIndexFilePath(tasksRoot) {
  return path20.join(tasksRoot, "index.json");
}
async function readIndex(tasksRoot) {
  const indexPath = getIndexFilePath(tasksRoot);
  if (!existsSync18(indexPath)) {
    return { taskIds: [] };
  }
  const raw = await readFile14(indexPath, "utf8");
  const parsed = JSON.parse(raw);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "taskIds" in parsed && Array.isArray(parsed.taskIds)) {
    return parsed;
  }
  return { taskIds: [] };
}
async function writeIndex(tasksRoot, index) {
  await mkdir9(tasksRoot, { recursive: true });
  await writeFile11(getIndexFilePath(tasksRoot), JSON.stringify(index, null, 2), "utf8");
}
async function readOpenAgentTask(session, config, taskId) {
  const tasksRoot = getTasksRoot(session, config);
  const filePath = getTaskFilePath(tasksRoot, taskId);
  if (!existsSync18(filePath)) {
    return null;
  }
  const raw = await readFile14(filePath, "utf8");
  return JSON.parse(raw);
}
async function writeOpenAgentTask(session, config, task) {
  const tasksRoot = getTasksRoot(session, config);
  await mkdir9(tasksRoot, { recursive: true });
  const filePath = getTaskFilePath(tasksRoot, task.id);
  await writeFile11(filePath, JSON.stringify(task, null, 2), "utf8");
  const index = await readIndex(tasksRoot);
  if (!index.taskIds.includes(task.id)) {
    index.taskIds.push(task.id);
    await writeIndex(tasksRoot, index);
  }
}
async function listOpenAgentTasks(session, config) {
  const tasksRoot = getTasksRoot(session, config);
  const index = await readIndex(tasksRoot);
  const tasks = [];
  for (const taskId of index.taskIds) {
    const task = await readOpenAgentTask(session, config, taskId);
    if (task) {
      tasks.push(task);
    }
  }
  return tasks;
}
async function getReadyOpenAgentTasks(session, config) {
  const allTasks = await listOpenAgentTasks(session, config);
  const statusById = new Map;
  for (const task of allTasks) {
    statusById.set(task.id, task.status);
  }
  return allTasks.filter((task) => {
    if (task.status !== "pending") {
      return false;
    }
    return task.blockedBy.every((blockerId) => statusById.get(blockerId) === "done");
  });
}

// src/task-tools.ts
var TASK_STATUSES = [
  "pending",
  "in_progress",
  "done",
  "blocked"
];
function isRecord7(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTaskStatus(value) {
  return typeof value === "string" && TASK_STATUSES.includes(value);
}
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isStringRecord(value) {
  if (!isRecord7(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === "string");
}
function createSuccessResult(textResultForLlm, sessionLog) {
  return {
    textResultForLlm,
    resultType: "success",
    sessionLog
  };
}
function createFailureResult(textResultForLlm, error) {
  return {
    textResultForLlm,
    resultType: "failure",
    error
  };
}
function resolveCwd(initialCwd) {
  const current = process.cwd();
  return current.length > 0 ? current : initialCwd;
}
function formatTask(task) {
  const lines = [
    `id: ${task.id}`,
    `title: ${task.title}`,
    `status: ${task.status}`,
    `owner: ${task.owner}`,
    `description: ${task.description}`
  ];
  if (task.blockedBy.length > 0) {
    lines.push(`blocked by: ${task.blockedBy.join(", ")}`);
  }
  if (task.blocks.length > 0) {
    lines.push(`blocks: ${task.blocks.join(", ")}`);
  }
  const metadataKeys = Object.keys(task.metadata);
  if (metadataKeys.length > 0) {
    const entries = metadataKeys.map((key) => `${key}=${task.metadata[key]}`);
    lines.push(`metadata: ${entries.join(", ")}`);
  }
  lines.push(`created: ${task.createdAt}`);
  lines.push(`updated: ${task.updatedAt}`);
  return lines.join(`
`);
}
function formatTaskSummary(task) {
  const blockerNote = task.blockedBy.length > 0 ? ` (blocked by: ${task.blockedBy.join(", ")})` : "";
  return `[${task.status}] ${task.id} - ${task.title}${blockerNote}`;
}
function parseCreateTaskArgs(args) {
  if (!isRecord7(args) || typeof args.id !== "string" || args.id.length === 0 || typeof args.title !== "string" || args.title.length === 0 || typeof args.description !== "string" || args.description.length === 0) {
    throw new Error("openagent_task_create requires non-empty string id, title, and description fields.");
  }
  const blockedBy = args.blockedBy !== undefined && isStringArray(args.blockedBy) ? args.blockedBy : [];
  const blocks = args.blocks !== undefined && isStringArray(args.blocks) ? args.blocks : [];
  const owner = typeof args.owner === "string" && args.owner.length > 0 ? args.owner : "user";
  const metadata = args.metadata !== undefined && isStringRecord(args.metadata) ? args.metadata : {};
  return {
    id: args.id,
    title: args.title,
    description: args.description,
    blockedBy,
    blocks,
    owner,
    metadata
  };
}
function parseUpdateTaskArgs(args) {
  if (!isRecord7(args) || typeof args.id !== "string" || args.id.length === 0) {
    throw new Error("openagent_task_update requires a non-empty string id field.");
  }
  const result = { id: args.id };
  if (args.status !== undefined) {
    if (!isTaskStatus(args.status)) {
      throw new Error(`openagent_task_update status must be one of: ${TASK_STATUSES.join(", ")}.`);
    }
    result.status = args.status;
  }
  if (typeof args.title === "string" && args.title.length > 0) {
    result.title = args.title;
  }
  if (typeof args.description === "string" && args.description.length > 0) {
    result.description = args.description;
  }
  if (args.blockedBy !== undefined && isStringArray(args.blockedBy)) {
    result.blockedBy = args.blockedBy;
  }
  if (args.blocks !== undefined && isStringArray(args.blocks)) {
    result.blocks = args.blocks;
  }
  if (typeof args.owner === "string" && args.owner.length > 0) {
    result.owner = args.owner;
  }
  if (args.metadata !== undefined && isStringRecord(args.metadata)) {
    result.metadata = args.metadata;
  }
  return result;
}
function parseListTaskArgs(args) {
  if (!isRecord7(args)) {
    return { showReady: false };
  }
  const result = {
    showReady: args.showReady === true
  };
  if (args.status !== undefined && isTaskStatus(args.status)) {
    result.status = args.status;
  }
  return result;
}
function parseGetTaskArgs(args) {
  if (!isRecord7(args) || typeof args.id !== "string" || args.id.length === 0) {
    throw new Error("openagent_task_get requires a non-empty string id field.");
  }
  return { id: args.id };
}
function createTaskTools(args) {
  const { getSession, initialCwd } = args;
  const taskCreateTool = {
    name: "openagent_task_create",
    description: "Create a new task in the OpenAgent task tracker with dependency information and ownership.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique kebab-case identifier for the task."
        },
        title: {
          type: "string",
          description: "Short human-readable title for the task."
        },
        description: {
          type: "string",
          description: "Detailed description of what the task involves."
        },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that must be completed before this task can start."
        },
        blocks: {
          type: "array",
          items: { type: "string" },
          description: "Task IDs that depend on this task being completed."
        },
        owner: {
          type: "string",
          description: "Agent name or 'user' indicating who owns this task."
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Arbitrary key-value metadata for the task."
        }
      },
      required: ["id", "title", "description"]
    },
    handler: async (args2) => {
      const parsed = parseCreateTaskArgs(args2);
      const session = getSession();
      if (!session.workspacePath) {
        return createFailureResult("Cannot create task because the session workspace is disabled.", "Session workspace is unavailable.");
      }
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const existing = await readOpenAgentTask(session, resolution.config, parsed.id);
      if (existing) {
        return createFailureResult(`Task "${parsed.id}" already exists. Use openagent_task_update to modify it.`, "Task ID already exists.");
      }
      const now = new Date().toISOString();
      const task = {
        id: parsed.id,
        title: parsed.title,
        description: parsed.description,
        status: "pending",
        blockedBy: parsed.blockedBy,
        blocks: parsed.blocks,
        owner: parsed.owner,
        metadata: parsed.metadata,
        createdAt: now,
        updatedAt: now
      };
      await writeOpenAgentTask(session, resolution.config, task);
      return createSuccessResult(`Created task "${task.id}" (${task.title}) with status pending.`, `OpenAgent created task ${task.id}.`);
    }
  };
  const taskListTool = {
    name: "openagent_task_list",
    description: "List all tasks in the OpenAgent task tracker with optional status filter or ready-only mode.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "blocked"],
          description: "Filter tasks to only this status."
        },
        showReady: {
          type: "boolean",
          description: "If true, only return pending tasks whose blockers are all done."
        }
      }
    },
    handler: async (args2) => {
      const parsed = parseListTaskArgs(args2);
      const session = getSession();
      if (!session.workspacePath) {
        return createFailureResult("Cannot list tasks because the session workspace is disabled.", "Session workspace is unavailable.");
      }
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      let tasks;
      if (parsed.showReady) {
        tasks = await getReadyOpenAgentTasks(session, resolution.config);
      } else {
        tasks = await listOpenAgentTasks(session, resolution.config);
      }
      if (parsed.status) {
        tasks = tasks.filter((task) => task.status === parsed.status);
      }
      if (tasks.length === 0) {
        const qualifier = parsed.showReady ? "ready" : parsed.status ? `with status "${parsed.status}"` : "";
        return createSuccessResult(`No tasks found${qualifier ? ` ${qualifier}` : ""}.`);
      }
      const header = parsed.showReady ? `${tasks.length} ready task(s):` : parsed.status ? `${tasks.length} task(s) with status "${parsed.status}":` : `${tasks.length} task(s) total:`;
      const summaries = tasks.map(formatTaskSummary);
      return createSuccessResult([header, ...summaries].join(`
`), `OpenAgent listed ${tasks.length} task(s).`);
    }
  };
  const taskGetTool = {
    name: "openagent_task_get",
    description: "Get full details of a single task by ID from the OpenAgent task tracker.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The task ID to retrieve."
        }
      },
      required: ["id"]
    },
    handler: async (args2) => {
      const parsed = parseGetTaskArgs(args2);
      const session = getSession();
      if (!session.workspacePath) {
        return createFailureResult("Cannot get task because the session workspace is disabled.", "Session workspace is unavailable.");
      }
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const task = await readOpenAgentTask(session, resolution.config, parsed.id);
      if (!task) {
        return createFailureResult(`Task "${parsed.id}" not found.`, "Task not found.");
      }
      return createSuccessResult(formatTask(task), `OpenAgent retrieved task ${task.id}.`);
    }
  };
  const taskUpdateTool = {
    name: "openagent_task_update",
    description: "Update fields on an existing task in the OpenAgent task tracker. Only provided fields are changed.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The task ID to update."
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "done", "blocked"],
          description: "New status for the task."
        },
        title: {
          type: "string",
          description: "New title for the task."
        },
        description: {
          type: "string",
          description: "New description for the task."
        },
        blockedBy: {
          type: "array",
          items: { type: "string" },
          description: "Replacement list of task IDs that block this task."
        },
        blocks: {
          type: "array",
          items: { type: "string" },
          description: "Replacement list of task IDs that this task blocks."
        },
        owner: {
          type: "string",
          description: "New owner for the task."
        },
        metadata: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Metadata fields to merge into the task."
        }
      },
      required: ["id"]
    },
    handler: async (args2) => {
      const parsed = parseUpdateTaskArgs(args2);
      const session = getSession();
      if (!session.workspacePath) {
        return createFailureResult("Cannot update task because the session workspace is disabled.", "Session workspace is unavailable.");
      }
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const existing = await readOpenAgentTask(session, resolution.config, parsed.id);
      if (!existing) {
        return createFailureResult(`Task "${parsed.id}" not found.`, "Task not found.");
      }
      const updated = {
        ...existing,
        updatedAt: new Date().toISOString()
      };
      if (parsed.status !== undefined) {
        updated.status = parsed.status;
      }
      if (parsed.title !== undefined) {
        updated.title = parsed.title;
      }
      if (parsed.description !== undefined) {
        updated.description = parsed.description;
      }
      if (parsed.blockedBy !== undefined) {
        updated.blockedBy = parsed.blockedBy;
      }
      if (parsed.blocks !== undefined) {
        updated.blocks = parsed.blocks;
      }
      if (parsed.owner !== undefined) {
        updated.owner = parsed.owner;
      }
      if (parsed.metadata !== undefined) {
        updated.metadata = { ...existing.metadata, ...parsed.metadata };
      }
      await writeOpenAgentTask(session, resolution.config, updated);
      const changes = [];
      if (parsed.status !== undefined) {
        changes.push(`status: ${existing.status} -> ${updated.status}`);
      }
      if (parsed.title !== undefined) {
        changes.push(`title updated`);
      }
      if (parsed.description !== undefined) {
        changes.push(`description updated`);
      }
      if (parsed.blockedBy !== undefined) {
        changes.push(`blockedBy updated`);
      }
      if (parsed.blocks !== undefined) {
        changes.push(`blocks updated`);
      }
      if (parsed.owner !== undefined) {
        changes.push(`owner: ${existing.owner} -> ${updated.owner}`);
      }
      if (parsed.metadata !== undefined) {
        changes.push(`metadata merged`);
      }
      return createSuccessResult(`Updated task "${parsed.id}": ${changes.join(", ")}.`, `OpenAgent updated task ${parsed.id}.`);
    }
  };
  return [taskCreateTool, taskListTool, taskGetTool, taskUpdateTool];
}

// src/fleet.ts
import { existsSync as existsSync19 } from "node:fs";
import { mkdir as mkdir10, readFile as readFile15, unlink as unlink2, writeFile as writeFile12 } from "node:fs/promises";
import * as path21 from "node:path";
function getFleetFilePath(session, config) {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path21.join(paths.routingRoot, "fleet.json");
}
async function writeFleetWave(args) {
  const { session, config, objective, tasks } = args;
  const existingLog = await readFleetLog({ session, config });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const waveNumber = existingLog ? existingLog.waves.length + 1 : 1;
  const waveId = `fleet-${timestamp}-wave-${waveNumber}`;
  const now = new Date().toISOString();
  const wave = {
    id: waveId,
    wave: waveNumber,
    objective,
    createdAt: now,
    tasks: tasks.map((t, i) => ({
      id: `${waveId}-task-${i + 1}`,
      title: t.title,
      description: t.description,
      scope: t.scope,
      status: "dispatched",
      dispatchedAt: now
    }))
  };
  const log = existingLog ? {
    ...existingLog,
    objective,
    updatedAt: now,
    waves: [...existingLog.waves, wave]
  } : {
    id: `fleet-${timestamp}`,
    objective,
    createdAt: now,
    updatedAt: now,
    waves: [wave]
  };
  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir10(paths.routingRoot, { recursive: true });
  await writeFile12(getFleetFilePath(session, config), JSON.stringify(log, null, 2), "utf8");
  return { log, wave };
}
async function readFleetLog(args) {
  const { session, config } = args;
  const filePath = getFleetFilePath(session, config);
  if (!existsSync19(filePath)) {
    return null;
  }
  try {
    const content = await readFile15(filePath, "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}
async function updateFleetTaskStatus(args) {
  const { session, config, taskId, status, notes } = args;
  const log = await readFleetLog({ session, config });
  if (!log) {
    return { found: false };
  }
  let found = false;
  for (const wave of log.waves) {
    for (const task of wave.tasks) {
      if (task.id === taskId) {
        task.status = status;
        if (notes !== undefined) {
          task.notes = notes;
        }
        if (status === "completed" || status === "failed") {
          task.completedAt = new Date().toISOString();
        }
        found = true;
        break;
      }
    }
    if (found)
      break;
  }
  if (!found) {
    return { found: false };
  }
  log.updatedAt = new Date().toISOString();
  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir10(paths.routingRoot, { recursive: true });
  await writeFile12(getFleetFilePath(session, config), JSON.stringify(log, null, 2), "utf8");
  return { found: true };
}
function formatFleetDispatchInstructions(log, wave) {
  const { tasks } = wave;
  const plural = tasks.length === 1 ? "task" : "tasks";
  const header = [
    `Fleet ${log.id} registered.`,
    `Objective: ${wave.objective}`,
    `Wave: ${wave.wave} — ${tasks.length} ${plural}`,
    "",
    tasks.length === 1 ? `Dispatch the following task by calling the \`agent\` tool:` : `Dispatch ALL ${tasks.length} tasks simultaneously in a **single response** by calling the \`agent\` tool once per task:`,
    ""
  ].join(`
`);
  const taskBlocks = tasks.map((task, i) => {
    const safeName = task.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
    const prompt = [
      `Fleet ${log.id}, wave ${wave.wave}, task ${i + 1} of ${tasks.length}.`,
      ``,
      `Task: ${task.title}`,
      `Objective: ${task.description}`,
      task.scope ? `Scope (files/packages to modify): ${task.scope}` : "",
      ``,
      `Complete this task fully. Return a single final report containing:`,
      `1. Files changed (with one-line reason each)`,
      `2. Build/test results`,
      `3. Any blockers or follow-up needed`,
      ``,
      `IMPORTANT: After sending your report, stop. Do not continue working, do not ask follow-up questions, do not wait for further input. This is a terminal one-shot task.`
    ].filter((l) => l !== undefined).join(`
`);
    return [
      `--- Task ${i + 1} of ${tasks.length}: ${task.title} ---`,
      `agent_type: builder`,
      `name: ${safeName}`,
      `description: ${task.title.slice(0, 60)}`,
      `mode: background`,
      `prompt:`,
      prompt.split(`
`).map((l) => `  ${l}`).join(`
`)
    ].join(`
`);
  }).join(`

`);
  const footer = [
    "",
    tasks.length > 1 ? "Call the `agent` tool for all tasks above in one response to dispatch them in parallel." : "Call the `agent` tool with the parameters above.",
    "After all agents complete, read and verify each output before proceeding to the next wave or review."
  ].join(`
`);
  return header + taskBlocks + footer;
}

// src/tools.ts
function isRecord8(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function createSuccessResult2(textResultForLlm, sessionLog) {
  return {
    textResultForLlm,
    resultType: "success",
    sessionLog
  };
}
function createFailureResult2(textResultForLlm, error) {
  return {
    textResultForLlm,
    resultType: "failure",
    error
  };
}
function resolveCwd2(initialCwd) {
  const current = process.cwd();
  return current.length > 0 ? current : initialCwd;
}
function parsePlanNoteArgs(args) {
  if (!isRecord8(args) || typeof args.content !== "string" || args.content.length === 0) {
    throw new Error("openagent_plan_note requires a non-empty string content field.");
  }
  return {
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append"
  };
}
function parseWorkspaceNoteArgs(args) {
  if (!isRecord8(args) || typeof args.path !== "string" || args.path.length === 0 || typeof args.content !== "string" || args.content.length === 0) {
    throw new Error("openagent_workspace_note requires non-empty string path and content fields.");
  }
  return {
    path: args.path,
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append"
  };
}
function parseBootstrapTaskArgs(args) {
  if (!isRecord8(args) || typeof args.request !== "string" || args.request.trim().length === 0) {
    throw new Error("openagent_bootstrap_task requires a non-empty string request field.");
  }
  const mode = args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot" ? args.mode : "default";
  const rawPhase = args.phase;
  if (typeof rawPhase !== "undefined" && rawPhase !== "auto" && (typeof rawPhase !== "string" || !isOpenAgentBootstrapPhase(rawPhase))) {
    throw new Error(`openagent_bootstrap_task phase must be "auto" or one of: ${listOpenAgentBootstrapPhases()}.`);
  }
  return {
    request: args.request.trim(),
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    phase: rawPhase === "auto" || typeof rawPhase === "string" && isOpenAgentBootstrapPhase(rawPhase) ? rawPhase : "auto",
    syncPlan: args.syncPlan === false ? false : true,
    mode
  };
}
function parseRoutePhaseArgs(args) {
  if (!isRecord8(args) || typeof args.phase !== "string" || typeof args.objective !== "string" || typeof args.handoff !== "string") {
    throw new Error(`openagent_route_phase requires string phase, objective, and handoff fields. Available phases: ${listOpenAgentPhases()}.`);
  }
  const mode = args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot" ? args.mode : "default";
  const rawAgent = args.agent;
  if (typeof rawAgent !== "undefined" && (typeof rawAgent !== "string" || !isOpenAgentAgentName(rawAgent))) {
    throw new Error(`openagent_route_phase agent must be one of: ${OPENAGENT_AGENT_NAMES.join(", ")}.`);
  }
  return {
    phase: args.phase,
    agent: rawAgent,
    objective: args.objective,
    handoff: args.handoff,
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    syncPlan: args.syncPlan === false ? false : true,
    mode
  };
}
function parsePlanReviewArgs(args) {
  if (!isRecord8(args) || typeof args.request !== "string" || args.request.trim().length === 0) {
    throw new Error("openagent_plan_review requires a non-empty string request field.");
  }
  const mode = args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot" ? args.mode : "default";
  return {
    request: args.request.trim(),
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    syncPlan: args.syncPlan === false ? false : true,
    mode
  };
}
function parseFleetArgs(args) {
  if (!isRecord8(args) || typeof args.objective !== "string" || args.objective.trim().length === 0 || !Array.isArray(args.tasks) || args.tasks.length === 0) {
    throw new Error("openagent_fleet requires a non-empty objective string and a non-empty tasks array.");
  }
  const tasks = [];
  for (const [i, raw] of args.tasks.entries()) {
    if (!isRecord8(raw) || typeof raw.title !== "string" || raw.title.trim().length === 0 || typeof raw.description !== "string" || raw.description.trim().length === 0) {
      throw new Error(`openagent_fleet tasks[${i}] must have non-empty title and description strings.`);
    }
    tasks.push({
      title: raw.title.trim(),
      description: raw.description.trim(),
      scope: typeof raw.scope === "string" ? raw.scope.trim() : undefined
    });
  }
  return { objective: args.objective.trim(), tasks };
}
function parseMemoryWriteArgs(args) {
  if (!isRecord8(args) || typeof args.topic !== "string" || args.topic.trim().length === 0 || typeof args.content !== "string" || args.content.length === 0) {
    throw new Error("openagent_memory_write requires non-empty string topic and content fields.");
  }
  return {
    topic: args.topic.trim(),
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append"
  };
}
function parseMemoryReadArgs(args) {
  if (!isRecord8(args) || typeof args.topic !== "string" || args.topic.trim().length === 0) {
    throw new Error("openagent_memory_read requires a non-empty string topic field.");
  }
  return {
    topic: args.topic.trim()
  };
}
function parseSafeEditArgs(args) {
  if (!isRecord8(args) || typeof args.file !== "string" || args.file.trim().length === 0 || typeof args.lineHash !== "string" || args.lineHash.trim().length === 0 || typeof args.oldBlock !== "string" || typeof args.newBlock !== "string") {
    throw new Error("openagent_safe_edit requires string file, lineHash, oldBlock, and newBlock fields.");
  }
  return {
    file: args.file.trim(),
    lineHash: args.lineHash.trim(),
    oldBlock: args.oldBlock,
    newBlock: args.newBlock
  };
}
function parseDelegateArgs(args) {
  if (!isRecord8(args) || typeof args.objective !== "string" || args.objective.trim().length === 0 || typeof args.handoff !== "string" || args.handoff.trim().length === 0) {
    throw new Error("openagent_delegate requires non-empty string objective and handoff fields.");
  }
  const category = typeof args.category === "string" && args.category.trim().length > 0 ? args.category.trim() : null;
  return {
    category,
    objective: args.objective.trim(),
    handoff: args.handoff.trim()
  };
}
function parsePositiveIntegerField(value, fieldName, fallback) {
  if (typeof value === "undefined") {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}
function parseLspDiagnosticsArgs(args) {
  if (!isRecord8(args) || typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new Error("openagent_lsp_diagnostics requires a non-empty string file field.");
  }
  return {
    file: args.file.trim(),
    maxResults: parsePositiveIntegerField(args.maxResults, "maxResults")
  };
}
function parseLspLocationArgs(args, toolName) {
  if (!isRecord8(args) || typeof args.file !== "string" || args.file.trim().length === 0 || typeof args.line !== "number" || typeof args.character !== "number") {
    throw new Error(`${toolName} requires string file and numeric line/character fields.`);
  }
  const line = parsePositiveIntegerField(args.line, "line");
  const character = parsePositiveIntegerField(args.character, "character");
  if (typeof line === "undefined" || typeof character === "undefined") {
    throw new Error(`${toolName} requires positive integer line and character fields.`);
  }
  return {
    file: args.file.trim(),
    line,
    character,
    maxResults: parsePositiveIntegerField(args.maxResults, "maxResults")
  };
}
function parseLspRenameArgs(args) {
  const base = parseLspLocationArgs(args, "openagent_lsp_rename");
  if (!isRecord8(args) || typeof args.newName !== "string" || args.newName.trim().length === 0) {
    throw new Error("openagent_lsp_rename requires a non-empty string newName field.");
  }
  return {
    ...base,
    newName: args.newName.trim(),
    apply: args.apply === true
  };
}
function parseAstSearchArgs(args, toolName) {
  if (!isRecord8(args) || typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error(`${toolName} requires a non-empty string pattern field.`);
  }
  return {
    pattern: args.pattern,
    language: typeof args.language === "string" ? args.language : undefined,
    globs: Array.isArray(args.globs) ? args.globs.filter((entry) => typeof entry === "string" && entry.length > 0) : undefined,
    paths: Array.isArray(args.paths) ? args.paths.filter((entry) => typeof entry === "string" && entry.length > 0) : undefined,
    json: args.json === true
  };
}
function parseAstReplaceArgs(args) {
  const base = parseAstSearchArgs(args, "openagent_ast_replace");
  if (!isRecord8(args) || typeof args.rewrite !== "string") {
    throw new Error("openagent_ast_replace requires a string rewrite field.");
  }
  return {
    ...base,
    rewrite: args.rewrite,
    apply: args.apply === true
  };
}
function parseLookAtArgs(args) {
  if (!isRecord8(args) || typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new Error("openagent_look_at requires a non-empty string file field.");
  }
  return {
    file: args.file.trim(),
    prompt: typeof args.prompt === "string" && args.prompt.trim().length > 0 ? args.prompt.trim() : undefined
  };
}
function createTools(args) {
  const { getSession, initialCwd } = args;
  const runtimeStatusTool = {
    name: "openagent_runtime_status",
    description: "Report the active OpenAgent configuration, selected model, selected agent, current mode, workspace state, and bootstrap introspection.",
    skipPermission: true,
    handler: async () => {
      const session = getSession();
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const [mode, model, agent, plan] = await Promise.all([
        session.rpc.mode.get(),
        session.rpc.model.getCurrent(),
        session.rpc.agent.getCurrent(),
        session.rpc.plan.read()
      ]);
      const [routingStatus, bootstrapHistory] = await Promise.all([
        formatOpenAgentRoutingStatus({
          session,
          config: resolution2.config
        }),
        isOpenAgentWorkspaceAvailable(session) ? readBootstrapHistory(session, resolution2.config) : Promise.resolve(null)
      ]);
      const bootstrapSummary = bootstrapHistory ? formatBootstrapHistorySummary(bootstrapHistory) : "Bootstrap history unavailable (no workspace).";
      const bgStats = getBackgroundTaskStats();
      const bgSummary = `Background tasks: ${bgStats.total} total (${bgStats.running} running, ${bgStats.completed} completed, ${bgStats.failed} failed, ${bgStats.cancelled} cancelled)`;
      return createSuccessResult2([
        "OpenAgent runtime status",
        formatConfigSummary(resolution2),
        `mode: ${mode}`,
        `model: ${model.modelId ?? "host default"}`,
        `agent: ${agent.agent?.name ?? "host default"}`,
        `workspace path: ${session.workspacePath ?? "disabled"}`,
        `plan file: ${plan.path ?? "not available"}`,
        `plan exists: ${plan.exists ? "yes" : "no"}`,
        "",
        routingStatus,
        "",
        "Bootstrap introspection",
        bootstrapSummary,
        "",
        formatFallbackStatus(),
        "",
        formatOpenAgentCompactionStatus(),
        "",
        bgSummary,
        "",
        formatOpenAgentTelemetry(),
        "",
        formatCategorySummary(applyCategoryOverrides(resolution2.config.categories))
      ].join(`
`));
    }
  };
  const bootstrapTaskTool = {
    name: "openagent_bootstrap_task",
    description: "Bootstrap a raw request into an initial plan, selected phase, and durable handoff so OpenAgent can start disciplined work in one step.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "The raw task or request to bootstrap into plan + route + handoff."
        },
        phase: {
          type: "string",
          enum: ["auto", "planner", "researcher", "orchestrator"],
          description: "Optional override for the starting phase. Defaults to auto classification."
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the bootstrap."
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append the resulting route summary into the plan."
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the routed phase."
        }
      },
      required: ["request"]
    },
    handler: async (args2) => {
      const parsedArgs = parseBootstrapTaskArgs(args2);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent bootstrap");
        return createFailureResult2(message, message);
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const result = await bootstrapOpenAgentTask({
        session,
        config: resolution2.config,
        ...parsedArgs
      });
      return createSuccessResult2(formatOpenAgentBootstrapResult(result), "OpenAgent bootstrapped the task into a plan and routed phase.");
    }
  };
  const planNoteTool = {
    name: "openagent_plan_note",
    description: "Create or update the session plan with durable implementation notes that should survive future turns.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Plan text to write into the session plan file."
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the current plan or replace it."
        }
      },
      required: ["content"]
    },
    handler: async (args2) => {
      const parsedArgs = parsePlanNoteArgs(args2);
      const session = getSession();
      const result = await updateSessionPlan({
        session,
        content: parsedArgs.content,
        mode: parsedArgs.mode
      });
      return createSuccessResult2([
        `Updated the session plan in ${result.mode} mode.`,
        `Plan path: ${result.path ?? "workspace-managed plan.md"}`,
        `New length: ${result.nextContent.length} characters`
      ].join(`
`), "OpenAgent updated the session plan.");
    }
  };
  const workspaceNoteTool = {
    name: "openagent_workspace_note",
    description: "Write a durable note or artifact into the session workspace files directory under the OpenAgent notes folder.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Relative path for the note inside the OpenAgent workspace notes directory. .md is added if omitted."
        },
        content: {
          type: "string",
          description: "Text content to write to the workspace note."
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the note or replace it entirely."
        }
      },
      required: ["path", "content"]
    },
    handler: async (args2) => {
      const parsedArgs = parseWorkspaceNoteArgs(args2);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult2("OpenAgent could not persist the workspace note because the session workspace is disabled.", "Session workspace is unavailable.");
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const note = await writeOpenAgentWorkspaceNote({
        session,
        config: resolution2.config,
        relativePath: parsedArgs.path,
        content: parsedArgs.content,
        mode: parsedArgs.mode
      });
      return createSuccessResult2([
        `Saved OpenAgent workspace note to ${note.workspaceRelativePath}.`,
        `Write mode: ${parsedArgs.mode === "replace" ? "replace" : "append"}`,
        `Content length: ${note.nextContent.length} characters`
      ].join(`
`), "OpenAgent wrote a workspace note.");
    }
  };
  const routePhaseTool = {
    name: "openagent_route_phase",
    description: "Switch OpenAgent to a named phase, persist a durable handoff note, and select the matching phase agent or specialist variant.",
    parameters: {
      type: "object",
      properties: {
        phase: {
          type: "string",
          enum: ["orchestrator", "planner", "researcher", "reviewer"],
          description: "The target OpenAgent phase. Use `openagent_fleet` for implementation dispatch — routing directly to `implementer` is not supported."
        },
        agent: {
          type: "string",
          enum: [...OPENAGENT_AGENT_NAMES],
          description: "Optional agent override inside the target phase (for example skeptic or oracle)."
        },
        objective: {
          type: "string",
          description: "The concrete goal for the next phase."
        },
        handoff: {
          type: "string",
          description: "The durable handoff content the next phase should receive."
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the route."
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append a summary of the route to the session plan."
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the target phase."
        }
      },
      required: ["phase", "objective", "handoff"]
    },
    handler: async (args2) => {
      const parsedArgs = parseRoutePhaseArgs(args2);
      if (!isOpenAgentPhase(parsedArgs.phase)) {
        throw new Error(`Unknown OpenAgent phase "${parsedArgs.phase}". Available phases: ${listOpenAgentPhases()}.`);
      }
      if (parsedArgs.phase === "implementer") {
        return createFailureResult2("Direct routing to the implementer phase is not supported. Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool. This keeps the conductor in orchestrator phase while builders run.", "implementer routing disabled — use openagent_fleet");
      }
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent routing");
        return createFailureResult2(message, message);
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const result = await routeOpenAgentPhase({
        session,
        config: resolution2.config,
        request: {
          phase: parsedArgs.phase,
          agent: parsedArgs.agent,
          objective: parsedArgs.objective,
          handoff: parsedArgs.handoff,
          requestedBy: parsedArgs.requestedBy,
          syncPlan: parsedArgs.syncPlan,
          mode: parsedArgs.mode
        }
      });
      return createSuccessResult2([
        `OpenAgent routed from ${result.previousPhase} to ${result.phase}.`,
        `Selected agent: ${result.agent}`,
        `Mode: ${result.mode}`,
        `Handoff note: ${result.handoffWorkspacePath}`,
        `Plan updated: ${result.planUpdated ? "yes" : "no"}`
      ].join(`
`), `OpenAgent routed to the ${result.phase} phase.`);
    }
  };
  const fleetTool = {
    name: "openagent_fleet",
    description: "Register an implementation wave and get ready-to-dispatch agent payloads. Call the `agent` tool for each returned task in a single response to dispatch builders in parallel. For sequential waves, call `openagent_fleet` again after the previous wave completes.",
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "The overall implementation objective for this wave."
        },
        tasks: {
          type: "array",
          description: "Implementation tasks for this wave. Tasks within a wave run in parallel — only group tasks here if their file scopes do not overlap.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Short imperative title (e.g. 'Rename cmd/aim to cmd/tau')."
              },
              description: {
                type: "string",
                description: "Full task objective and what done looks like."
              },
              scope: {
                type: "string",
                description: "Files or packages this task modifies (e.g. 'cmd/aim/, go.mod'). Must not overlap with other tasks in the same wave."
              }
            },
            required: ["title", "description"]
          },
          minItems: 1
        }
      },
      required: ["objective", "tasks"]
    },
    handler: async (args2) => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("openagent_fleet");
        return createFailureResult2(message, message);
      }
      const parsedArgs = parseFleetArgs(args2);
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const { log, wave } = await writeFleetWave({
        session,
        config: resolution2.config,
        objective: parsedArgs.objective,
        tasks: parsedArgs.tasks
      });
      const instructions = formatFleetDispatchInstructions(log, wave);
      return createSuccessResult2(instructions, `Fleet ${log.id} wave ${wave.wave} registered with ${wave.tasks.length} task(s).`);
    }
  };
  const fleetStatusTool = {
    name: "openagent_fleet_status",
    description: "Read the current fleet log: all waves, tasks, and their statuses. Use after dispatching builders to check progress.",
    parameters: {
      type: "object",
      properties: {},
      required: []
    },
    handler: async () => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("openagent_fleet_status");
        return createFailureResult2(message, message);
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const log = await readFleetLog({ session, config: resolution2.config });
      if (!log) {
        return createSuccessResult2("No active fleet log.", "No active fleet.");
      }
      const lines = [
        `Fleet: ${log.id}`,
        `Objective: ${log.objective}`,
        `Created: ${log.createdAt}  Updated: ${log.updatedAt}`,
        `Waves: ${log.waves.length}`,
        ""
      ];
      for (const wave of log.waves) {
        lines.push(`Wave ${wave.wave} — ${wave.objective} (${wave.tasks.length} tasks)`);
        for (const task of wave.tasks) {
          const status = task.status.toUpperCase().padEnd(10);
          const notes = task.notes ? ` — ${task.notes}` : "";
          lines.push(`  [${status}] ${task.id}: ${task.title}${notes}`);
        }
        lines.push("");
      }
      const text = lines.join(`
`);
      return createSuccessResult2(text, `Fleet log has ${log.waves.length} wave(s).`);
    }
  };
  const fleetCompleteTool = {
    name: "openagent_fleet_complete",
    description: "Mark a fleet task as completed or failed. Call this after reading and verifying a builder agent's output. task_id must match a task id from the fleet log.",
    parameters: {
      type: "object",
      properties: {
        task_id: {
          type: "string",
          description: "The task id to update (from openagent_fleet_status)."
        },
        status: {
          type: "string",
          enum: ["completed", "failed"],
          description: "The outcome of the task."
        },
        notes: {
          type: "string",
          description: "Optional short notes about the outcome or any follow-up needed."
        }
      },
      required: ["task_id", "status"]
    },
    handler: async (args2) => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("openagent_fleet_complete");
        return createFailureResult2(message, message);
      }
      const taskId = args2.task_id;
      const status = args2.status;
      const notes = args2.notes;
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const result = await updateFleetTaskStatus({
        session,
        config: resolution2.config,
        taskId,
        status,
        notes
      });
      if (!result.found) {
        return createFailureResult2(`Task "${taskId}" not found in fleet log.`, `Task not found.`);
      }
      return createSuccessResult2(`Task "${taskId}" marked as ${status}.${notes ? ` Notes: ${notes}` : ""}`, `Task ${status}.`);
    }
  };
  const planReviewTool = {
    name: "openagent_plan_review",
    description: "Start a durable planner -> critic -> reviewer workflow before implementation begins.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "The request that should be planned and review-gated before implementation."
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the workflow."
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append a route summary into the session plan."
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the routed planner phase."
        }
      },
      required: ["request"]
    },
    handler: async (args2) => {
      const parsedArgs = parsePlanReviewArgs(args2);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent plan review");
        return createFailureResult2(message, message);
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const result = await startPlanReviewWorkflow({
        session,
        config: resolution2.config,
        ...parsedArgs
      });
      return createSuccessResult2(formatOpenAgentPlanReviewResult(result), "OpenAgent started the plan-review workflow.");
    }
  };
  const doctorTool = {
    name: "openagent_doctor",
    description: "Inspect OpenAgent config, routing state, plan availability, and local binary support.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        writeReport: {
          type: "boolean",
          description: "When true, also save the doctor report into files/openagent/doctor/ if the session workspace is available."
        }
      }
    },
    handler: async (args2) => {
      const session = getSession();
      const cwd = resolveCwd2(initialCwd);
      const resolution2 = loadOpenAgentConfig(cwd);
      const writeReport = isRecord8(args2) && typeof args2.writeReport === "boolean" ? args2.writeReport : true;
      const result = await runOpenAgentDoctor({
        session,
        cwd,
        resolution: resolution2,
        writeReport
      });
      return createSuccessResult2([
        result.report,
        "",
        `Saved report: ${result.reportWorkspacePath ?? "not written to workspace"}`,
        `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
        `Improvement memory: ${result.improvementMemoryPath}`
      ].join(`
`), "OpenAgent ran doctor checks.");
    }
  };
  const memoryWriteTool = {
    name: "openagent_memory_write",
    description: "Write a durable repository-scoped memory note under ~/.copilot/openagent/memory/ for reuse in later sessions.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic key for the memory note. Nested paths are allowed."
        },
        content: {
          type: "string",
          description: "Text content to persist."
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the note or replace it entirely."
        }
      },
      required: ["topic", "content"]
    },
    handler: async (args2) => {
      const parsedArgs = parseMemoryWriteArgs(args2);
      const result = await writeOpenAgentMemory({
        cwd: resolveCwd2(initialCwd),
        ...parsedArgs
      });
      return createSuccessResult2([
        `Saved repository memory note: ${result.relativePath}`,
        `Repo key: ${result.repoKey}`,
        `Mode: ${parsedArgs.mode === "replace" ? "replace" : "append"}`,
        `Content length: ${result.nextContent.length} characters`
      ].join(`
`), "OpenAgent wrote a durable memory note.");
    }
  };
  const memoryReadTool = {
    name: "openagent_memory_read",
    description: "Read a durable repository-scoped memory note from ~/.copilot/openagent/memory/.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic key to read."
        }
      },
      required: ["topic"]
    },
    handler: async (args2) => {
      const parsedArgs = parseMemoryReadArgs(args2);
      const result = await readOpenAgentMemory({
        cwd: resolveCwd2(initialCwd),
        topic: parsedArgs.topic
      });
      if (result.content === null) {
        return createFailureResult2(`No repository memory note found for topic "${parsedArgs.topic}".`, "Memory note not found.");
      }
      return createSuccessResult2([
        `Repository memory note: ${result.relativePath}`,
        `Repo key: ${result.repoKey}`,
        "",
        result.content
      ].join(`
`), "OpenAgent read a durable memory note.");
    }
  };
  const memoryListTool = {
    name: "openagent_memory_list",
    description: "List durable repository-scoped memory topics available for the current workspace.",
    skipPermission: true,
    handler: async () => {
      const result = await listOpenAgentMemoryTopics({
        cwd: resolveCwd2(initialCwd)
      });
      if (result.topics.length === 0) {
        return createSuccessResult2(`No repository memory topics stored for repo key "${result.repoKey}".`);
      }
      return createSuccessResult2([
        `Repository memory topics for ${result.repoKey}:`,
        ...result.topics.map((topic) => `- ${topic}`)
      ].join(`
`), `OpenAgent listed ${result.topics.length} memory topic(s).`);
    }
  };
  const safeEditTool = {
    name: "openagent_safe_edit",
    description: "Apply a precise block replacement only if the target block is unique and the first-line hash still matches.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target file path, relative to the repo when not absolute."
        },
        lineHash: {
          type: "string",
          description: "Hash of the first line of oldBlock. Use this to refuse stale edits when the line has drifted."
        },
        oldBlock: {
          type: "string",
          description: "The exact existing block that should be replaced."
        },
        newBlock: {
          type: "string",
          description: "The replacement block."
        }
      },
      required: ["file", "lineHash", "oldBlock", "newBlock"]
    },
    handler: async (args2) => {
      const parsedArgs = parseSafeEditArgs(args2);
      const session = getSession();
      try {
        const result = await applyOpenAgentSafeEdit({
          cwd: resolveCwd2(initialCwd),
          workspacePath: session.workspacePath ?? undefined,
          ...parsedArgs
        });
        return createSuccessResult2([
          `Applied safe edit to ${result.filePath}.`,
          `Matched line number: ${result.lineNumber}`,
          `New file length: ${result.nextContent.length} characters`
        ].join(`
`), `OpenAgent safely edited ${parsedArgs.file}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const lspDiagnosticsTool = {
    name: "openagent_lsp_diagnostics",
    description: "Read TypeScript or JavaScript diagnostics for a file using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file."
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of diagnostics to return."
        }
      },
      required: ["file"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseLspDiagnosticsArgs(args2);
        const result = getOpenAgentLspDiagnostics({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        if (result.diagnostics.length === 0) {
          return createSuccessResult2([
            `No TypeScript diagnostics found for ${result.filePath}.`,
            `Config: ${result.configPath ?? "inferred project"}`
          ].join(`
`), "OpenAgent found no LSP diagnostics.");
        }
        return createSuccessResult2([
          `TypeScript diagnostics for ${result.filePath}`,
          `Config: ${result.configPath ?? "inferred project"}`,
          ...result.diagnostics.map((diagnostic) => `- [${diagnostic.category}] ${diagnostic.filePath}:${diagnostic.start.line}:${diagnostic.start.character} TS${diagnostic.code} ${diagnostic.message}`)
        ].join(`
`), `OpenAgent reported ${result.diagnostics.length} LSP diagnostic(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const lspGotoDefinitionTool = {
    name: "openagent_lsp_goto_definition",
    description: "Find TypeScript or JavaScript symbol definitions for a file position using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file."
        },
        line: {
          type: "number",
          description: "1-based line number."
        },
        character: {
          type: "number",
          description: "1-based character number."
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of definitions to return."
        }
      },
      required: ["file", "line", "character"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseLspLocationArgs(args2, "openagent_lsp_goto_definition");
        const result = getOpenAgentLspDefinitions({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        if (result.definitions.length === 0) {
          return createSuccessResult2([
            `No definitions found for ${result.symbolName}.`,
            `Source file: ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`
          ].join(`
`), "OpenAgent found no LSP definitions.");
        }
        return createSuccessResult2([
          `Definitions for ${result.symbolName}`,
          `Source file: ${result.filePath}`,
          `Config: ${result.configPath ?? "inferred project"}`,
          ...result.definitions.map((definition) => `- ${definition.filePath}:${definition.start.line}:${definition.start.character} ${definition.context}`)
        ].join(`
`), `OpenAgent found ${result.definitions.length} definition(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const lspFindReferencesTool = {
    name: "openagent_lsp_find_references",
    description: "Find TypeScript or JavaScript references for a file position using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file."
        },
        line: {
          type: "number",
          description: "1-based line number."
        },
        character: {
          type: "number",
          description: "1-based character number."
        },
        includeDeclaration: {
          type: "boolean",
          description: "Whether to include the definition in the reference results."
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of references to return."
        }
      },
      required: ["file", "line", "character"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseLspLocationArgs(args2, "openagent_lsp_find_references");
        const includeDeclaration = isRecord8(args2) && typeof args2.includeDeclaration === "boolean" ? args2.includeDeclaration : true;
        const result = getOpenAgentLspReferences({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs,
          includeDeclaration
        });
        if (result.references.length === 0) {
          return createSuccessResult2([
            `No references found for ${result.symbolName}.`,
            `Source file: ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`
          ].join(`
`), "OpenAgent found no LSP references.");
        }
        return createSuccessResult2([
          `References for ${result.symbolName}`,
          `Source file: ${result.filePath}`,
          `Config: ${result.configPath ?? "inferred project"}`,
          ...result.references.map((reference) => `- ${reference.filePath}:${reference.start.line}:${reference.start.character}${reference.isDefinition ? " [definition]" : ""} ${reference.context}`)
        ].join(`
`), `OpenAgent found ${result.references.length} reference(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const lspRenameTool = {
    name: "openagent_lsp_rename",
    description: "Preview or apply a TypeScript or JavaScript symbol rename using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file."
        },
        line: {
          type: "number",
          description: "1-based line number."
        },
        character: {
          type: "number",
          description: "1-based character number."
        },
        newName: {
          type: "string",
          description: "Replacement identifier name."
        },
        apply: {
          type: "boolean",
          description: "When true, write the rename edits to disk. Otherwise return a preview only."
        },
        maxResults: {
          type: "number",
          description: "Ignored for rename; accepted for call-shape consistency."
        }
      },
      required: ["file", "line", "character", "newName"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseLspRenameArgs(args2);
        const result = await runOpenAgentLspRename({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        return createSuccessResult2([
          `${result.applied ? "Applied" : "Planned"} rename for ${result.symbolName} -> ${parsedArgs.newName}`,
          `Source file: ${result.filePath}`,
          `Config: ${result.configPath ?? "inferred project"}`,
          `Files touched: ${result.fileEdits.length}`,
          ...result.fileEdits.flatMap((fileEdit) => [
            `- ${fileEdit.filePath}`,
            ...fileEdit.edits.map((edit) => `  ${edit.start.line}:${edit.start.character}-${edit.end.line}:${edit.end.character} ${edit.originalText} -> ${edit.newText}`)
          ])
        ].join(`
`), result.applied ? `OpenAgent applied an LSP rename across ${result.fileEdits.length} file(s).` : `OpenAgent previewed an LSP rename across ${result.fileEdits.length} file(s).`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const astSearchTool = {
    name: "openagent_ast_search",
    description: "Search code with ast-grep when the ast-grep CLI is installed.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "ast-grep pattern to match."
        },
        language: {
          type: "string",
          description: "Optional ast-grep language override."
        },
        globs: {
          type: "array",
          items: { type: "string" },
          description: "Optional include/exclude glob filters passed to ast-grep."
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to scan. Defaults to the current workspace."
        },
        json: {
          type: "boolean",
          description: "When true, ask ast-grep for JSON stream output."
        }
      },
      required: ["pattern"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseAstSearchArgs(args2, "openagent_ast_search");
        const result = runOpenAgentAstSearch({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        const output = result.stdout || result.stderr || "ast-grep returned no output.";
        if (result.status !== 0) {
          return createFailureResult2(output, output);
        }
        return createSuccessResult2([`Command: ${result.command}`, "", output].join(`
`), "OpenAgent ran ast-grep search.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const astReplaceTool = {
    name: "openagent_ast_replace",
    description: "Preview or apply an ast-grep rewrite when the ast-grep CLI is installed.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "ast-grep pattern to match."
        },
        rewrite: {
          type: "string",
          description: "Rewrite template to apply to each match."
        },
        language: {
          type: "string",
          description: "Optional ast-grep language override."
        },
        globs: {
          type: "array",
          items: { type: "string" },
          description: "Optional include/exclude glob filters passed to ast-grep."
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to scan. Defaults to the current workspace."
        },
        apply: {
          type: "boolean",
          description: "When true, apply the rewrite with --update-all. Otherwise preview only."
        }
      },
      required: ["pattern", "rewrite"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseAstReplaceArgs(args2);
        const result = runOpenAgentAstReplace({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        const output = result.stdout || result.stderr || "ast-grep returned no output.";
        if (result.status !== 0) {
          return createFailureResult2(output, output);
        }
        return createSuccessResult2([
          `${result.applied ? "Applied" : "Previewed"} ast-grep rewrite.`,
          `Command: ${result.command}`,
          "",
          output
        ].join(`
`), result.applied ? "OpenAgent applied an ast-grep rewrite." : "OpenAgent previewed an ast-grep rewrite.");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const lookAtTool = {
    name: "openagent_look_at",
    description: "Inspect an image, PDF, text file, or binary artifact with local extraction helpers and metadata.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target file path, relative to the workspace when not absolute."
        },
        prompt: {
          type: "string",
          description: "Optional inspection question or focus area."
        }
      },
      required: ["file"]
    },
    handler: async (args2) => {
      try {
        const parsedArgs = parseLookAtArgs(args2);
        const result = await runOpenAgentLookAt({
          cwd: resolveCwd2(initialCwd),
          ...parsedArgs
        });
        return createSuccessResult2([
          `look_at strategy: ${result.strategy}`,
          `file: ${result.filePath}`,
          `mime: ${result.mimeType}`,
          "",
          result.output
        ].join(`
`), `OpenAgent inspected ${parsedArgs.file}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const backgroundRegisterTool = {
    name: "openagent_background_register",
    description: "Register a new background task being tracked by OpenAgent. Use this when dispatching work to a background agent.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique identifier for the background task."
        },
        description: {
          type: "string",
          description: "Short description of what the background task is doing."
        },
        owner: {
          type: "string",
          description: "Which agent or phase spawned this task."
        }
      },
      required: ["id", "description"]
    },
    handler: async (args2) => {
      if (!isRecord8(args2) || typeof args2.id !== "string" || args2.id.length === 0) {
        return createFailureResult2("openagent_background_register requires a non-empty string id.", "Missing id.");
      }
      if (typeof args2.description !== "string" || args2.description.length === 0) {
        return createFailureResult2("openagent_background_register requires a non-empty string description.", "Missing description.");
      }
      const owner = typeof args2.owner === "string" && args2.owner.length > 0 ? args2.owner : "openagent";
      try {
        const task = registerBackgroundTask({
          id: args2.id,
          description: args2.description,
          owner
        });
        return createSuccessResult2(`Registered background task "${task.id}" (owner: ${task.owner}, status: running).`, `OpenAgent registered background task ${task.id}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const backgroundUpdateTool = {
    name: "openagent_background_update",
    description: "Update the status, result, or error of a tracked background task.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The background task ID to update."
        },
        status: {
          type: "string",
          enum: ["running", "completed", "failed", "cancelled"],
          description: "New status for the background task."
        },
        result: {
          type: "string",
          description: "Summary of the result when the task completes."
        },
        error: {
          type: "string",
          description: "Error message if the task failed."
        }
      },
      required: ["id"]
    },
    handler: async (args2) => {
      if (!isRecord8(args2) || typeof args2.id !== "string" || args2.id.length === 0) {
        return createFailureResult2("openagent_background_update requires a non-empty string id.", "Missing id.");
      }
      const update = {};
      if (args2.status === "running" || args2.status === "completed" || args2.status === "failed" || args2.status === "cancelled") {
        update.status = args2.status;
      }
      if (typeof args2.result === "string") {
        update.result = args2.result;
      }
      if (typeof args2.error === "string") {
        update.error = args2.error;
      }
      try {
        const task = updateBackgroundTask(args2.id, update);
        return createSuccessResult2(`Updated background task "${task.id}" (status: ${task.status}).`, `OpenAgent updated background task ${task.id}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const backgroundListTool = {
    name: "openagent_background_list",
    description: "List all tracked background tasks with optional status filter.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["running", "completed", "failed", "cancelled"],
          description: "Filter tasks by status."
        }
      }
    },
    handler: async (args2) => {
      const filter = {};
      if (isRecord8(args2) && (args2.status === "running" || args2.status === "completed" || args2.status === "failed" || args2.status === "cancelled")) {
        filter.status = args2.status;
      }
      const tasks = listBackgroundTasks(filter.status ? filter : undefined);
      if (tasks.length === 0) {
        const qualifier = filter.status ? ` with status "${filter.status}"` : "";
        return createSuccessResult2(`No background tasks found${qualifier}.`);
      }
      const summary = formatBackgroundTasksSummary();
      return createSuccessResult2(summary, `OpenAgent listed ${tasks.length} background task(s).`);
    }
  };
  const backgroundCancelTool = {
    name: "openagent_background_cancel",
    description: "Cancel a running background task by ID.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The background task ID to cancel."
        }
      },
      required: ["id"]
    },
    handler: async (args2) => {
      if (!isRecord8(args2) || typeof args2.id !== "string" || args2.id.length === 0) {
        return createFailureResult2("openagent_background_cancel requires a non-empty string id.", "Missing id.");
      }
      try {
        const task = cancelBackgroundTask(args2.id);
        return createSuccessResult2(`Cancelled background task "${task.id}".`, `OpenAgent cancelled background task ${task.id}.`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
    }
  };
  const sessionListTool = {
    name: "openagent_session_list",
    description: "List recent OpenAgent session history entries from the workspace. Returns summaries of past sessions.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of recent sessions to return (default 10, max 100)."
        }
      }
    },
    handler: async (args2) => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult2(formatOpenAgentWorkspaceRequirement("Session history listing"), "Session workspace is unavailable.");
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const history = await readSessionHistory(session, resolution2.config);
      const count = isRecord8(args2) && typeof args2.count === "number" && args2.count > 0 ? Math.min(Math.floor(args2.count), 100) : 10;
      const recent = history.entries.slice(-count);
      if (recent.length === 0) {
        return createSuccessResult2("No session history entries found.");
      }
      const formatted = recent.map((entry, index) => `--- Entry ${index + 1} ---
${formatSessionHistoryEntry(entry)}`).join(`

`);
      return createSuccessResult2(`Found ${recent.length} session history entries (of ${history.entries.length} total).

${formatted}`);
    }
  };
  const sessionSearchTool = {
    name: "openagent_session_search",
    description: "Search OpenAgent session history by keyword. Matches against session summaries and key files (case-insensitive).",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to match against session summaries and key files."
        }
      },
      required: ["query"]
    },
    handler: async (args2) => {
      if (!isRecord8(args2) || typeof args2.query !== "string" || args2.query.trim().length === 0) {
        return createFailureResult2("openagent_session_search requires a non-empty string query field.", "Missing query.");
      }
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult2(formatOpenAgentWorkspaceRequirement("Session history search"), "Session workspace is unavailable.");
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const matches = await searchSessionHistory(session, resolution2.config, args2.query.trim());
      if (matches.length === 0) {
        return createSuccessResult2(`No session history entries matched "${args2.query}".`);
      }
      const formatted = matches.map((entry, index) => `--- Match ${index + 1} ---
${formatSessionHistoryEntry(entry)}`).join(`

`);
      return createSuccessResult2(`Found ${matches.length} matching session history entries.

${formatted}`);
    }
  };
  const sessionGetTool = {
    name: "openagent_session_get",
    description: "Get full details of a specific OpenAgent session by its session ID.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID to look up."
        }
      },
      required: ["sessionId"]
    },
    handler: async (args2) => {
      if (!isRecord8(args2) || typeof args2.sessionId !== "string" || args2.sessionId.trim().length === 0) {
        return createFailureResult2("openagent_session_get requires a non-empty string sessionId field.", "Missing sessionId.");
      }
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult2(formatOpenAgentWorkspaceRequirement("Session history lookup"), "Session workspace is unavailable.");
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const history = await readSessionHistory(session, resolution2.config);
      const entry = history.entries.find((e) => e.sessionId === args2.sessionId);
      if (!entry) {
        return createFailureResult2(`No session history entry found with ID "${args2.sessionId}".`, "Session not found.");
      }
      return createSuccessResult2(formatSessionHistoryEntry(entry));
    }
  };
  const delegateTool = {
    name: "openagent_delegate",
    description: "Delegate work to the appropriate category and model. Resolves a task category (explicit or inferred from objective), registers a background task, and routes to the category's suggested phase.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: listCategoryNames(),
          description: "Task category to route to. If omitted, inferred from objective keywords."
        },
        objective: {
          type: "string",
          description: "The concrete goal for the delegated work."
        },
        handoff: {
          type: "string",
          description: "Durable handoff content the target phase should receive."
        }
      },
      required: ["objective", "handoff"]
    },
    handler: async (args2) => {
      const parsedArgs = parseDelegateArgs(args2);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent delegate");
        return createFailureResult2(message, message);
      }
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      const categories = applyCategoryOverrides(resolution2.config.categories);
      const resolvedCategory = parsedArgs.category ? categories.find((c) => c.name === parsedArgs.category) ?? inferCategoryFromObjective(parsedArgs.objective) : inferCategoryFromObjective(parsedArgs.objective);
      const handoffParts = [parsedArgs.handoff];
      if (resolvedCategory.promptAppend) {
        handoffParts.push(resolvedCategory.promptAppend);
      }
      if (resolvedCategory.allowedTools && resolvedCategory.allowedTools.length > 0) {
        handoffParts.push(`Preferred tools for this category: ${resolvedCategory.allowedTools.join(", ")}.`);
      }
      if (resolvedCategory.deniedTools && resolvedCategory.deniedTools.length > 0) {
        handoffParts.push(`Avoid these tools for this category: ${resolvedCategory.deniedTools.join(", ")}.`);
      }
      const taskId = `delegate-${resolvedCategory.name}-${Date.now()}`;
      let task;
      try {
        task = registerBackgroundTask({
          id: taskId,
          description: `[${resolvedCategory.name}] ${parsedArgs.objective.slice(0, 120)}`,
          owner: "openagent-delegate"
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult2(message, message);
      }
      const result = await routeOpenAgentPhase({
        session,
        config: resolution2.config,
        request: {
          phase: resolvedCategory.suggestedPhase,
          objective: parsedArgs.objective,
          handoff: handoffParts.join(`

`),
          requestedBy: "openagent-delegate",
          syncPlan: true
        }
      });
      return createSuccessResult2([
        `Delegated to category "${resolvedCategory.name}" (${resolvedCategory.displayName}).`,
        `Preferred model: ${resolvedCategory.preferredModel}`,
        `Fallback chain: ${formatModelTargets(resolvedCategory.fallbackModels)}`,
        `Reasoning effort: ${resolvedCategory.reasoningEffort}`,
        `Routed to phase: ${result.phase}`,
        `Selected agent: ${result.agent}`,
        `Mode: ${result.mode}`,
        `Background task ID: ${task.id}`,
        `Handoff note: ${result.handoffWorkspacePath}`
      ].join(`
`), `OpenAgent delegated work to ${resolvedCategory.name} category.`);
    }
  };
  const categoriesListTool = {
    name: "openagent_categories_list",
    description: "List all available task categories with their model preferences, reasoning effort, and suggested phases.",
    skipPermission: true,
    handler: async () => {
      const resolution2 = loadOpenAgentConfig(resolveCwd2(initialCwd));
      return createSuccessResult2(formatCategorySummary(applyCategoryOverrides(resolution2.config.categories)));
    }
  };
  const allTools = [
    runtimeStatusTool,
    bootstrapTaskTool,
    planNoteTool,
    workspaceNoteTool,
    routePhaseTool,
    fleetTool,
    fleetStatusTool,
    fleetCompleteTool,
    planReviewTool,
    doctorTool,
    memoryWriteTool,
    memoryReadTool,
    memoryListTool,
    safeEditTool,
    lspDiagnosticsTool,
    lspGotoDefinitionTool,
    lspFindReferencesTool,
    lspRenameTool,
    astSearchTool,
    astReplaceTool,
    lookAtTool,
    delegateTool,
    categoriesListTool,
    backgroundRegisterTool,
    backgroundUpdateTool,
    backgroundListTool,
    backgroundCancelTool,
    sessionListTool,
    sessionSearchTool,
    sessionGetTool,
    ...createTaskTools({ getSession, initialCwd })
  ];
  const resolution = loadOpenAgentConfig(resolveCwd2(initialCwd));
  const disabledToolSet = new Set(resolution.config.disabledTools);
  return allTools.filter((tool) => !disabledToolSet.has(tool.name));
}

// src/extension.mts
var initialCwd = process.cwd();
var initialResolution = loadOpenAgentConfig(initialCwd);
var sessionRef;
function getSession() {
  if (!sessionRef) {
    throw new Error("OpenAgent session is not ready yet.");
  }
  return sessionRef;
}
var session = await joinSession({
  agent: initialResolution.config.autoSelectAgent ? initialResolution.config.defaultAgent : undefined,
  commands: createCommands({ getSession, initialCwd }),
  customAgents: createCustomAgents(initialResolution.config),
  hooks: createHooks({ initialCwd, getSession }),
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD,
    bufferExhaustionThreshold: OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD
  },
  onPermissionRequest: createPermissionHandler({ initialCwd }),
  onUserInputRequest: async (request) => {
    try {
      const result = await getSession().ui.input(request.question);
      return { answer: result ?? "", wasFreeform: true };
    } catch {
      return { answer: "", wasFreeform: true };
    }
  },
  systemMessage: {
    mode: "append",
    content: buildSystemPrompt(initialResolution.config)
  },
  tools: createTools({ getSession, initialCwd })
});
sessionRef = session;
await initializeOpenAgentAgentState({
  session,
  config: initialResolution.config
});
session.on("session.idle", async (event) => {
  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  if (event.data.aborted) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config
    });
    recordLoopCancel();
    await session.log("OpenAgent noticed that the previous agentic loop was aborted.", { level: "warning", ephemeral: true });
    return;
  }
  const loopState = await readOpenAgentLoopState({
    session,
    config: resolution.config
  });
  if (!loopState) {
    return;
  }
  const messages = await session.getEvents();
  const lastAssistantMessage = [...messages].reverse().find((message) => message.type === "assistant.message");
  const lastContent = lastAssistantMessage && lastAssistantMessage.type === "assistant.message" ? lastAssistantMessage.data.content : "";
  if (lastContent.includes(OPENAGENT_LOOP_DONE_SENTINEL)) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config
    });
    recordLoopComplete();
    await session.log("OpenAgent completed the active continuation loop.", {
      ephemeral: true
    });
    return;
  }
  if (loopState.iterations + 1 >= loopState.maxIterations) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config
    });
    await session.log(`OpenAgent stopped /oa-loop after reaching the ${loopState.maxIterations}-iteration cap.`, { level: "warning", ephemeral: true });
    return;
  }
  const nextIterations = loopState.iterations + 1;
  recordLoopIteration();
  await writeOpenAgentLoopState({
    session,
    config: resolution.config,
    state: {
      ...loopState,
      iterations: nextIterations,
      updatedAt: new Date().toISOString()
    }
  });
  await session.log(`OpenAgent continuing /oa-loop iteration ${nextIterations + 1} of ${loopState.maxIterations}.`, { ephemeral: true });
  await session.send({
    prompt: buildOpenAgentLoopPrompt({
      goal: loopState.goal,
      iterations: nextIterations,
      maxIterations: loopState.maxIterations
    })
  });
});
session.on("session.usage_info", async (event) => {
  const usage = recordOpenAgentUsage({
    tokenLimit: event.data.tokenLimit,
    currentTokens: event.data.currentTokens,
    messagesLength: event.data.messagesLength,
    systemTokens: event.data.systemTokens,
    conversationTokens: event.data.conversationTokens,
    toolDefinitionsTokens: event.data.toolDefinitionsTokens
  });
  if (!event.data.isInitial && usage.ratio >= OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD) {
    await session.log(`OpenAgent observed ${(usage.ratio * 100).toFixed(1)}% context usage and will rely on session compaction checkpoints to stay ahead of overflow.`, { ephemeral: true });
  }
});
session.on("session.compaction_start", async () => {
  noteOpenAgentCompactionStart();
  await session.log("OpenAgent started a preemptive compaction pass.", {
    level: "info"
  });
});
session.on("session.compaction_complete", async (event) => {
  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  const result = await noteOpenAgentCompactionComplete({
    session,
    config: resolution.config,
    ...event.data
  });
  await session.log(result.message, {
    level: event.data.success ? "info" : "warning"
  });
});
session.on("session.error", async (event) => {
  await session.log(`OpenAgent observed a session error: ${event.data.message}`, {
    level: "warning",
    ephemeral: true
  });
});
await session.log(initialResolution.sources.length > 0 ? `OpenAgent harness loaded with config from ${initialResolution.sources.join(", ")}.` : "OpenAgent harness loaded with built-in defaults.", { ephemeral: true });
await session.log(formatOpenAgentCompactionStatus(), { ephemeral: true });
