import { loadOpenAgentConfig } from "./config.js";
import { deleteOpenAgentTask, getReadyOpenAgentTasks, listOpenAgentTasks, readOpenAgentTask, writeOpenAgentTask, } from "./tasks.js";
const TASK_STATUSES = [
    "pending",
    "in_progress",
    "done",
    "blocked",
];
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isTaskStatus(value) {
    return typeof value === "string" && TASK_STATUSES.includes(value);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isStringRecord(value) {
    if (!isRecord(value)) {
        return false;
    }
    return Object.values(value).every((v) => typeof v === "string");
}
function createSuccessResult(textResultForLlm, sessionLog) {
    return {
        textResultForLlm,
        resultType: "success",
        sessionLog,
    };
}
function createFailureResult(textResultForLlm, error) {
    return {
        textResultForLlm,
        resultType: "failure",
        error,
    };
}
function resolveCwd(initialCwd) {
    const current = process.cwd();
    return current.length > 0 ? current : initialCwd;
}
function formatTask(task) {
    const lines = [
        `id: ${task.id}`,
        `title: ${task.title}`,
        `status: ${task.status}`,
        `owner: ${task.owner}`,
        `description: ${task.description}`,
    ];
    if (task.blockedBy.length > 0) {
        lines.push(`blocked by: ${task.blockedBy.join(", ")}`);
    }
    if (task.blocks.length > 0) {
        lines.push(`blocks: ${task.blocks.join(", ")}`);
    }
    const metadataKeys = Object.keys(task.metadata);
    if (metadataKeys.length > 0) {
        const entries = metadataKeys.map((key) => `${key}=${task.metadata[key]}`);
        lines.push(`metadata: ${entries.join(", ")}`);
    }
    lines.push(`created: ${task.createdAt}`);
    lines.push(`updated: ${task.updatedAt}`);
    return lines.join("\n");
}
function formatTaskSummary(task) {
    const blockerNote = task.blockedBy.length > 0 ? ` (blocked by: ${task.blockedBy.join(", ")})` : "";
    return `[${task.status}] ${task.id} - ${task.title}${blockerNote}`;
}
function parseCreateTaskArgs(args) {
    if (!isRecord(args) ||
        typeof args.id !== "string" ||
        args.id.length === 0 ||
        typeof args.title !== "string" ||
        args.title.length === 0 ||
        typeof args.description !== "string" ||
        args.description.length === 0) {
        throw new Error("openagent_task_create requires non-empty string id, title, and description fields.");
    }
    const blockedBy = args.blockedBy !== undefined && isStringArray(args.blockedBy) ? args.blockedBy : [];
    const blocks = args.blocks !== undefined && isStringArray(args.blocks) ? args.blocks : [];
    const owner = typeof args.owner === "string" && args.owner.length > 0 ? args.owner : "user";
    const metadata = args.metadata !== undefined && isStringRecord(args.metadata) ? args.metadata : {};
    return {
        id: args.id,
        title: args.title,
        description: args.description,
        blockedBy,
        blocks,
        owner,
        metadata,
    };
}
function parseUpdateTaskArgs(args) {
    if (!isRecord(args) || typeof args.id !== "string" || args.id.length === 0) {
        throw new Error("openagent_task_update requires a non-empty string id field.");
    }
    const result = { id: args.id };
    if (args.status !== undefined) {
        if (!isTaskStatus(args.status)) {
            throw new Error(`openagent_task_update status must be one of: ${TASK_STATUSES.join(", ")}.`);
        }
        result.status = args.status;
    }
    if (typeof args.title === "string" && args.title.length > 0) {
        result.title = args.title;
    }
    if (typeof args.description === "string" && args.description.length > 0) {
        result.description = args.description;
    }
    if (args.blockedBy !== undefined && isStringArray(args.blockedBy)) {
        result.blockedBy = args.blockedBy;
    }
    if (args.blocks !== undefined && isStringArray(args.blocks)) {
        result.blocks = args.blocks;
    }
    if (typeof args.owner === "string" && args.owner.length > 0) {
        result.owner = args.owner;
    }
    if (args.metadata !== undefined && isStringRecord(args.metadata)) {
        result.metadata = args.metadata;
    }
    return result;
}
function parseListTaskArgs(args) {
    if (!isRecord(args)) {
        return { showReady: false };
    }
    const result = {
        showReady: args.showReady === true,
    };
    if (args.status !== undefined && isTaskStatus(args.status)) {
        result.status = args.status;
    }
    return result;
}
function parseGetTaskArgs(args) {
    if (!isRecord(args) || typeof args.id !== "string" || args.id.length === 0) {
        throw new Error("openagent_task_get requires a non-empty string id field.");
    }
    return { id: args.id };
}
export function createTaskTools(args) {
    const { getSession, initialCwd } = args;
    const taskCreateTool = {
        name: "openagent_task_create",
        description: "Create a new task in the OpenAgent task tracker with dependency information and ownership.",
        skipPermission: true,
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "Unique kebab-case identifier for the task.",
                },
                title: {
                    type: "string",
                    description: "Short human-readable title for the task.",
                },
                description: {
                    type: "string",
                    description: "Detailed description of what the task involves.",
                },
                blockedBy: {
                    type: "array",
                    items: { type: "string" },
                    description: "Task IDs that must be completed before this task can start.",
                },
                blocks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Task IDs that depend on this task being completed.",
                },
                owner: {
                    type: "string",
                    description: "Agent name or 'user' indicating who owns this task.",
                },
                metadata: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description: "Arbitrary key-value metadata for the task.",
                },
            },
            required: ["id", "title", "description"],
        },
        handler: async (args) => {
            const parsed = parseCreateTaskArgs(args);
            const session = getSession();
            if (!session.workspacePath) {
                return createFailureResult("Cannot create task because the session workspace is disabled.", "Session workspace is unavailable.");
            }
            const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
            const existing = await readOpenAgentTask(session, resolution.config, parsed.id);
            if (existing) {
                return createFailureResult(`Task "${parsed.id}" already exists. Use openagent_task_update to modify it.`, "Task ID already exists.");
            }
            const now = new Date().toISOString();
            const task = {
                id: parsed.id,
                title: parsed.title,
                description: parsed.description,
                status: "pending",
                blockedBy: parsed.blockedBy,
                blocks: parsed.blocks,
                owner: parsed.owner,
                metadata: parsed.metadata,
                createdAt: now,
                updatedAt: now,
            };
            await writeOpenAgentTask(session, resolution.config, task);
            return createSuccessResult(`Created task "${task.id}" (${task.title}) with status pending.`, `OpenAgent created task ${task.id}.`);
        },
    };
    const taskListTool = {
        name: "openagent_task_list",
        description: "List all tasks in the OpenAgent task tracker with optional status filter or ready-only mode.",
        skipPermission: true,
        parameters: {
            type: "object",
            properties: {
                status: {
                    type: "string",
                    enum: ["pending", "in_progress", "done", "blocked"],
                    description: "Filter tasks to only this status.",
                },
                showReady: {
                    type: "boolean",
                    description: "If true, only return pending tasks whose blockers are all done.",
                },
            },
        },
        handler: async (args) => {
            const parsed = parseListTaskArgs(args);
            const session = getSession();
            if (!session.workspacePath) {
                return createFailureResult("Cannot list tasks because the session workspace is disabled.", "Session workspace is unavailable.");
            }
            const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
            let tasks;
            if (parsed.showReady) {
                tasks = await getReadyOpenAgentTasks(session, resolution.config);
            }
            else {
                tasks = await listOpenAgentTasks(session, resolution.config);
            }
            if (parsed.status) {
                tasks = tasks.filter((task) => task.status === parsed.status);
            }
            if (tasks.length === 0) {
                const qualifier = parsed.showReady
                    ? "ready"
                    : parsed.status
                        ? `with status "${parsed.status}"`
                        : "";
                return createSuccessResult(`No tasks found${qualifier ? ` ${qualifier}` : ""}.`);
            }
            const header = parsed.showReady
                ? `${tasks.length} ready task(s):`
                : parsed.status
                    ? `${tasks.length} task(s) with status "${parsed.status}":`
                    : `${tasks.length} task(s) total:`;
            const summaries = tasks.map(formatTaskSummary);
            return createSuccessResult([header, ...summaries].join("\n"), `OpenAgent listed ${tasks.length} task(s).`);
        },
    };
    const taskGetTool = {
        name: "openagent_task_get",
        description: "Get full details of a single task by ID from the OpenAgent task tracker.",
        skipPermission: true,
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "The task ID to retrieve.",
                },
            },
            required: ["id"],
        },
        handler: async (args) => {
            const parsed = parseGetTaskArgs(args);
            const session = getSession();
            if (!session.workspacePath) {
                return createFailureResult("Cannot get task because the session workspace is disabled.", "Session workspace is unavailable.");
            }
            const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
            const task = await readOpenAgentTask(session, resolution.config, parsed.id);
            if (!task) {
                return createFailureResult(`Task "${parsed.id}" not found.`, "Task not found.");
            }
            return createSuccessResult(formatTask(task), `OpenAgent retrieved task ${task.id}.`);
        },
    };
    const taskUpdateTool = {
        name: "openagent_task_update",
        description: "Update fields on an existing task in the OpenAgent task tracker. Only provided fields are changed.",
        skipPermission: true,
        parameters: {
            type: "object",
            properties: {
                id: {
                    type: "string",
                    description: "The task ID to update.",
                },
                status: {
                    type: "string",
                    enum: ["pending", "in_progress", "done", "blocked"],
                    description: "New status for the task.",
                },
                title: {
                    type: "string",
                    description: "New title for the task.",
                },
                description: {
                    type: "string",
                    description: "New description for the task.",
                },
                blockedBy: {
                    type: "array",
                    items: { type: "string" },
                    description: "Replacement list of task IDs that block this task.",
                },
                blocks: {
                    type: "array",
                    items: { type: "string" },
                    description: "Replacement list of task IDs that this task blocks.",
                },
                owner: {
                    type: "string",
                    description: "New owner for the task.",
                },
                metadata: {
                    type: "object",
                    additionalProperties: { type: "string" },
                    description: "Metadata fields to merge into the task.",
                },
            },
            required: ["id"],
        },
        handler: async (args) => {
            const parsed = parseUpdateTaskArgs(args);
            const session = getSession();
            if (!session.workspacePath) {
                return createFailureResult("Cannot update task because the session workspace is disabled.", "Session workspace is unavailable.");
            }
            const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
            const existing = await readOpenAgentTask(session, resolution.config, parsed.id);
            if (!existing) {
                return createFailureResult(`Task "${parsed.id}" not found.`, "Task not found.");
            }
            const updated = {
                ...existing,
                updatedAt: new Date().toISOString(),
            };
            if (parsed.status !== undefined) {
                updated.status = parsed.status;
            }
            if (parsed.title !== undefined) {
                updated.title = parsed.title;
            }
            if (parsed.description !== undefined) {
                updated.description = parsed.description;
            }
            if (parsed.blockedBy !== undefined) {
                updated.blockedBy = parsed.blockedBy;
            }
            if (parsed.blocks !== undefined) {
                updated.blocks = parsed.blocks;
            }
            if (parsed.owner !== undefined) {
                updated.owner = parsed.owner;
            }
            if (parsed.metadata !== undefined) {
                updated.metadata = { ...existing.metadata, ...parsed.metadata };
            }
            await writeOpenAgentTask(session, resolution.config, updated);
            const changes = [];
            if (parsed.status !== undefined) {
                changes.push(`status: ${existing.status} -> ${updated.status}`);
            }
            if (parsed.title !== undefined) {
                changes.push(`title updated`);
            }
            if (parsed.description !== undefined) {
                changes.push(`description updated`);
            }
            if (parsed.blockedBy !== undefined) {
                changes.push(`blockedBy updated`);
            }
            if (parsed.blocks !== undefined) {
                changes.push(`blocks updated`);
            }
            if (parsed.owner !== undefined) {
                changes.push(`owner: ${existing.owner} -> ${updated.owner}`);
            }
            if (parsed.metadata !== undefined) {
                changes.push(`metadata merged`);
            }
            return createSuccessResult(`Updated task "${parsed.id}": ${changes.join(", ")}.`, `OpenAgent updated task ${parsed.id}.`);
        },
    };
    return [taskCreateTool, taskListTool, taskGetTool, taskUpdateTool];
}
