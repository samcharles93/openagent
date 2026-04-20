import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import * as path from "node:path";
import { getOpenAgentWorkspacePaths } from "./workspace.js";
function getTasksRoot(session, config) {
    const paths = getOpenAgentWorkspacePaths({ session, config });
    return path.join(paths.notesRoot, "tasks");
}
function getTaskFilePath(tasksRoot, taskId) {
    return path.join(tasksRoot, `${taskId}.json`);
}
function getIndexFilePath(tasksRoot) {
    return path.join(tasksRoot, "index.json");
}
async function readIndex(tasksRoot) {
    const indexPath = getIndexFilePath(tasksRoot);
    if (!existsSync(indexPath)) {
        return { taskIds: [] };
    }
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        "taskIds" in parsed &&
        Array.isArray(parsed.taskIds)) {
        return parsed;
    }
    return { taskIds: [] };
}
async function writeIndex(tasksRoot, index) {
    await mkdir(tasksRoot, { recursive: true });
    await writeFile(getIndexFilePath(tasksRoot), JSON.stringify(index, null, 2), "utf8");
}
export async function readOpenAgentTask(session, config, taskId) {
    const tasksRoot = getTasksRoot(session, config);
    const filePath = getTaskFilePath(tasksRoot, taskId);
    if (!existsSync(filePath)) {
        return null;
    }
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
}
export async function writeOpenAgentTask(session, config, task) {
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
export async function listOpenAgentTasks(session, config) {
    const tasksRoot = getTasksRoot(session, config);
    const index = await readIndex(tasksRoot);
    const tasks = [];
    for (const taskId of index.taskIds) {
        const task = await readOpenAgentTask(session, config, taskId);
        if (task) {
            tasks.push(task);
        }
    }
    return tasks;
}
export async function deleteOpenAgentTask(session, config, taskId) {
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
export async function getReadyOpenAgentTasks(session, config) {
    const allTasks = await listOpenAgentTasks(session, config);
    const statusById = new Map();
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
