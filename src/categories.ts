import {
  formatModelTargets,
  type OpenAgentModelTarget,
  type OpenAgentReasoningEffort,
} from "./config.js";
import type { OpenAgentPhase } from "./routing.js";

export type OpenAgentCategory = {
  name: string;
  displayName: string;
  description: string;
  preferredModel: string;
  fallbackModels: OpenAgentModelTarget[];
  reasoningEffort: OpenAgentReasoningEffort;
  allowedTools?: string[];
  deniedTools?: string[];
  promptAppend?: string;
  suggestedPhase: OpenAgentPhase;
};

export type OpenAgentCategoryOverride = {
  preferredModel?: string;
  fallbackModel?: string;
  fallbackModels?: OpenAgentModelTarget[];
  reasoningEffort?: OpenAgentReasoningEffort;
  allowedTools?: string[];
  deniedTools?: string[];
  promptAppend?: string;
};

export const DEFAULT_CATEGORIES: OpenAgentCategory[] = [
  {
    name: "deep",
    displayName: "Deep Reasoning",
    description: "Deep reasoning tasks requiring extended thinking",
    preferredModel: "claude-opus-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "orchestrator",
  },
  {
    name: "quick",
    displayName: "Quick Implementation",
    description: "Fast, scoped implementation tasks",
    preferredModel: "gpt-4.1",
    fallbackModels: [{ model: "claude-sonnet-4" }],
    reasoningEffort: "low",
    suggestedPhase: "implementer",
  },
  {
    name: "research",
    displayName: "Research",
    description: "Investigation and codebase exploration",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "medium",
    suggestedPhase: "researcher",
  },
  {
    name: "review",
    displayName: "Code Review",
    description: "Code review and quality assessment",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "reviewer",
  },
  {
    name: "planning",
    displayName: "Planning",
    description: "Architecture and design planning",
    preferredModel: "claude-sonnet-4",
    fallbackModels: [{ model: "gpt-4.1" }],
    reasoningEffort: "high",
    suggestedPhase: "planner",
  },
  {
    name: "writing",
    displayName: "Writing",
    description: "Documentation and content creation",
    preferredModel: "gpt-4.1",
    fallbackModels: [{ model: "claude-sonnet-4" }],
    reasoningEffort: "medium",
    suggestedPhase: "implementer",
  },
];

export function getCategoryByName(name: string): OpenAgentCategory | null {
  return DEFAULT_CATEGORIES.find((c) => c.name === name) ?? null;
}

export function listCategoryNames(): string[] {
  return DEFAULT_CATEGORIES.map((c) => c.name);
}

export function formatCategorySummary(
  categories: OpenAgentCategory[] = DEFAULT_CATEGORIES,
): string {
  const lines = ["Task categories:"];
  for (const cat of categories) {
    lines.push(
      `  ${cat.name} (${cat.displayName}): ${cat.description} [model: ${cat.preferredModel}, fallbacks: ${formatModelTargets(cat.fallbackModels)}, effort: ${cat.reasoningEffort}, phase: ${cat.suggestedPhase}]`,
    );
  }
  return lines.join("\n");
}

export function applyCategoryOverrides(
  overrides: Record<string, OpenAgentCategoryOverride>,
): OpenAgentCategory[] {
  return DEFAULT_CATEGORIES.map((cat) => {
    const override = overrides[cat.name];
    if (!override) {
      return cat;
    }
    return {
      ...cat,
      preferredModel: override.preferredModel ?? cat.preferredModel,
      fallbackModels:
        override.fallbackModels ??
        (override.fallbackModel ? [{ model: override.fallbackModel }] : cat.fallbackModels),
      reasoningEffort: override.reasoningEffort ?? cat.reasoningEffort,
      allowedTools: override.allowedTools ?? cat.allowedTools,
      deniedTools: override.deniedTools ?? cat.deniedTools,
      promptAppend: override.promptAppend ?? cat.promptAppend,
    };
  });
}

const RESEARCH_KEYWORDS = [
  "investigate", "explore", "research", "search", "find", "look up",
  "understand", "trace", "analyze", "dig into", "survey",
];

const REVIEW_KEYWORDS = [
  "review", "audit", "check", "inspect", "assess", "evaluate", "lint",
  "quality", "correctness",
];

const PLANNING_KEYWORDS = [
  "plan", "design", "architect", "blueprint", "outline", "propose",
  "strategy", "roadmap", "scope",
];

const QUICK_KEYWORDS = [
  "quick", "fix", "small", "typo", "rename", "tweak", "patch", "hotfix",
  "minor", "simple", "trivial",
];

const WRITING_KEYWORDS = [
  "document", "docs", "readme", "changelog", "write up", "describe",
  "summarize", "content", "draft", "documentation",
];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

export function inferCategoryFromObjective(objective: string): OpenAgentCategory {
  if (matchesKeywords(objective, RESEARCH_KEYWORDS)) {
    return getCategoryByName("research")!;
  }
  if (matchesKeywords(objective, REVIEW_KEYWORDS)) {
    return getCategoryByName("review")!;
  }
  if (matchesKeywords(objective, PLANNING_KEYWORDS)) {
    return getCategoryByName("planning")!;
  }
  if (matchesKeywords(objective, QUICK_KEYWORDS)) {
    return getCategoryByName("quick")!;
  }
  if (matchesKeywords(objective, WRITING_KEYWORDS)) {
    return getCategoryByName("writing")!;
  }
  return getCategoryByName("deep")!;
}
