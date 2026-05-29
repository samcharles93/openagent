import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import {
  recordCompactionComplete,
  recordCompactionStart,
  recordUsageInfo,
} from "./telemetry";
import { writeOpenAgentWorkspaceNote } from "./workspace";

export const OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD = 0.7;
export const OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD = 0.9;
/** Threshold at which the runtime requests the agent to self-summarize its history. */
export const OPENAGENT_AGENT_SUMMARY_THRESHOLD = 0.65;

export type OpenAgentUsageSnapshot = {
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
  ratio: number;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
  updatedAt: string;
};

export type OpenAgentCompactionState = {
  lastUsage: OpenAgentUsageSnapshot | null;
  inProgress: boolean;
  lastCompactedAt: string | null;
  lastCheckpointPath: string | null;
  lastWorkspaceNotePath: string | null;
  lastSummaryPreview: string | null;
  lastResult: "success" | "failure" | null;
  /** Agent-written session summary for context retention across compaction boundaries. */
  agentSummary: string | null;
  /** Number of times the runtime has requested an agent-driven summary this session. */
  agentSummaryCount: number;
  /** Whether a new agent summary is pending (set by threshold check, cleared by commit). */
  agentSummaryPending: boolean;
};

const compactionState: OpenAgentCompactionState = {
  lastUsage: null,
  inProgress: false,
  lastCompactedAt: null,
  lastCheckpointPath: null,
  lastWorkspaceNotePath: null,
  lastSummaryPreview: null,
  lastResult: null,
  agentSummary: null,
  agentSummaryCount: 0,
  agentSummaryPending: false,
};

function truncateSummary(value: string, maxChars = 240): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function toPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function recordOpenAgentUsage(args: {
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
}): OpenAgentUsageSnapshot {
  const snapshot: OpenAgentUsageSnapshot = {
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

export function noteOpenAgentCompactionStart(): void {
  compactionState.inProgress = true;
  recordCompactionStart();
}

export async function noteOpenAgentCompactionComplete(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  success: boolean;
  error?: string;
  preCompactionTokens?: number;
  postCompactionTokens?: number;
  preCompactionMessagesLength?: number;
  messagesRemoved?: number;
  tokensRemoved?: number;
  summaryContent?: string;
  checkpointNumber?: number;
  checkpointPath?: string;
  systemTokens?: number;
  conversationTokens?: number;
  toolDefinitionsTokens?: number;
}): Promise<{
  workspaceNotePath: string | null;
  message: string;
}> {
  compactionState.inProgress = false;
  compactionState.lastCompactedAt = new Date().toISOString();
  compactionState.lastCheckpointPath = args.checkpointPath ?? null;
  compactionState.lastSummaryPreview = args.summaryContent
    ? truncateSummary(args.summaryContent)
    : null;
  compactionState.lastResult = args.success ? "success" : "failure";

  if (
    typeof args.postCompactionTokens === "number" &&
    compactionState.lastUsage?.tokenLimit
  ) {
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
  } catch {
    compactionState.lastWorkspaceNotePath = null;
  }

  return {
    workspaceNotePath: compactionState.lastWorkspaceNotePath,
    message: args.success
      ? `OpenAgent compaction completed${compactionState.lastWorkspaceNotePath ? ` and saved ${compactionState.lastWorkspaceNotePath}` : ""}.`
      : `OpenAgent compaction failed${args.error ? `: ${args.error}` : "."}`,
  };
}

export function getOpenAgentCompactionState(): OpenAgentCompactionState {
  return {
    ...compactionState,
    lastUsage: compactionState.lastUsage ? { ...compactionState.lastUsage } : null,
  };
}

/**
 * Returns true when the token budget is high enough that the agent should
 * be prompted to self-summarize before the preemptive compaction threshold is hit.
 */
export function shouldTriggerAgentSummary(): boolean {
  const usage = compactionState.lastUsage;
  if (!usage || usage.tokenLimit <= 0) return false;
  if (compactionState.inProgress || compactionState.agentSummaryPending) return false;
  return usage.ratio >= OPENAGENT_AGENT_SUMMARY_THRESHOLD;
}

/**
 * Builds a prompt that asks the agent to produce a concise session summary.
 * The summary is stored in agentSummary and injected as retained context
 * after the next compaction cycle.
 */
export function buildAgentSummaryPrompt(): string {
  const usage = compactionState.lastUsage;
  const usageInfo = usage
    ? `Token usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit}, ${usage.messagesLength} messages).`
    : "Token usage: unknown.";

  return [
    "## Context budget warning",
    "",
    `The session is approaching its context limit. ${usageInfo}`,
    "",
    "Before continuing, produce a compact summary of the work done so far. Include:",
    "- The original goal and current phase",
    "- Key decisions made and why",
    "- Completed tasks with file paths",
    "- Open risks and blockers",
    "- Next steps",
    "",
    "Format the summary as a bulleted markdown block starting with `## Session Summary`.",
    "The summary will be retained across compaction and injected into future turns.",
  ].join("\n");
}

/**
 * Commits an agent-produced session summary for retention across compaction.
 * Call this when the agent has responded with a `## Session Summary` block.
 */
export function commitAgentSummary(summary: string): void {
  compactionState.agentSummary = summary;
  compactionState.agentSummaryCount += 1;
  compactionState.agentSummaryPending = false;
}

/**
 * Marks that an agent summary request has been issued, so we don't re-trigger.
 */
export function markAgentSummaryRequested(): void {
  compactionState.agentSummaryPending = true;
}

/**
 * Returns the current agent summary, if one exists, for injection into
 * the system prompt or context after a compaction cycle.
 */
export function getAgentSummary(): string | null {
  return compactionState.agentSummary;
}

/**
 * Returns the retained context block to inject after compaction.
 * Combines the agent summary with key invariants.
 */
export function buildCompactionRetentionContext(): string | null {
  const summary = compactionState.agentSummary;
  if (!summary) return null;

  return [
    "## Retained context (from pre-compaction summary)",
    "",
    summary,
    "",
    `Compactions this session: ${compactionState.agentSummaryCount}`,
    `Last compacted: ${compactionState.lastCompactedAt ?? "never"}`,
  ].join("\n");
}

export function formatOpenAgentCompactionStatus(): string {
  const usage = compactionState.lastUsage;
  const lines = [
    "OpenAgent compaction",
    `background threshold: ${toPercent(OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD)}`,
    `buffer threshold: ${toPercent(OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD)}`,
    `in progress: ${compactionState.inProgress ? "yes" : "no"}`,
  ];

  if (usage) {
    lines.push(
      `latest usage: ${toPercent(usage.ratio)} (${usage.currentTokens}/${usage.tokenLimit} tokens, ${usage.messagesLength} messages)`,
    );
  } else {
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
  if (compactionState.agentSummary) {
    lines.push(`agent summary: ${truncateSummary(compactionState.agentSummary)}`);
  }
  if (compactionState.agentSummaryPending) {
    lines.push("agent summary: pending");
  }
  lines.push(`agent-driven summaries: ${compactionState.agentSummaryCount}`);

  return lines.join("\n");
}
