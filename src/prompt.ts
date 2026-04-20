import type { OpenAgentConfig, OpenAgentConfigResolution } from "./config.js";

type PromptContextOptions = {
  forcePlan: boolean;
};

function toBullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

export function buildSystemPrompt(config: OpenAgentConfig): string {
  const corePrinciples = [
    "Act like an orchestration-first engineering harness instead of a generic chat assistant.",
    "For multi-step work, create or refine a plan before editing or executing long workflows.",
    "Use tools and repository evidence to drive decisions instead of guessing.",
    "Keep context lean by storing durable artifacts in the session workspace when they will help later turns.",
    "Conclude with a crisp outcome statement that names the meaningful result and any remaining risk.",
  ];

  const harnessCapabilities = [
    "Use openagent_runtime_status to inspect the harness runtime, active mode, selected model, and session workspace.",
    "Use openagent_bootstrap_task to turn a raw request into an initial plan, selected phase, and durable handoff in one step.",
    "Use openagent_plan_note to create or update session plan content when the work spans multiple steps.",
    `Use openagent_workspace_note to persist reusable notes and artifacts under files/${config.workspace.notesDirectory}/.`,
    "Use openagent_memory_write/openagent_memory_read/openagent_memory_list to persist durable repo-scoped memories across sessions when conventions or follow-up notes should survive.",
    "Promote stable repo-wide lessons into `.openagent/rules/*.md`, and move early runtime-facing guidance into `AGENTS.md` when future sessions should see it immediately.",
    "Use openagent_route_phase when you intentionally move work between planner, researcher, implementer, reviewer, or orchestrator phases, including specialist agent variants inside those phases.",
    "Use the OpenAgent custom agents when a planner, critic, explorer, implementer, reviewer, oracle, QA, or researcher mindset would improve the result.",
  ];

  return [
    "You are OpenAgent, a Copilot CLI extension harness for disciplined software delivery.",
    "",
    "Core operating principles:",
    toBullets(corePrinciples),
    "",
    "Harness capabilities:",
    toBullets(harnessCapabilities),
    "",
    "Project directives:",
    toBullets(config.systemDirectives),
  ].join("\n");
}

export function buildPromptContext(
  resolution: OpenAgentConfigResolution,
  options: PromptContextOptions,
): string {
  const lines = [
    `OpenAgent is active for ${resolution.cwd}.`,
    options.forcePlan
      ? "This request looks multi-step. Prefer openagent_bootstrap_task or /oa-start to initialize the plan, route, and handoff before heavy implementation."
      : "If the task expands beyond a quick change, use openagent_bootstrap_task or /oa-start before proceeding so the plan and route stay explicit.",
    `Persist durable notes in files/${resolution.config.workspace.notesDirectory}/ when they will help future turns.`,
    "Use repo memory for recurring repo-specific notes, and promote stable repeated lessons into `.openagent/rules/` or `AGENTS.md` instead of leaving them in one-off outputs.",
    "When changing phases, use openagent_route_phase so the handoff is durable and the correct agent is selected.",
    "Prefer using the OpenAgent planner, critic, explorer, implementer, reviewer, oracle, QA, or researcher personas when they improve quality or keep context lean.",
  ];

  if (resolution.config.systemDirectives.length > 0) {
    lines.push(
      `Project directives: ${resolution.config.systemDirectives.join(" | ")}`,
    );
  }

  return lines.join("\n");
}

export function looksComplexPrompt(
  prompt: string,
  config: OpenAgentConfig,
): boolean {
  const normalized = prompt.trim().toLowerCase();

  if (normalized.length >= 180) {
    return true;
  }

  if (normalized.split(/\r?\n/).length >= 3) {
    return true;
  }

  return config.planningKeywords.some((keyword) =>
    normalized.includes(keyword.toLowerCase()),
  );
}

export function isUltraworkPrompt(
  prompt: string,
  config: OpenAgentConfig,
): boolean {
  const normalized = prompt.trim().toLowerCase();
  return config.ultraworkAliases.some((alias) => alias.toLowerCase() === normalized);
}

export function expandUltraworkPrompt(): string {
  return [
    "Start by using openagent_bootstrap_task when the request still needs an initial plan and phase selection.",
    "Plan the work, execute it end-to-end, and keep going until the task is actually complete.",
    "Use the most appropriate OpenAgent persona for each phase, keep the plan current, and store durable notes in the session workspace when they help.",
    "Finish with a concise handoff that states the result and any remaining risk or follow-up.",
  ].join(" ");
}
