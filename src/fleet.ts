import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { getOpenAgentWorkspacePaths } from "./workspace";

export type FleetTaskStatus = "pending" | "dispatched" | "completed" | "failed";

export type FleetTask = {
  id: string;
  title: string;
  description: string;
  scope?: string;
  status: FleetTaskStatus;
  dispatchedAt?: string;
  completedAt?: string;
  notes?: string;
};

export type FleetWave = {
  id: string; // e.g., "fleet-{timestamp}-wave-{n}"
  wave: number;
  objective: string;
  createdAt: string;
  tasks: FleetTask[];
};

export type FleetLog = {
  id: string; // e.g., "fleet-{timestamp}" (based on first wave's creation time)
  objective: string;
  createdAt: string;
  updatedAt: string;
  waves: FleetWave[];
};

function getFleetFilePath(session: CopilotSession, config: OpenAgentConfig): string {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path.join(paths.routingRoot, "fleet.json");
}

export async function writeFleetWave(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  objective: string;
  tasks: Array<{ title: string; description: string; scope?: string }>;
}): Promise<{ log: FleetLog; wave: FleetWave }> {
  const { session, config, objective, tasks } = args;

  const existingLog = await readFleetLog({ session, config });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const waveNumber = existingLog ? existingLog.waves.length + 1 : 1;
  const waveId = `fleet-${timestamp}-wave-${waveNumber}`;

  const now = new Date().toISOString();

  const wave: FleetWave = {
    id: waveId,
    wave: waveNumber,
    objective,
    createdAt: now,
    tasks: tasks.map((t, i) => ({
      id: `${waveId}-task-${i + 1}`,
      title: t.title,
      description: t.description,
      scope: t.scope,
      status: "dispatched",
      dispatchedAt: now,
    })),
  };

  const log: FleetLog = existingLog
    ? {
        ...existingLog,
        objective,
        updatedAt: now,
        waves: [...existingLog.waves, wave],
      }
    : {
        id: `fleet-${timestamp}`,
        objective,
        createdAt: now,
        updatedAt: now,
        waves: [wave],
      };

  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir(paths.routingRoot, { recursive: true });
  await writeFile(getFleetFilePath(session, config), JSON.stringify(log, null, 2), "utf8");

  return { log, wave };
}

export async function readFleetLog(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<FleetLog | null> {
  const { session, config } = args;
  const filePath = getFleetFilePath(session, config);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as FleetLog;
  } catch {
    return null;
  }
}

export async function updateFleetTaskStatus(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  taskId: string;
  status: FleetTaskStatus;
  notes?: string;
}): Promise<{ found: boolean }> {
  const { session, config, taskId, status, notes } = args;

  const log = await readFleetLog({ session, config });
  if (!log) {
    return { found: false };
  }

  let found = false;
  for (const wave of log.waves) {
    for (const task of wave.tasks) {
      if (task.id === taskId) {
        task.status = status;
        if (notes !== undefined) {
          task.notes = notes;
        }
        if (status === "completed" || status === "failed") {
          task.completedAt = new Date().toISOString();
        }
        found = true;
        break;
      }
    }
    if (found) break;
  }

  if (!found) {
    return { found: false };
  }

  log.updatedAt = new Date().toISOString();
  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir(paths.routingRoot, { recursive: true });
  await writeFile(getFleetFilePath(session, config), JSON.stringify(log, null, 2), "utf8");

  return { found: true };
}

export async function clearFleetLog(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<void> {
  const { session, config } = args;
  const filePath = getFleetFilePath(session, config);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

export function formatFleetDispatchInstructions(log: FleetLog, wave: FleetWave): string {
  const { tasks } = wave;
  const plural = tasks.length === 1 ? "task" : "tasks";
  const header = [
    `Fleet ${log.id} registered.`,
    `Objective: ${wave.objective}`,
    `Wave: ${wave.wave} — ${tasks.length} ${plural}`,
    "",
    tasks.length === 1
      ? `Dispatch the following task by calling the \`agent\` tool:`
      : `Dispatch ALL ${tasks.length} tasks simultaneously in a **single response** by calling the \`agent\` tool once per task:`,
    "",
  ].join("\n");

  const taskBlocks = tasks
    .map((task, i) => {
      const safeName = task.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      const prompt = [
        `Fleet ${log.id}, wave ${wave.wave}, task ${i + 1} of ${tasks.length}.`,
        ``,
        `Task: ${task.title}`,
        `Objective: ${task.description}`,
        task.scope ? `Scope (files/packages to modify): ${task.scope}` : "",
        ``,
        `Complete this task fully. Return a single final report containing:`,
        `1. Files changed (with one-line reason each)`,
        `2. Build/test results`,
        `3. Any blockers or follow-up needed`,
        ``,
        `IMPORTANT: After sending your report, stop. Do not continue working, do not ask follow-up questions, do not wait for further input. This is a terminal one-shot task.`,
      ]
        .filter((l) => l !== undefined)
        .join("\n");

      return [
        `--- Task ${i + 1} of ${tasks.length}: ${task.title} ---`,
        `agent_type: builder`,
        `name: ${safeName}`,
        `description: ${task.title.slice(0, 60)}`,
        `mode: background`,
        `prompt:`,
        prompt
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n"),
      ].join("\n");
    })
    .join("\n\n");

  const footer = [
    "",
    tasks.length > 1
      ? "Call the `agent` tool for all tasks above in one response to dispatch them in parallel."
      : "Call the `agent` tool with the parameters above.",
    "After all agents complete, read and verify each output before proceeding to the next wave or review.",
  ].join("\n");

  return header + taskBlocks + footer;
}
