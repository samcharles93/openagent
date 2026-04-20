const activeTasks = new Map();
const MAX_CONCURRENT_RUNNING = 5;
export function registerBackgroundTask(args) {
    if (activeTasks.has(args.id)) {
        throw new Error(`Background task "${args.id}" already exists.`);
    }
    const runningCount = Array.from(activeTasks.values()).filter((task) => task.status === "running").length;
    if (runningCount >= MAX_CONCURRENT_RUNNING) {
        throw new Error(`Cannot register background task: concurrency limit reached (${MAX_CONCURRENT_RUNNING} running).`);
    }
    const task = {
        id: args.id,
        description: args.description,
        status: "running",
        owner: args.owner,
        startedAt: new Date().toISOString(),
        completedAt: null,
        result: null,
        error: null,
    };
    activeTasks.set(args.id, task);
    return task;
}
export function updateBackgroundTask(id, update) {
    const task = activeTasks.get(id);
    if (!task) {
        throw new Error(`Background task "${id}" not found.`);
    }
    if (update.status !== undefined) {
        task.status = update.status;
        if (update.status === "completed" ||
            update.status === "failed" ||
            update.status === "cancelled") {
            task.completedAt = new Date().toISOString();
        }
    }
    if (update.result !== undefined) {
        task.result = update.result;
    }
    if (update.error !== undefined) {
        task.error = update.error;
    }
    return task;
}
export function getBackgroundTask(id) {
    return activeTasks.get(id);
}
export function listBackgroundTasks(filter) {
    const tasks = Array.from(activeTasks.values());
    if (filter?.status) {
        return tasks.filter((task) => task.status === filter.status);
    }
    return tasks;
}
export function cancelBackgroundTask(id) {
    const task = activeTasks.get(id);
    if (!task) {
        throw new Error(`Background task "${id}" not found.`);
    }
    if (task.status !== "running") {
        throw new Error(`Cannot cancel background task "${id}": current status is "${task.status}".`);
    }
    task.status = "cancelled";
    task.completedAt = new Date().toISOString();
    return task;
}
export function getBackgroundTaskStats() {
    const tasks = Array.from(activeTasks.values());
    return {
        total: tasks.length,
        running: tasks.filter((t) => t.status === "running").length,
        completed: tasks.filter((t) => t.status === "completed").length,
        failed: tasks.filter((t) => t.status === "failed").length,
        cancelled: tasks.filter((t) => t.status === "cancelled").length,
    };
}
export function formatBackgroundTasksSummary() {
    const tasks = Array.from(activeTasks.values());
    if (tasks.length === 0) {
        return "No background tasks tracked.";
    }
    const stats = getBackgroundTaskStats();
    const header = `Background tasks: ${stats.total} total (${stats.running} running, ${stats.completed} completed, ${stats.failed} failed, ${stats.cancelled} cancelled)`;
    const lines = tasks.map((task) => {
        const status = task.status.toUpperCase();
        const suffix = task.result ? ` - ${task.result}` : task.error ? ` - error: ${task.error}` : "";
        return `  [${status}] ${task.id}: ${task.description}${suffix}`;
    });
    return [header, ...lines].join("\n");
}
