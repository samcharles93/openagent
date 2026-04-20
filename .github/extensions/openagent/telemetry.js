const EDIT_LIKE_PREFIXES = new Set(["edit", "create", "write", "apply_patch"]);
const READ_LIKE_PREFIXES = new Set(["read", "view"]);
const telemetry = {
    sessionStartedAt: new Date().toISOString(),
    toolCalls: 0,
    toolFailures: 0,
    toolDenials: 0,
    editToolCalls: 0,
    readToolCalls: 0,
    fallbackSwitches: 0,
    lastFallback: null,
    loopStarts: 0,
    loopIterations: 0,
    loopCancels: 0,
    loopCompletions: 0,
    compactionsStarted: 0,
    compactionsCompleted: 0,
    compactionFailures: 0,
    lastUsageRatio: null,
    lastUsageTokens: null,
    tokenLimit: null,
    lspCalls: 0,
    astCalls: 0,
    lookAtCalls: 0,
};
function isEditLikeTool(toolName) {
    return (EDIT_LIKE_PREFIXES.has(toolName) ||
        toolName === "openagent_safe_edit" ||
        toolName === "openagent_lsp_rename" ||
        toolName === "openagent_ast_replace");
}
function isReadLikeTool(toolName) {
    return (READ_LIKE_PREFIXES.has(toolName) ||
        toolName === "openagent_lsp_diagnostics" ||
        toolName === "openagent_lsp_goto_definition" ||
        toolName === "openagent_lsp_find_references" ||
        toolName === "openagent_ast_search" ||
        toolName === "openagent_look_at");
}
export function recordToolCall(toolName) {
    telemetry.toolCalls += 1;
    if (isEditLikeTool(toolName)) {
        telemetry.editToolCalls += 1;
    }
    if (isReadLikeTool(toolName)) {
        telemetry.readToolCalls += 1;
    }
    if (toolName.startsWith("openagent_lsp_")) {
        telemetry.lspCalls += 1;
    }
    if (toolName.startsWith("openagent_ast_")) {
        telemetry.astCalls += 1;
    }
    if (toolName === "openagent_look_at") {
        telemetry.lookAtCalls += 1;
    }
}
export function recordLookAtInvocation() {
    telemetry.lookAtCalls += 1;
}
export function recordToolFailure() {
    telemetry.toolFailures += 1;
}
export function recordToolDenied() {
    telemetry.toolDenials += 1;
}
export function recordFallbackSwitch(agentName, target) {
    telemetry.fallbackSwitches += 1;
    telemetry.lastFallback = `${agentName} -> ${target.model}${target.reasoningEffort ? ` (${target.reasoningEffort})` : ""}`;
}
export function recordLoopStart() {
    telemetry.loopStarts += 1;
}
export function recordLoopIteration() {
    telemetry.loopIterations += 1;
}
export function recordLoopCancel() {
    telemetry.loopCancels += 1;
}
export function recordLoopComplete() {
    telemetry.loopCompletions += 1;
}
export function recordUsageInfo(currentTokens, tokenLimit) {
    telemetry.lastUsageTokens = currentTokens;
    telemetry.tokenLimit = tokenLimit;
    telemetry.lastUsageRatio =
        tokenLimit > 0 ? Math.max(0, Math.min(currentTokens / tokenLimit, 1)) : null;
}
export function recordCompactionStart() {
    telemetry.compactionsStarted += 1;
}
export function recordCompactionComplete(success) {
    if (success) {
        telemetry.compactionsCompleted += 1;
        return;
    }
    telemetry.compactionFailures += 1;
}
export function getOpenAgentTelemetrySnapshot() {
    return { ...telemetry };
}
export function formatOpenAgentTelemetry(snapshot = getOpenAgentTelemetrySnapshot()) {
    const usage = snapshot.lastUsageRatio === null || snapshot.lastUsageTokens === null || snapshot.tokenLimit === null
        ? "usage: unknown"
        : `usage: ${(snapshot.lastUsageRatio * 100).toFixed(1)}% (${snapshot.lastUsageTokens}/${snapshot.tokenLimit} tokens)`;
    return [
        "OpenAgent telemetry",
        `session started: ${snapshot.sessionStartedAt}`,
        `tools: ${snapshot.toolCalls} calls, ${snapshot.toolFailures} failures, ${snapshot.toolDenials} denied`,
        `tool mix: ${snapshot.readToolCalls} read-like, ${snapshot.editToolCalls} edit-like, ${snapshot.lspCalls} LSP, ${snapshot.astCalls} AST, ${snapshot.lookAtCalls} look_at`,
        `fallbacks: ${snapshot.fallbackSwitches}${snapshot.lastFallback ? ` (last: ${snapshot.lastFallback})` : ""}`,
        `loops: ${snapshot.loopStarts} starts, ${snapshot.loopIterations} continuations, ${snapshot.loopCompletions} completions, ${snapshot.loopCancels} cancels`,
        `compactions: ${snapshot.compactionsStarted} started, ${snapshot.compactionsCompleted} completed, ${snapshot.compactionFailures} failed`,
        usage,
    ].join("\n");
}
