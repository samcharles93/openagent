import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { recordContinuousImprovementArtifact } from "./continuous-improvement";
import { routeOpenAgentPhase, type OpenAgentMode, type OpenAgentRouteResult } from "./routing";
import { requireOpenAgentWorkspacePath, writeOpenAgentWorkspaceNote } from "./workspace";

export type OpenAgentReviewWorkflowRequest = {
  scope: string;
  requestedBy?: string;
  syncPlan?: boolean;
  mode?: OpenAgentMode | "default";
};

export type OpenAgentReviewWorkflowResult = OpenAgentRouteResult & {
  workflowWorkspacePath: string;
  improvementWorkspacePath: string | null;
  improvementMemoryPath: string;
  scopeSummary: string;
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function summarizeScope(scope: string, maxChars = 140): string {
  const normalized = normalizeWhitespace(scope);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

function toBullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function buildReviewWorkflowNote(args: {
  timestamp: string;
  requestedBy: string;
  scope: string;
  scopeSummary: string;
}): string {
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
    toBullets([
      "Launch the four review lanes and merge their outputs into one verdict.",
      "Each lane must return only concrete findings with file evidence, not style feedback.",
      'The final merged verdict should say "pass" only if every lane passes with no blocking issue.',
      "If any lane finds a blocking issue, the final verdict is fail and must name the blocking lane first.",
    ]),
  ].join("\n");
}

function buildReviewHandoff(args: {
  scope: string;
  requestedBy: string;
  workflowWorkspacePath: string;
}): string {
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
    toBullets([
      "Read the workflow note first.",
      "Route to each review lane in sequence and collect their outputs.",
      "Reviewer and oracle lanes are read-only — they inspect code and design. QA must execute the app and run tests.",
      "Merge the lane outputs into one concise verdict that names blockers first and passes only if every lane passes.",
      "Do not spend time on cosmetic feedback; focus on correctness, regressions, risky assumptions, and missing verification.",
      "After the verdict, return to the orchestrator with the merged results.",
    ]),
  ].join("\n");
}

export function formatOpenAgentReviewWorkflowResult(
  result: OpenAgentReviewWorkflowResult,
): string {
  return [
    `OpenAgent started the parallel review workflow for: ${result.scopeSummary}`,
    `Selected phase: ${result.phase}`,
    `Selected agent: ${result.agent}`,
    `Mode: ${result.mode}`,
    `Workflow note: ${result.workflowWorkspacePath}`,
    `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
    `Improvement memory: ${result.improvementMemoryPath}`,
    `Handoff note: ${result.handoffWorkspacePath}`,
    `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`,
  ].join("\n");
}

export async function startOpenAgentReviewWorkflow(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
} & OpenAgentReviewWorkflowRequest): Promise<OpenAgentReviewWorkflowResult> {
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
      scopeSummary,
    }),
    mode: "replace",
  });

  const improvement = await recordContinuousImprovementArtifact({
    cwd: process.cwd(),
    source: "review-workflow",
    title: "Review follow-up candidate",
    summary:
      `Parallel review workflow started for "${scopeSummary}". When the merged verdict is available, promote repeated findings into rules, AGENTS, repo memory, or follow-up tasks.`,
    evidence: [`Workflow note: ${workflowNote.workspaceRelativePath}`],
    recommendations: [
      "If the verdict reveals a stable engineering rule, update `.openagent/rules/*.md`.",
      "If the verdict changes runtime-facing workflow guidance, update `AGENTS.md`.",
      "If the finding is recurring but not yet stable, persist or update repo-scoped memory.",
    ],
    session: args.session,
    config: args.config,
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
    improvementWorkspacePath: improvement.workspaceRelativePath,
    improvementMemoryPath: improvement.memoryRelativePath,
    scopeSummary,
  };
}
