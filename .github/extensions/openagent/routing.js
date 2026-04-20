import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { selectOpenAgentAgent } from "./agent-selection.js";
import { isOpenAgentAgentName } from "./config.js";
import { updateSessionPlan } from "./plan.js";
import { getOpenAgentWorkspacePaths, requireOpenAgentWorkspacePath, writeOpenAgentWorkspaceNote, } from "./workspace.js";
export const OPENAGENT_PHASES = [
    "orchestrator",
    "planner",
    "researcher",
    "implementer",
    "reviewer",
];
const PHASE_DEFINITIONS = {
    orchestrator: {
        agent: "openagent-orchestrator",
        agents: ["openagent-orchestrator"],
        mode: "interactive",
        description: "Coordinate the full task, choose the next phase, and keep the overall plan coherent.",
    },
    planner: {
        agent: "openagent-planner",
        agents: ["openagent-planner", "openagent-critic"],
        mode: "plan",
        description: "Clarify scope, sequence the work, and produce an implementation-ready plan.",
    },
    researcher: {
        agent: "openagent-researcher",
        agents: ["openagent-researcher", "openagent-explorer"],
        mode: "interactive",
        description: "Investigate unfamiliar code or APIs and return grounded findings.",
    },
    implementer: {
        agent: "openagent-implementer",
        agents: ["openagent-implementer"],
        mode: "autopilot",
        description: "Execute the planned change and carry the implementation through to completion.",
    },
    reviewer: {
        agent: "openagent-reviewer",
        agents: ["openagent-reviewer", "openagent-oracle", "openagent-qa"],
        mode: "interactive",
        description: "Review the work for correctness, regressions, and missing follow-through.",
    },
};
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isOpenAgentMode(value) {
    return value === "interactive" || value === "plan" || value === "autopilot";
}
export function isOpenAgentPhase(value) {
    return OPENAGENT_PHASES.includes(value);
}
export function listOpenAgentPhases() {
    return OPENAGENT_PHASES.join(", ");
}
function inferAgentName(rawAgentName) {
    if (rawAgentName && isOpenAgentAgentName(rawAgentName)) {
        return rawAgentName;
    }
    return PHASE_DEFINITIONS.orchestrator.agent;
}
export function inferOpenAgentPhase(rawAgentName) {
    const agentName = inferAgentName(rawAgentName);
    switch (agentName) {
        case "openagent-planner":
        case "openagent-critic":
            return "planner";
        case "openagent-researcher":
        case "openagent-explorer":
            return "researcher";
        case "openagent-implementer":
            return "implementer";
        case "openagent-reviewer":
        case "openagent-oracle":
        case "openagent-qa":
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
        if (!isRecord(entry)) {
            return false;
        }
        return (typeof entry.timestamp === "string" &&
            typeof entry.objective === "string" &&
            typeof entry.handoffPath === "string" &&
            typeof entry.requestedBy === "string" &&
            typeof entry.fromAgent === "string" &&
            isOpenAgentAgentName(entry.fromAgent) &&
            typeof entry.toAgent === "string" &&
            isOpenAgentAgentName(entry.toAgent) &&
            typeof entry.fromPhase === "string" &&
            isOpenAgentPhase(entry.fromPhase) &&
            typeof entry.toPhase === "string" &&
            isOpenAgentPhase(entry.toPhase) &&
            isOpenAgentMode(entry.fromMode) &&
            isOpenAgentMode(entry.toMode));
    });
}
function sanitizeBootstrapContext(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.lastBootstrapPhase !== "string" ||
        typeof value.lastBootstrapConfidence !== "number" ||
        typeof value.lastBootstrapReason !== "string" ||
        typeof value.totalBootstraps !== "number") {
        return null;
    }
    return {
        lastBootstrapPhase: value.lastBootstrapPhase,
        lastBootstrapConfidence: value.lastBootstrapConfidence,
        lastBootstrapReason: value.lastBootstrapReason,
        totalBootstraps: value.totalBootstraps,
    };
}
function sanitizeRouteState(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.currentPhase !== "string" ||
        !isOpenAgentPhase(value.currentPhase) ||
        typeof value.currentAgent !== "string" ||
        !isOpenAgentAgentName(value.currentAgent) ||
        !isOpenAgentMode(value.currentMode) ||
        typeof value.updatedAt !== "string") {
        return null;
    }
    return {
        currentPhase: value.currentPhase,
        currentAgent: value.currentAgent,
        currentMode: value.currentMode,
        latestHandoffPath: typeof value.latestHandoffPath === "string" ? value.latestHandoffPath : null,
        updatedAt: value.updatedAt,
        transitions: sanitizeTransitions(value.transitions),
        bootstrapContext: sanitizeBootstrapContext(value.bootstrapContext),
    };
}
export async function readOpenAgentRouteState(args) {
    const { session, config } = args;
    if (!session.workspacePath) {
        return null;
    }
    const { routeStateFile } = getOpenAgentWorkspacePaths({ session, config });
    if (!existsSync(routeStateFile)) {
        return null;
    }
    try {
        const content = await readFile(routeStateFile, "utf8");
        const parsed = JSON.parse(content);
        return sanitizeRouteState(parsed);
    }
    catch {
        return null;
    }
}
async function writeOpenAgentRouteState(args) {
    const { session, config, state } = args;
    const paths = getOpenAgentWorkspacePaths({ session, config });
    await mkdir(paths.routingRoot, { recursive: true });
    await writeFile(paths.routeStateFile, JSON.stringify(state, null, 2), "utf8");
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
        `- handoff note: ${handoffWorkspacePath}`,
    ].join("\n");
    await updateSessionPlan({
        session,
        content: section,
        mode: "append",
    });
    return true;
}
export async function routeOpenAgentPhase(args) {
    const { session, config, request } = args;
    requireOpenAgentWorkspacePath(session, "OpenAgent routing");
    const timestamp = new Date().toISOString();
    const existingState = await readOpenAgentRouteState({ session, config });
    const [currentAgentResult, currentModeResult] = await Promise.all([
        session.rpc.agent.getCurrent(),
        session.rpc.mode.get(),
    ]);
    const fromAgent = inferAgentName(currentAgentResult.agent?.name);
    const fromPhase = existingState?.currentPhase ?? inferOpenAgentPhase(currentAgentResult.agent?.name);
    const fromMode = isOpenAgentMode(currentModeResult.mode)
        ? currentModeResult.mode
        : PHASE_DEFINITIONS[fromPhase].mode;
    const targetDefinition = PHASE_DEFINITIONS[request.phase];
    const targetAgent = resolveTargetAgent(request.phase, request.agent);
    const targetMode = request.mode && request.mode !== "default"
        ? request.mode
        : targetDefinition.mode;
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
        request.handoff.trim(),
    ].join("\n");
    const note = await writeOpenAgentWorkspaceNote({
        session,
        config,
        relativePath: `routing/handoffs/${slug}-${request.phase}.md`,
        content: handoffContent,
        mode: "replace",
    });
    const planUpdated = await syncPlanForRoute({
        session,
        request,
        fromPhase,
        handoffWorkspacePath: note.workspaceRelativePath,
        targetAgent,
        targetMode,
    });
    const agentResult = await selectOpenAgentAgent({
        session,
        agentName: targetAgent,
        config,
    });
    if (targetMode !== currentModeResult.mode) {
        await session.rpc.mode.set({ mode: targetMode });
    }
    const nextState = {
        currentPhase: request.phase,
        currentAgent: inferAgentName(agentResult.agent.name),
        currentMode: targetMode,
        latestHandoffPath: note.workspaceRelativePath,
        updatedAt: timestamp,
        transitions: [
            ...(existingState?.transitions ?? []),
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
                requestedBy,
            },
        ].slice(-25),
        bootstrapContext: request.bootstrapContext ?? existingState?.bootstrapContext ?? null,
    };
    await writeOpenAgentRouteState({ session, config, state: nextState });
    return {
        phase: request.phase,
        agent: nextState.currentAgent,
        mode: nextState.currentMode,
        handoffWorkspacePath: note.workspaceRelativePath,
        planUpdated,
        previousPhase: fromPhase,
    };
}
export async function formatOpenAgentRoutingStatus(args) {
    const { session, config } = args;
    const [currentAgentResult, currentModeResult, state] = await Promise.all([
        session.rpc.agent.getCurrent(),
        session.rpc.mode.get(),
        readOpenAgentRouteState({ session, config }),
    ]);
    const currentPhase = state?.currentPhase ?? inferOpenAgentPhase(currentAgentResult.agent?.name);
    const currentAgent = inferAgentName(currentAgentResult.agent?.name);
    const currentMode = isOpenAgentMode(currentModeResult.mode)
        ? currentModeResult.mode
        : PHASE_DEFINITIONS[currentPhase].mode;
    const lines = [
        "OpenAgent routing",
        `phase: ${currentPhase}`,
        `phase description: ${PHASE_DEFINITIONS[currentPhase].description}`,
        `phase agent: ${currentAgent}`,
        `phase mode: ${currentMode}`,
        `latest handoff: ${state?.latestHandoffPath ?? "none"}`,
        `recorded transitions: ${state?.transitions.length ?? 0}`,
    ];
    if (state?.bootstrapContext) {
        const ctx = state.bootstrapContext;
        lines.push(`bootstrap-originated phase: ${ctx.lastBootstrapPhase}`, `bootstrap confidence: ${ctx.lastBootstrapConfidence.toFixed(2)}`, `bootstrap reason: ${ctx.lastBootstrapReason}`, `total bootstraps in route: ${ctx.totalBootstraps}`);
    }
    return lines.join("\n");
}
