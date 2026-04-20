import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { getOpenAgentWorkspacePaths } from "./workspace.js";
const MAX_HISTORY_ENTRIES = 50;
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function getBootstrapHistoryPath(session, config) {
    const paths = getOpenAgentWorkspacePaths({ session, config });
    return path.join(paths.notesRoot, "bootstrap", "history.json");
}
function sanitizeEntry(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (typeof value.timestamp !== "string" ||
        typeof value.requestSummary !== "string" ||
        typeof value.selectedPhase !== "string" ||
        typeof value.phaseReason !== "string" ||
        typeof value.requestedBy !== "string" ||
        typeof value.explicitOverride !== "boolean" ||
        !isRecord(value.confidence) ||
        typeof value.confidence.score !== "number" ||
        !Array.isArray(value.confidence.factors)) {
        return null;
    }
    return {
        timestamp: value.timestamp,
        requestSummary: value.requestSummary,
        selectedPhase: value.selectedPhase,
        phaseReason: value.phaseReason,
        confidence: {
            score: value.confidence.score,
            factors: value.confidence.factors.filter((factor) => typeof factor === "string"),
        },
        requestedBy: value.requestedBy,
        explicitOverride: value.explicitOverride,
    };
}
function sanitizeHistory(value) {
    const empty = { entries: [], updatedAt: new Date().toISOString() };
    if (!isRecord(value)) {
        return empty;
    }
    const entries = Array.isArray(value.entries)
        ? value.entries
            .map(sanitizeEntry)
            .filter((entry) => entry !== null)
        : [];
    return {
        entries,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : empty.updatedAt,
    };
}
export async function readBootstrapHistory(session, config) {
    const historyPath = getBootstrapHistoryPath(session, config);
    if (!existsSync(historyPath)) {
        return { entries: [], updatedAt: new Date().toISOString() };
    }
    try {
        const raw = await readFile(historyPath, "utf8");
        return sanitizeHistory(JSON.parse(raw));
    }
    catch {
        return { entries: [], updatedAt: new Date().toISOString() };
    }
}
export async function appendBootstrapHistory(session, config, entry) {
    const history = await readBootstrapHistory(session, config);
    const historyPath = getBootstrapHistoryPath(session, config);
    history.entries.push(entry);
    if (history.entries.length > MAX_HISTORY_ENTRIES) {
        history.entries = history.entries.slice(-MAX_HISTORY_ENTRIES);
    }
    history.updatedAt = new Date().toISOString();
    await mkdir(path.dirname(historyPath), { recursive: true });
    await writeFile(historyPath, JSON.stringify(history, null, 2), "utf8");
    return history;
}
export function formatBootstrapHistorySummary(history) {
    if (history.entries.length === 0) {
        return "No bootstrap history in this session.";
    }
    const latest = history.entries[history.entries.length - 1];
    const phaseCounts = new Map();
    let totalConfidence = 0;
    for (const entry of history.entries) {
        phaseCounts.set(entry.selectedPhase, (phaseCounts.get(entry.selectedPhase) ?? 0) + 1);
        totalConfidence += entry.confidence.score;
    }
    const avgConfidence = totalConfidence / history.entries.length;
    const phaseBreakdown = Array.from(phaseCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([phase, count]) => `${phase}=${count}`)
        .join(", ");
    const lines = [
        `bootstrap invocations: ${history.entries.length}`,
        `phase breakdown: ${phaseBreakdown}`,
        `average confidence: ${avgConfidence.toFixed(2)}`,
        `latest bootstrap: ${latest.selectedPhase} (confidence: ${latest.confidence.score.toFixed(2)}, ${latest.explicitOverride ? "explicit override" : "auto-classified"})`,
        `latest reason: ${latest.phaseReason}`,
    ];
    if (latest.confidence.factors.length > 0) {
        lines.push(`latest confidence factors: ${latest.confidence.factors.join("; ")}`);
    }
    return lines.join("\n");
}
