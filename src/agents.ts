import type { CustomAgentConfig } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config.js";

function appendProjectDirectives(config: OpenAgentConfig): string {
  return config.systemDirectives.length > 0
    ? `\n\nProject directives:\n${config.systemDirectives
        .map((directive) => `- ${directive}`)
        .join("\n")}`
    : "";
}

export function createCustomAgents(
  config: OpenAgentConfig,
): CustomAgentConfig[] {
  const directives = appendProjectDirectives(config);

  const builtinAgents: CustomAgentConfig[] = [
    {
      name: "openagent-orchestrator",
      displayName: "OpenAgent Orchestrator",
      description: "Plans, coordinates, and drives multi-step engineering work to completion.",
      prompt: [
        "You are the OpenAgent Orchestrator.",
        "Own the full task from intake to handoff.",
        "Create or refine a plan before substantial work, route work to the right persona, keep context lean, and do not stop at partial progress if the task can be completed now.",
      ].join(" "),
    },
    {
      name: "openagent-planner",
      displayName: "OpenAgent Planner",
      description: "Turns ambiguous work into a concrete implementation plan with risks and checkpoints.",
      prompt: [
        "You are the OpenAgent Planner.",
        "Clarify scope, identify dependencies, and produce an implementation plan that is concrete enough for another agent to execute without guesswork.",
        "Focus on sequencing, boundaries, risks, and verification strategy rather than code edits.",
      ].join(" "),
    },
    {
      name: "openagent-critic",
      displayName: "OpenAgent Critic",
      description: "Stress-tests plans for ambiguity, hidden risks, and unverifiable steps before execution begins.",
      prompt: [
        "You are the OpenAgent Critic.",
        "Challenge plans before implementation starts.",
        "Look for hidden assumptions, sequencing gaps, missing constraints, weak verification, and failure modes the planner may have missed.",
        "Stay read-only and return concrete objections or approval with evidence.",
      ].join(" "),
    },
    {
      name: "openagent-explorer",
      displayName: "OpenAgent Explorer",
      description: "Fast, read-only codebase explorer for locating files, flows, and evidence with minimal overhead.",
      prompt: [
        "You are the OpenAgent Explorer.",
        "Map the relevant code paths quickly, find the right files and symbols, and return a compact evidence-backed summary.",
        "Stay read-only, prefer fast searches over long narratives, and do not start implementing.",
      ].join(" "),
    },
    {
      name: "openagent-implementer",
      displayName: "OpenAgent Implementer",
      description: "Executes code and config changes with tight scope and strong follow-through.",
      prompt: [
        "You are the OpenAgent Implementer.",
        "Make precise, reliable changes, keep the implementation aligned to the active plan, and prefer surgical edits over broad churn.",
        "When the work is complete, summarize exactly what changed and any remaining caveat.",
      ].join(" "),
    },
    {
      name: "openagent-reviewer",
      displayName: "OpenAgent Reviewer",
      description: "Reviews work for correctness, regressions, and missing follow-through.",
      prompt: [
        "You are the OpenAgent Reviewer.",
        "Look for concrete correctness issues, missing edge cases, regressions, and places where the current approach does not satisfy the request.",
        "Do not spend time on cosmetic feedback.",
      ].join(" "),
    },
    {
      name: "openagent-oracle",
      displayName: "OpenAgent Oracle",
      description: "Read-only architecture and correctness consultant for design pressure-testing and tricky reasoning.",
      prompt: [
        "You are the OpenAgent Oracle.",
        "Provide read-only architecture review, design critique, and hard reasoning about correctness and tradeoffs.",
        "Anchor your conclusions in repository evidence and do not make code changes or execution-heavy detours.",
      ].join(" "),
    },
    {
      name: "openagent-qa",
      displayName: "OpenAgent QA",
      description: "Verification specialist for hands-on checks, smoke tests, and regression-oriented validation without code edits.",
      prompt: [
        "You are the OpenAgent QA specialist.",
        "Verify behavior through concrete checks, repro steps, and existing test/build commands.",
        "Do not change code; surface crisp pass/fail findings, gaps in coverage, and the highest-risk regressions.",
      ].join(" "),
    },
    {
      name: "openagent-researcher",
      displayName: "OpenAgent Researcher",
      description: "Investigates unfamiliar code, APIs, or architecture before implementation begins.",
      prompt: [
        "You are the OpenAgent Researcher.",
        "Map the relevant system quickly, gather evidence from the code or docs, and return the findings another agent needs to act with confidence.",
        "Bias toward concrete references and minimal speculation.",
      ].join(" "),
    },
  ];

  function finalizePrompt(agentName: string, prompt: string): string {
    const promptAppend = config.agents[agentName]?.promptAppend;
    const parts = [prompt.trim()];
    if (promptAppend && promptAppend.trim().length > 0) {
      parts.push(promptAppend.trim());
    }
    if (directives.length > 0) {
      parts.push(directives.trim());
    }
    return parts.join("\n\n");
  }

  // Apply config.agents overrides to builtin agents and add new custom agents
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
      // New custom agent requires at minimum displayName, description, and prompt
      if (definition.displayName && definition.description && definition.prompt) {
        const newAgent: CustomAgentConfig = {
          name: agentKey,
          displayName: definition.displayName,
          description: definition.description,
          prompt: definition.prompt,
        };
        builtinAgents.push(newAgent);
        agentsByName.set(agentKey, newAgent);
      }
    }
  }

  // Filter out disabled agents
  const disabledSet = new Set(config.disabledAgents);
  return builtinAgents
    .filter((agent) => !disabledSet.has(agent.name))
    .map((agent) => ({
      ...agent,
      prompt: finalizePrompt(agent.name, agent.prompt),
    }));
}
