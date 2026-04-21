import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { getOpenAgentWorkspacePaths } from "./workspace";

export type SessionHistoryEntry = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  reason: string;
  summary: string;
  agentName: string | null;
  phasesVisited: string[];
  keyFiles: string[];
};

export type SessionHistory = {
  entries: SessionHistoryEntry[];
  updatedAt: string;
};

const MAX_HISTORY_ENTRIES = 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getSessionHistoryPath(
  session: CopilotSession,
  config: OpenAgentConfig,
): string {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path.join(paths.notesRoot, "sessions", "history.json");
}

function getSessionHistoryPathFromWorkspace(
  workspacePath: string,
  config: OpenAgentConfig,
): string {
  return path.join(
    workspacePath,
    "files",
    ...config.workspace.notesDirectory.split("/"),
    "sessions",
    "history.json",
  );
}

function sanitizeEntry(value: unknown): SessionHistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.sessionId !== "string" ||
    typeof value.startedAt !== "string" ||
    typeof value.endedAt !== "string" ||
    typeof value.reason !== "string" ||
    typeof value.summary !== "string"
  ) {
    return null;
  }

  return {
    sessionId: value.sessionId,
    startedAt: value.startedAt,
    endedAt: value.endedAt,
    reason: value.reason,
    summary: value.summary,
    agentName: typeof value.agentName === "string" ? value.agentName : null,
    phasesVisited: Array.isArray(value.phasesVisited)
      ? value.phasesVisited.filter((v): v is string => typeof v === "string")
      : [],
    keyFiles: Array.isArray(value.keyFiles)
      ? value.keyFiles.filter((v): v is string => typeof v === "string")
      : [],
  };
}

function sanitizeHistory(value: unknown): SessionHistory {
  const empty: SessionHistory = { entries: [], updatedAt: new Date().toISOString() };

  if (!isRecord(value)) {
    return empty;
  }

  const entries = Array.isArray(value.entries)
    ? value.entries
        .map(sanitizeEntry)
        .filter((entry): entry is SessionHistoryEntry => entry !== null)
    : [];

  return {
    entries,
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : empty.updatedAt,
  };
}

async function readHistoryFromPath(historyPath: string): Promise<SessionHistory> {
  if (!existsSync(historyPath)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }

  try {
    const raw = await readFile(historyPath, "utf8");
    return sanitizeHistory(JSON.parse(raw));
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}

async function writeHistoryToPath(
  historyPath: string,
  history: SessionHistory,
): Promise<void> {
  await mkdir(path.dirname(historyPath), { recursive: true });
  await writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");
}

export async function readSessionHistory(
  session: CopilotSession,
  config: OpenAgentConfig,
): Promise<SessionHistory> {
  const historyPath = getSessionHistoryPath(session, config);
  return readHistoryFromPath(historyPath);
}

export async function appendSessionHistory(
  session: CopilotSession,
  config: OpenAgentConfig,
  entry: SessionHistoryEntry,
): Promise<SessionHistory> {
  const historyPath = getSessionHistoryPath(session, config);
  const history = await readHistoryFromPath(historyPath);

  history.entries.push(entry);

  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries = history.entries.slice(-MAX_HISTORY_ENTRIES);
  }

  history.updatedAt = new Date().toISOString();

  await writeHistoryToPath(historyPath, history);

  return history;
}

export async function searchSessionHistory(
  session: CopilotSession,
  config: OpenAgentConfig,
  query: string,
): Promise<SessionHistoryEntry[]> {
  const history = await readSessionHistory(session, config);
  const lowerQuery = query.toLowerCase();

  return history.entries.filter((entry) => {
    if (entry.summary.toLowerCase().includes(lowerQuery)) {
      return true;
    }

    if (entry.keyFiles.some((file) => file.toLowerCase().includes(lowerQuery))) {
      return true;
    }

    return false;
  });
}

export function formatSessionHistoryEntry(entry: SessionHistoryEntry): string {
  const lines = [
    `Session: ${entry.sessionId}`,
    `Started: ${entry.startedAt}`,
    `Ended: ${entry.endedAt}`,
    `Reason: ${entry.reason}`,
    `Agent: ${entry.agentName ?? "none"}`,
    `Summary: ${entry.summary}`,
  ];

  if (entry.phasesVisited.length > 0) {
    lines.push(`Phases visited: ${entry.phasesVisited.join(", ")}`);
  }

  if (entry.keyFiles.length > 0) {
    lines.push(`Key files: ${entry.keyFiles.join(", ")}`);
  }

  return lines.join("\n");
}

export async function recordSessionEnd(
  workspacePath: string | null,
  config: OpenAgentConfig,
  entry: Omit<SessionHistoryEntry, "endedAt">,
): Promise<void> {
  if (!workspacePath || workspacePath.length === 0) {
    return;
  }

  const historyPath = getSessionHistoryPathFromWorkspace(workspacePath, config);
  const history = await readHistoryFromPath(historyPath);

  const fullEntry: SessionHistoryEntry = {
    ...entry,
    endedAt: new Date().toISOString(),
  };

  history.entries.push(fullEntry);

  if (history.entries.length > MAX_HISTORY_ENTRIES) {
    history.entries = history.entries.slice(-MAX_HISTORY_ENTRIES);
  }

  history.updatedAt = new Date().toISOString();

  await writeHistoryToPath(historyPath, history);
}
