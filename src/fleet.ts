import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { getOpenAgentWorkspacePaths } from "./workspace";

export type FleetTask = {
  id: string;
  title: string;
  description: string;
  scope?: string;
};

export type FleetState = {
  id: string;
  objective: string;
  wave: number;
  createdAt: string;
  updatedAt: string;
  tasks: FleetTask[];
};

function getFleetFilePath(session: CopilotSession, config: OpenAgentConfig): string {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path.join(paths.routingRoot, "fleet.json");
}

export async function writeFleetState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  state: FleetState;
}): Promise<void> {
  const { session, config, state } = args;
  const paths = getOpenAgentWorkspacePaths({ session, config });
  await mkdir(paths.routingRoot, { recursive: true });
  await writeFile(getFleetFilePath(session, config), JSON.stringify(state, null, 2), "utf8");
}

export async function readFleetState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<FleetState | null> {
  const { session, config } = args;
  const filePath = getFleetFilePath(session, config);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as FleetState;
  } catch {
    return null;
  }
}

export async function clearFleetState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<void> {
  const { session, config } = args;
  const filePath = getFleetFilePath(session, config);
  if (existsSync(filePath)) {
    await unlink(filePath);
  }
}

export function formatFleetDispatchInstructions(state: FleetState): string {
  const { id, objective, wave, tasks } = state;
  const plural = tasks.length === 1 ? "task" : "tasks";
  const header = [
    `Fleet ${id} registered.`,
    `Objective: ${objective}`,
    `Wave: ${wave} — ${tasks.length} ${plural}`,
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
        `Fleet ${id}, wave ${wave}, task ${i + 1} of ${tasks.length}.`,
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
