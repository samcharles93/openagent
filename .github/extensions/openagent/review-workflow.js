import { recordContinuousImprovementArtifact } from "./continuous-improvement.js";
import { routeOpenAgentPhase } from "./routing.js";
import { requireOpenAgentWorkspacePath, writeOpenAgentWorkspaceNote } from "./workspace.js";
function normalizeWhitespace(value) {
    return value.replace(/\s+/g, " ").trim();
}
function summarizeScope(scope, maxChars = 140) {
    const normalized = normalizeWhitespace(scope);
    if (normalized.length <= maxChars) {
        return normalized;
    }
    return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}
function toBullets(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
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
        "Launch exactly four background review threads in parallel and merge them into one verdict.",
        "",
        "1. Correctness review — use openagent-reviewer.",
        "2. Regression review — use openagent-reviewer and focus on behavior drift and edge-case breakage.",
        "3. Architecture/security review — use openagent-oracle in read-only mode for deeper reasoning about unsafe assumptions and risky changes.",
        "4. QA/test review — use openagent-qa to inspect existing tests, smoke checks, and validation gaps.",
        "",
        "## Merge rules",
        toBullets([
            "Use background task fan-out so the four review threads run in parallel when tooling permits.",
            "Each thread must return only concrete findings with file evidence, not style feedback.",
            "Produce a merged verdict grouped by lane: correctness, regressions, architecture/security, QA.",
            'The final merged verdict should say "pass" only if every lane passes with no blocking issue.',
            "If any lane finds a blocking issue, the final verdict is fail and must name the blocking lane first.",
        ]),
    ].join("\n");
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
        toBullets([
            "Read the workflow note first.",
            'Use the task tool with mode "background" to launch four review lanes in parallel when available.',
            "Assign the lanes exactly as described in the workflow note and keep them read-only.",
            "Merge the lane outputs into one concise verdict that names blockers first and passes only if every lane passes.",
            "Do not spend time on cosmetic feedback; focus on correctness, regressions, risky assumptions, and missing verification.",
            "After the verdict, promote repeated findings into `.openagent/rules/*.md`, `AGENTS.md`, repo memory, or follow-up tasks.",
        ]),
    ].join("\n");
}
export function formatOpenAgentReviewWorkflowResult(result) {
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
export async function startOpenAgentReviewWorkflow(args) {
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
        summary: `Parallel review workflow started for "${scopeSummary}". When the merged verdict is available, promote repeated findings into rules, AGENTS, repo memory, or follow-up tasks.`,
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
            phase: "reviewer",
            agent: "openagent-reviewer",
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
