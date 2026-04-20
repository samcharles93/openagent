import { routeOpenAgentPhase } from "./routing.js";
import { requireOpenAgentWorkspacePath, writeOpenAgentWorkspaceNote } from "./workspace.js";
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function summarizeRequest(request, maxChars = 140) {
    const normalized = normalizeWhitespace(request);
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
function toBullets(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
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
        "1. OpenAgent Planner drafts or refines the implementation plan.",
        "2. OpenAgent Critic challenges the plan for ambiguity, missing dependencies, hidden risks, and weak verification.",
        "3. The plan is revised until the critical objections are resolved explicitly.",
        "4. OpenAgent Reviewer validates that the revised plan satisfies the request and is ready for implementation.",
        "5. Only after those review gates pass does OpenAgent route to the Implementer.",
        "",
        "## Specialist handoff guidance",
        toBullets([
            'Use openagent_route_phase with phase "planner" and agent "openagent-critic" when switching from drafting to critique.',
            'Use openagent_route_phase with phase "reviewer" and agent "openagent-reviewer" when the plan is ready for final pre-implementation review.',
            'Use openagent_route_phase with phase "implementer" only after the critic and reviewer concerns are resolved.',
            'Use openagent_route_phase with agent "openagent-oracle" for a harder read-only architecture consult, or agent "openagent-qa" later when implementation exists and needs hands-on verification.',
        ]),
    ].join("\n");
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
        toBullets([
            "Read the workflow note before writing or revising the plan.",
            "Draft a concrete implementation plan with explicit sequencing, boundaries, and validation.",
            'When the plan is actionable, route to phase "planner" with agent "openagent-critic" for a deliberate critique pass.',
            'After resolving critique findings, route to phase "reviewer" with agent "openagent-reviewer" for a final pre-implementation gate.',
            'Do not route to the implementer until both critique passes are addressed explicitly.',
        ]),
    ].join("\n");
}
export function formatOpenAgentPlanReviewResult(result) {
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
export async function startPlanReviewWorkflow(args) {
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
            agent: "openagent-planner",
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
