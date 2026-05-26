import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { routeOpenAgentPhase, type OpenAgentMode, type OpenAgentRouteResult } from "./routing";
import { requireOpenAgentWorkspacePath, writeOpenAgentWorkspaceNote } from "./workspace";

export type OpenAgentPlanReviewRequest = {
  request: string;
  requestedBy?: string;
  syncPlan?: boolean;
  mode?: OpenAgentMode | "default";
};

export type OpenAgentPlanReviewResult = OpenAgentRouteResult & {
  workflowWorkspacePath: string;
  requestSummary: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeRequest(request: string, maxChars = 140): string {
  const normalized = normalizeWhitespace(request);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function toBullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function buildPlanReviewWorkflowNote(args: {
  timestamp: string;
  requestedBy: string;
  request: string;
  requestSummary: string;
}): string {
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
    toBullets([
      'Route to phase "planner" for plan creation. The planner returns to the orchestrator when done.',
      'Route to phase "planner" with agent "skeptic" for plan review. The critic returns a verdict to the orchestrator — it never routes onward.',
      'Route to phase "implementer" only after the orchestrator is satisfied the plan is executable.',
      'Use agent "oracle" for read-only architecture review, or agent "tester" when implementation exists and needs hands-on verification.',
    ]),
  ].join("\n");
}

function buildPlanReviewHandoff(args: {
  request: string;
  requestedBy: string;
  workflowWorkspacePath: string;
}): string {
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
    toBullets([
      "Read the workflow note before writing or revising the plan.",
      "Draft a concrete implementation plan with explicit sequencing, boundaries, and validation.",
      "When the plan is actionable, return to the orchestrator with the plan summary.",
      "The orchestrator will decide whether to send the plan to the critic or proceed to implementation.",
      "The critic is a dead-end — it returns a verdict to the orchestrator. Only the orchestrator routes to the implementer.",
    ]),
  ].join("\n");
}

export function formatOpenAgentPlanReviewResult(
  result: OpenAgentPlanReviewResult,
): string {
  return [
    `OpenAgent started the plan-review workflow for: ${result.requestSummary}`,
    `Selected phase: ${result.phase}`,
    `Selected agent: ${result.agent}`,
    `Mode: ${result.mode}`,
    `Workflow note: ${result.workflowWorkspacePath}`,
    `Handoff note: ${result.handoffWorkspacePath}`,
    `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`,
  ].join("\n");
}

export async function startPlanReviewWorkflow(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
} & OpenAgentPlanReviewRequest): Promise<OpenAgentPlanReviewResult> {
  const request = args.request.trim();
  if (request.length === 0) {
    throw new Error("OpenAgent plan review requires a non-empty request.");
  }

  requireOpenAgentWorkspacePath(args.session, "OpenAgent plan review");

  const timestamp = new Date().toISOString();
  const requestedBy = args.requestedBy?.trim() || "openagent_plan_review";
  const requestSummary = summarizeRequest(request);
  const slug = timestamp.replace(/[:.]/g, "-");

  const workflowNote = await writeOpenAgentWorkspaceNote({
    session: args.session,
    config: args.config,
    relativePath: `workflows/plan-review/${slug}.md`,
    content: buildPlanReviewWorkflowNote({
      timestamp,
      requestedBy,
      request,
      requestSummary,
    }),
    mode: "replace",
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
        workflowWorkspacePath: workflowNote.workspaceRelativePath,
      }),
      requestedBy,
      syncPlan: args.syncPlan === false ? false : true,
      mode: args.mode,
    },
  });

  return {
    ...routeResult,
    workflowWorkspacePath: workflowNote.workspaceRelativePath,
    requestSummary,
  };
}
