import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config.js";
import { getOpenAgentWorkspacePaths } from "./workspace.js";

export type OpenAgentTaskStatus = "pending" | "in_progress" | "done" | "blocked";

export type OpenAgentTask = {
  id: string;
  title: string;
  description: string;
  status: OpenAgentTaskStatus;
  blockedBy: string[];
  blocks: string[];
  owner: string;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

type TaskIndex = {
  taskIds: string[];
};

function getTasksRoot(session: CopilotSession, config: OpenAgentConfig): string {
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path.join(paths.notesRoot, "tasks");
}

function getTaskFilePath(tasksRoot: string, taskId: string): string {
  return path.join(tasksRoot, `${taskId}.json`);
}

function getIndexFilePath(tasksRoot: string): string {
  return path.join(tasksRoot, "index.json");
}

async function readIndex(tasksRoot: string): Promise<TaskIndex> {
  const indexPath = getIndexFilePath(tasksRoot);
  if (!existsSync(indexPath)) {
    return { taskIds: [] };
  }

  const raw = await readFile(indexPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    "taskIds" in parsed &&
    Array.isArray((parsed as TaskIndex).taskIds)
  ) {
    return parsed as TaskIndex;
  }

  return { taskIds: [] };
}

async function writeIndex(tasksRoot: string, index: TaskIndex): Promise<void> {
  await mkdir(tasksRoot, { recursive: true });
  await writeFile(getIndexFilePath(tasksRoot), JSON.stringify(index, null, 2), "utf8");
}

export async function readOpenAgentTask(
  session: CopilotSession,
  config: OpenAgentConfig,
  taskId: string,
): Promise<OpenAgentTask | null> {
  const tasksRoot = getTasksRoot(session, config);
  const filePath = getTaskFilePath(tasksRoot, taskId);
  if (!existsSync(filePath)) {
    return null;
  }

  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as OpenAgentTask;
}

export async function writeOpenAgentTask(
  session: CopilotSession,
  config: OpenAgentConfig,
  task: OpenAgentTask,
): Promise<void> {
  const tasksRoot = getTasksRoot(session, config);
  await mkdir(tasksRoot, { recursive: true });

  const filePath = getTaskFilePath(tasksRoot, task.id);
  await writeFile(filePath, JSON.stringify(task, null, 2), "utf8");

  const index = await readIndex(tasksRoot);
  if (!index.taskIds.includes(task.id)) {
    index.taskIds.push(task.id);
    await writeIndex(tasksRoot, index);
  }
}

export async function listOpenAgentTasks(
  session: CopilotSession,
  config: OpenAgentConfig,
): Promise<OpenAgentTask[]> {
  const tasksRoot = getTasksRoot(session, config);
  const index = await readIndex(tasksRoot);

  const tasks: OpenAgentTask[] = [];
  for (const taskId of index.taskIds) {
    const task = await readOpenAgentTask(session, config, taskId);
    if (task) {
      tasks.push(task);
    }
  }

  return tasks;
}

export async function deleteOpenAgentTask(
  session: CopilotSession,
  config: OpenAgentConfig,
  taskId: string,
): Promise<boolean> {
  const tasksRoot = getTasksRoot(session, config);
  const filePath = getTaskFilePath(tasksRoot, taskId);

  if (!existsSync(filePath)) {
    return false;
  }

  await unlink(filePath);

  const index = await readIndex(tasksRoot);
  index.taskIds = index.taskIds.filter((id) => id !== taskId);
  await writeIndex(tasksRoot, index);

  return true;
}

export async function getReadyOpenAgentTasks(
  session: CopilotSession,
  config: OpenAgentConfig,
): Promise<OpenAgentTask[]> {
  const allTasks = await listOpenAgentTasks(session, config);
  const statusById = new Map<string, OpenAgentTaskStatus>();
  for (const task of allTasks) {
    statusById.set(task.id, task.status);
  }

  return allTasks.filter((task) => {
    if (task.status !== "pending") {
      return false;
    }

    return task.blockedBy.every((blockerId) => statusById.get(blockerId) === "done");
  });
}
