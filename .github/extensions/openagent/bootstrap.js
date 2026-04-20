import { computeBootstrapConfidence, } from "./bootstrap-confidence.js";
import { appendBootstrapHistory, readBootstrapHistory, } from "./bootstrap-history.js";
import { updateSessionPlan } from "./plan.js";
import { looksComplexPrompt } from "./prompt.js";
import { routeOpenAgentPhase, } from "./routing.js";
import { requireOpenAgentWorkspacePath } from "./workspace.js";
export const OPENAGENT_BOOTSTRAP_PHASES = [
    "planner",
    "researcher",
    "implementer",
];
const RESEARCH_KEYWORDS = [
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
    "why",
];
const IMPLEMENTATION_KEYWORDS = [
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
    "wire",
];
const EXPLICIT_SCOPE_PATTERN = /`[^`]+`|\/oa-[a-z0-9-]+|openagent_[a-z0-9_]+|\b[a-z0-9._-]+\.(?:ts|mts|js|json|md)\b|(?:^|\s)(?:src|files|\.github)[\\/]/i;
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
function toBullets(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
}
function toNumberedList(lines) {
    return lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
}
function toBlockquote(value) {
    return value
        .trim()
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n");
}
function includesAnyKeyword(normalizedRequest, keywords) {
    return keywords.some((keyword) => new RegExp(`(?:^|\\b)${escapeRegExp(keyword)}(?:\\b|$)`, "i").test(normalizedRequest));
}
function isTightlyScopedImplementerTask(request, normalizedRequest) {
    const lineCount = request.trim().split(/\r?\n/).length;
    const shortEnough = normalizeWhitespace(request).length <= 140;
    const hasExplicitScope = EXPLICIT_SCOPE_PATTERN.test(request);
    const hasImplementationVerb = includesAnyKeyword(normalizedRequest, IMPLEMENTATION_KEYWORDS);
    return (lineCount === 1 &&
        shortEnough &&
        hasExplicitScope &&
        hasImplementationVerb);
}
export function isOpenAgentBootstrapPhase(value) {
    return OPENAGENT_BOOTSTRAP_PHASES.includes(value);
}
export function listOpenAgentBootstrapPhases() {
    return OPENAGENT_BOOTSTRAP_PHASES.join(", ");
}
export function classifyBootstrapPhase(request, config) {
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
                isExplicitOverride: false,
            }),
        };
    }
    if (isTightlyScopedImplementerTask(request, normalizedRequest)) {
        return {
            phase: "implementer",
            reason: "The request is already tightly scoped to an explicit target, so OpenAgent can start in implementation without a separate planning pass.",
            confidence: computeBootstrapConfidence({
                keywordMatchCount: implementKeywordCount,
                hasExplicitScope,
                isShortSingleLine,
                hasImplementationVerb,
                looksComplex,
                isExplicitOverride: false,
            }),
        };
    }
    return {
        phase: "planner",
        reason: looksComplex
            ? "The request looks multi-step, so OpenAgent should bootstrap it with an explicit plan before heavier execution."
            : "OpenAgent plans by default unless the request clearly calls for research or a tightly scoped implementation pass.",
        confidence: computeBootstrapConfidence({
            keywordMatchCount: researchKeywordCount + implementKeywordCount,
            hasExplicitScope,
            isShortSingleLine,
            hasImplementationVerb,
            looksComplex,
            isExplicitOverride: false,
        }),
    };
}
function buildBootstrapObjective(phase, requestSummary) {
    switch (phase) {
        case "researcher":
            return `Investigate the request and return grounded findings: ${requestSummary}`;
        case "implementer":
            return `Execute the scoped request end-to-end: ${requestSummary}`;
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
                "Capture follow-up notes or risks that should survive later turns.",
            ];
        case "implementer":
            return [
                "Inspect the immediate target files and reuse existing helpers or patterns.",
                "Make the scoped change with minimal churn and keep the flow coherent.",
                "Validate the change with the existing build and typecheck commands.",
                "Record durable follow-up notes for the next iteration.",
            ];
        default:
            return [
                "Inspect the current codebase and constraints before committing to an approach.",
                "Break the work into concrete implementation tasks and dependencies.",
                "Route or continue into implementation only after the plan is actionable.",
                "Validate the final result and capture durable follow-up notes.",
            ];
    }
}
export function buildInitialPlan(args) {
    const timestamp = args.timestamp ?? new Date().toISOString();
    const requestSummary = summarizeRequest(args.request);
    const lines = [];
    if (args.includeTitle) {
        lines.push("# OpenAgent plan", "");
    }
    lines.push(`## OpenAgent bootstrap ${timestamp}`, `- requested by: ${args.requestedBy}`, `- request summary: ${requestSummary}`, `- selected phase: ${args.phase}`, `- phase rationale: ${args.phaseReason}`, `- classification confidence: ${args.confidence.score.toFixed(2)}`, `- confidence factors: ${args.confidence.factors.join("; ")}`, "", "### Raw request", toBlockquote(args.request), "", "### Initial approach", toNumberedList(buildPhaseApproach(args.phase)), "", "### Notes", toBullets([
        "Use openagent_route_phase for later phase changes so the handoff stays durable.",
        "Persist reusable artifacts under files/openagent/ when they will help later turns.",
    ]));
    return lines.join("\n");
}
export function buildBootstrapHandoff(args) {
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
        toBullets(buildPhaseApproach(args.phase)),
        "",
        "## Coordination notes",
        toBullets([
            "Keep the session plan current as the work becomes more concrete.",
            "Route again with openagent_route_phase whenever the active phase should change.",
            "Persist durable follow-up artifacts under files/openagent/ when they will help future turns.",
        ]),
    ].join("\n");
}
export function formatOpenAgentBootstrapResult(result) {
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
        `Route synced into plan: ${result.planUpdated ? "yes" : "no"}`,
    ].join("\n");
}
export async function bootstrapOpenAgentTask(args) {
    const request = args.request.trim();
    if (request.length === 0) {
        throw new Error("OpenAgent bootstrap requires a non-empty request.");
    }
    requireOpenAgentWorkspacePath(args.session, "OpenAgent bootstrap");
    const requestedBy = args.requestedBy?.trim() || "openagent_bootstrap_task";
    const isExplicitOverride = Boolean(args.phase && args.phase !== "auto");
    const selection = isExplicitOverride && args.phase !== "auto"
        ? {
            phase: args.phase,
            reason: `The caller explicitly selected the ${args.phase} phase for bootstrap.`,
            confidence: computeBootstrapConfidence({
                keywordMatchCount: 0,
                hasExplicitScope: false,
                isShortSingleLine: false,
                hasImplementationVerb: false,
                looksComplex: false,
                isExplicitOverride: true,
            }),
        }
        : classifyBootstrapPhase(request, args.config);
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
            includeTitle: !hasPlanContent,
        }),
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
                phaseReason: selection.reason,
            }),
            requestedBy,
            syncPlan: args.syncPlan === false ? false : true,
            mode: args.mode,
            bootstrapContext: {
                lastBootstrapPhase: selection.phase,
                lastBootstrapConfidence: selection.confidence.score,
                lastBootstrapReason: selection.reason,
                totalBootstraps,
            },
        },
    });
    const historyEntry = {
        timestamp: new Date().toISOString(),
        requestSummary: summarizeRequest(request),
        selectedPhase: selection.phase,
        phaseReason: selection.reason,
        confidence: selection.confidence,
        requestedBy,
        explicitOverride: isExplicitOverride,
    };
    await appendBootstrapHistory(args.session, args.config, historyEntry);
    return {
        ...routeResult,
        planPath: plan.path,
        planWriteMode: plan.mode,
        requestSummary: summarizeRequest(request),
        phaseReason: selection.reason,
        confidence: selection.confidence,
    };
}
