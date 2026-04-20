import { recordCompactionComplete, recordCompactionStart, recordUsageInfo, } from "./telemetry.js";
import { writeOpenAgentWorkspaceNote } from "./workspace.js";
export const OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD = 0.7;
export const OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD = 0.9;
const compactionState = {
    lastUsage: null,
    inProgress: false,
    lastCompactedAt: null,
    lastCheckpointPath: null,
    lastWorkspaceNotePath: null,
    lastSummaryPreview: null,
    lastResult: null,
};
function truncateSummary(value, maxChars = 240) {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
function toPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
}
export function recordOpenAgentUsage(args) {
    const snapshot = {
        tokenLimit: args.tokenLimit,
        currentTokens: args.currentTokens,
        messagesLength: args.messagesLength,
        ratio: args.tokenLimit > 0 ? args.currentTokens / args.tokenLimit : 0,
        systemTokens: args.systemTokens,
        conversationTokens: args.conversationTokens,
        toolDefinitionsTokens: args.toolDefinitionsTokens,
        updatedAt: new Date().toISOString(),
    };
    compactionState.lastUsage = snapshot;
    recordUsageInfo(args.currentTokens, args.tokenLimit);
    return snapshot;
}
export function noteOpenAgentCompactionStart() {
    compactionState.inProgress = true;
    recordCompactionStart();
}
export async function noteOpenAgentCompactionComplete(args) {
    compactionState.inProgress = false;
    compactionState.lastCompactedAt = new Date().toISOString();
    compactionState.lastCheckpointPath = args.checkpointPath ?? null;
    compactionState.lastSummaryPreview = args.summaryContent
        ? truncateSummary(args.summaryContent)
        : null;
    compactionState.lastResult = args.success ? "success" : "failure";
    if (typeof args.postCompactionTokens === "number" &&
        compactionState.lastUsage?.tokenLimit) {
        recordUsageInfo(args.postCompactionTokens, compactionState.lastUsage.tokenLimit);
    }
    recordCompactionComplete(args.success);
    const usage = compactionState.lastUsage;
    const noteContent = [
        "# OpenAgent compaction checkpoint",
        "",
        `Completed at: ${compactionState.lastCompactedAt}`,
        `Result: ${args.success ? "success" : "failure"}`,
        usage
            ? `Latest observed usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit} tokens, ${usage.messagesLength} messages)`
            : "Latest observed usage: unknown",
        `Pre-compaction tokens: ${args.preCompactionTokens ?? "unknown"}`,
        `Post-compaction tokens: ${args.postCompactionTokens ?? "unknown"}`,
        `Messages removed: ${args.messagesRemoved ?? "unknown"}`,
        `Tokens removed: ${args.tokensRemoved ?? "unknown"}`,
        `Checkpoint number: ${args.checkpointNumber ?? "unknown"}`,
        `Checkpoint path: ${args.checkpointPath ?? "unknown"}`,
        "",
        "## Summary",
        args.summaryContent?.trim() || (args.success ? "No compaction summary returned." : "Compaction failed before a summary was produced."),
        ...(args.error
            ? ["", "## Error", args.error]
            : []),
    ].join("\n");
    try {
        const note = await writeOpenAgentWorkspaceNote({
            session: args.session,
            config: args.config,
            relativePath: `compaction/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
            content: noteContent,
            mode: "replace",
        });
        compactionState.lastWorkspaceNotePath = note.workspaceRelativePath;
    }
    catch {
        compactionState.lastWorkspaceNotePath = null;
    }
    return {
        workspaceNotePath: compactionState.lastWorkspaceNotePath,
        message: args.success
            ? `OpenAgent compaction completed${compactionState.lastWorkspaceNotePath ? ` and saved ${compactionState.lastWorkspaceNotePath}` : ""}.`
            : `OpenAgent compaction failed${args.error ? `: ${args.error}` : "."}`,
    };
}
export function getOpenAgentCompactionState() {
    return {
        ...compactionState,
        lastUsage: compactionState.lastUsage ? { ...compactionState.lastUsage } : null,
    };
}
export function formatOpenAgentCompactionStatus() {
    const usage = compactionState.lastUsage;
    const lines = [
        "OpenAgent compaction",
        `background threshold: ${toPercent(OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD)}`,
        `buffer threshold: ${toPercent(OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD)}`,
        `in progress: ${compactionState.inProgress ? "yes" : "no"}`,
    ];
    if (usage) {
        lines.push(`latest usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit} tokens, ${usage.messagesLength} messages)`);
    }
    else {
        lines.push("latest usage: unknown");
    }
    if (compactionState.lastResult) {
        lines.push(`last result: ${compactionState.lastResult}`);
    }
    if (compactionState.lastCheckpointPath) {
        lines.push(`last checkpoint: ${compactionState.lastCheckpointPath}`);
    }
    if (compactionState.lastWorkspaceNotePath) {
        lines.push(`last workspace note: ${compactionState.lastWorkspaceNotePath}`);
    }
    if (compactionState.lastSummaryPreview) {
        lines.push(`last summary: ${compactionState.lastSummaryPreview}`);
    }
    return lines.join("\n");
}
