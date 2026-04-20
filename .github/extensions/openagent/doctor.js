import { spawnSync } from "node:child_process";
import { resolveBundledAstGrepBinary, resolveBundledCopilotCliPath, } from "./bundled-deps.js";
import { formatConfigSummary } from "./config.js";
import { recordContinuousImprovementArtifact } from "./continuous-improvement.js";
import { formatOpenAgentRoutingStatus, } from "./routing.js";
import { isOpenAgentWorkspaceAvailable, writeOpenAgentWorkspaceNote, } from "./workspace.js";
function checkBinary(name) {
    const result = spawnSync("which", [name], { encoding: "utf8" });
    const resolvedPath = result.status === 0 ? result.stdout.trim() : "";
    return {
        name,
        path: resolvedPath.length > 0 ? resolvedPath : null,
    };
}
function formatBinaryLine(check) {
    return `- ${check.name}: ${check.path ?? "missing"}`;
}
export async function runOpenAgentDoctor(args) {
    const { session, cwd, resolution } = args;
    const shouldWriteReport = args.writeReport !== false;
    const [mode, model, agent, plan, routingStatus] = await Promise.all([
        session.rpc.mode.get(),
        session.rpc.model.getCurrent(),
        session.rpc.agent.getCurrent(),
        session.rpc.plan.read(),
        formatOpenAgentRoutingStatus({
            session,
            config: resolution.config,
        }),
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
        "file",
    ].map(checkBinary);
    const bundledChecks = [
        {
            name: "bundled ast-grep",
            path: resolveBundledAstGrepBinary(),
        },
        {
            name: "bundled copilot cli",
            path: resolveBundledCopilotCliPath(),
        },
    ];
    const missingBinaryNames = binaryChecks
        .filter((check) => {
        if (check.name === "ast-grep") {
            return check.path === null && bundledChecks[0].path === null;
        }
        return check.path === null;
    })
        .map((check) => check.name);
    const report = [
        "# OpenAgent doctor report",
        "",
        `cwd: ${cwd}`,
        `workspace path: ${session.workspacePath ?? "disabled"}`,
        `current mode: ${mode.mode}`,
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
        ...bundledChecks.map(formatBinaryLine),
    ].join("\n");
    let reportWorkspacePath = null;
    if (shouldWriteReport && isOpenAgentWorkspaceAvailable(session)) {
        const note = await writeOpenAgentWorkspaceNote({
            session,
            config: resolution.config,
            relativePath: `doctor/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
            content: report,
            mode: "replace",
        });
        reportWorkspacePath = note.workspaceRelativePath;
    }
    const improvement = await recordContinuousImprovementArtifact({
        cwd,
        source: "doctor",
        title: "Doctor follow-up candidate",
        summary: missingBinaryNames.length > 0
            ? `Doctor found missing local binaries: ${missingBinaryNames.join(", ")}. Promote stable setup guidance if these tools are routinely expected in this repo.`
            : "Doctor completed without missing binary checks. If doctor output reveals recurring config or workflow confusion, promote that guidance into rules or AGENTS.",
        evidence: [
            `Report path: ${reportWorkspacePath ?? "not written to workspace"}`,
            `Current mode: ${mode.mode}`,
            `Current agent: ${agent.agent?.name ?? "host default"}`,
        ],
        recommendations: [
            missingBinaryNames.length > 0
                ? `Decide whether ${missingBinaryNames.join(", ")} should be documented in repo guidance.`
                : "Review whether any config, routing, or environment advice should become durable repo guidance.",
            "Promote repeated setup guidance into `.openagent/rules/*.md` before relying on repeated doctor runs.",
        ],
        session,
        config: resolution.config,
    });
    return {
        report,
        reportWorkspacePath,
        improvementWorkspacePath: improvement.workspaceRelativePath,
        improvementMemoryPath: improvement.memoryRelativePath,
    };
}
