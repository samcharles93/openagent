import type { OpenAgentModelTarget } from "./config";
import { homedir } from "node:os";

// Regex patterns for PII and secrets that should never appear in telemetry output.
const PII_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // Bearer tokens and GitHub PATs
  { pattern: /ghp_[a-zA-Z0-9]{36,}/g, replacement: "[REDACTED:github-pat]" },
  { pattern: /github_pat_[a-zA-Z0-9_]{20,}/g, replacement: "[REDACTED:github-pat]" },
  { pattern: /Bearer\s+[A-Za-z0-9_\-\\.]+/g, replacement: "Bearer [REDACTED]" },
  // Generic API keys and tokens (alphanumeric strings >32 chars following key-like prefixes)
  { pattern: /(?:api[_-]?key|apikey|secret|token|password|auth)\s*[:=]\s*["']?[A-Za-z0-9_\-]{20,}["']?/gi, replacement: "$1=[REDACTED]" },
  // Home directory paths
  { pattern: new RegExp(homedir().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), replacement: "~" },
];

/**
 * Scrubs known PII patterns from a string before it enters telemetry output.
 * Applied to the lastFallback field and any string fields in the snapshot.
 */
function sanitizeForTelemetry(value: string): string {
  let sanitized = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

function sanitizeSnapshot(snapshot: OpenAgentTelemetrySnapshot): OpenAgentTelemetrySnapshot {
  return {
    ...snapshot,
    lastFallback: snapshot.lastFallback ? sanitizeForTelemetry(snapshot.lastFallback) : null,
  };
}

export type OpenAgentTelemetrySnapshot = {
  sessionStartedAt: string;
  toolCalls: number;
  toolFailures: number;
  toolDenials: number;
  editToolCalls: number;
  readToolCalls: number;
  fallbackSwitches: number;
  lastFallback: string | null;
  loopStarts: number;
  loopIterations: number;
  loopCancels: number;
  loopCompletions: number;
  compactionsStarted: number;
  compactionsCompleted: number;
  compactionFailures: number;
  lastUsageRatio: number | null;
  lastUsageTokens: number | null;
  tokenLimit: number | null;
  lspCalls: number;
  astCalls: number;
  lookAtCalls: number;
};

const EDIT_LIKE_PREFIXES = new Set(["edit", "create", "write", "apply_patch"]);
const READ_LIKE_PREFIXES = new Set(["read", "view"]);

const telemetry: OpenAgentTelemetrySnapshot = {
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

function isEditLikeTool(toolName: string): boolean {
  return (
    EDIT_LIKE_PREFIXES.has(toolName) ||
    toolName === "openagent_safe_edit" ||
    toolName === "openagent_lsp_rename" ||
    toolName === "openagent_ast_replace"
  );
}

function isReadLikeTool(toolName: string): boolean {
  return (
    READ_LIKE_PREFIXES.has(toolName) ||
    toolName === "openagent_lsp_diagnostics" ||
    toolName === "openagent_lsp_goto_definition" ||
    toolName === "openagent_lsp_find_references" ||
    toolName === "openagent_ast_search" ||
    toolName === "openagent_look_at"
  );
}

export function recordToolCall(toolName: string): void {
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

export function recordLookAtInvocation(): void {
  telemetry.lookAtCalls += 1;
}

export function recordToolFailure(): void {
  telemetry.toolFailures += 1;
}

export function recordToolDenied(): void {
  telemetry.toolDenials += 1;
}

export function recordFallbackSwitch(agentName: string, target: OpenAgentModelTarget): void {
  telemetry.fallbackSwitches += 1;
  telemetry.lastFallback = `${agentName} -> ${target.model}${target.reasoningEffort ? ` (${target.reasoningEffort})` : ""}`;
}

export function recordLoopStart(): void {
  telemetry.loopStarts += 1;
}

export function recordLoopIteration(): void {
  telemetry.loopIterations += 1;
}

export function recordLoopCancel(): void {
  telemetry.loopCancels += 1;
}

export function recordLoopComplete(): void {
  telemetry.loopCompletions += 1;
}

export function recordUsageInfo(currentTokens: number, tokenLimit: number): void {
  telemetry.lastUsageTokens = currentTokens;
  telemetry.tokenLimit = tokenLimit;
  telemetry.lastUsageRatio =
    tokenLimit > 0 ? Math.max(0, Math.min(currentTokens / tokenLimit, 1)) : null;
}

export function recordCompactionStart(): void {
  telemetry.compactionsStarted += 1;
}

export function recordCompactionComplete(success: boolean): void {
  if (success) {
    telemetry.compactionsCompleted += 1;
    return;
  }

  telemetry.compactionFailures += 1;
}

export function getOpenAgentTelemetrySnapshot(): OpenAgentTelemetrySnapshot {
  return sanitizeSnapshot({ ...telemetry });
}

export function formatOpenAgentTelemetry(snapshot = getOpenAgentTelemetrySnapshot()): string {
  const safe = sanitizeSnapshot(snapshot);
  const usage =
    safe.lastUsageRatio === null || safe.lastUsageTokens === null || safe.tokenLimit === null
      ? "usage: unknown"
      : `usage: ${(safe.lastUsageRatio * 100).toFixed(1)}% (${safe.lastUsageTokens}/${safe.tokenLimit} tokens)`;

  return [
    "OpenAgent telemetry",
    `session started: ${safe.sessionStartedAt}`,
    `tools: ${safe.toolCalls} calls, ${safe.toolFailures} failures, ${safe.toolDenials} denied`,
    `tool mix: ${safe.readToolCalls} read-like, ${safe.editToolCalls} edit-like, ${safe.lspCalls} LSP, ${safe.astCalls} AST, ${safe.lookAtCalls} look_at`,
    `fallbacks: ${safe.fallbackSwitches}${safe.lastFallback ? ` (last: ${safe.lastFallback})` : ""}`,
    `loops: ${safe.loopStarts} starts, ${safe.loopIterations} continuations, ${safe.loopCompletions} completions, ${safe.loopCancels} cancels`,
    `compactions: ${safe.compactionsStarted} started, ${safe.compactionsCompleted} completed, ${safe.compactionFailures} failed`,
    usage,
  ].join("\n");
}
