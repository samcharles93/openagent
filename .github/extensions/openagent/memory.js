import * as os from "node:os";
import * as path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
function sanitizeSegment(value) {
    return value
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
function normalizeTopic(rawTopic) {
    const segments = rawTopic
        .replace(/\\/g, "/")
        .split("/")
        .map(sanitizeSegment)
        .filter((segment) => segment.length > 0 && segment !== ".");
    if (segments.length === 0 || segments.some((segment) => segment === "..")) {
        throw new Error("Memory topic must stay inside the OpenAgent memory store.");
    }
    const joined = segments.join("/");
    return path.posix.extname(joined).length > 0 ? joined : `${joined}.md`;
}
function buildRepoKey(cwd) {
    const resolved = path.resolve(cwd).replace(/\\/g, "/");
    const key = resolved
        .split("/")
        .map(sanitizeSegment)
        .filter((segment) => segment.length > 0)
        .join("-");
    return key.length > 0 ? key : "workspace";
}
function getMemoryRoot(cwd) {
    const repoKey = buildRepoKey(cwd);
    return {
        repoKey,
        root: path.join(os.homedir(), ".copilot", "openagent", "memory", repoKey),
    };
}
async function collectTopics(root, prefix = "") {
    if (!existsSync(root)) {
        return [];
    }
    const entries = await readdir(root, { withFileTypes: true });
    const topics = await Promise.all(entries.map(async (entry) => {
        const relativePath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) {
            return collectTopics(fullPath, relativePath);
        }
        return [relativePath.replace(/\\/g, "/")];
    }));
    return topics.flat().sort();
}
export async function writeOpenAgentMemory(args) {
    const { cwd, content } = args;
    const mode = args.mode === "replace" ? "replace" : "append";
    const { repoKey, root } = getMemoryRoot(cwd);
    const relativePath = normalizeTopic(args.topic);
    const fullPath = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(fullPath), { recursive: true });
    let nextContent = content;
    if (mode === "append" && existsSync(fullPath)) {
        const current = await readFile(fullPath, "utf8");
        nextContent = `${current.trimEnd()}\n\n${content}`;
    }
    await writeFile(fullPath, nextContent, "utf8");
    return {
        repoKey,
        fullPath,
        relativePath,
        nextContent,
    };
}
export async function readOpenAgentMemory(args) {
    const { cwd } = args;
    const { repoKey, root } = getMemoryRoot(cwd);
    const relativePath = normalizeTopic(args.topic);
    const fullPath = path.join(root, ...relativePath.split("/"));
    if (!existsSync(fullPath)) {
        return {
            repoKey,
            fullPath,
            relativePath,
            content: null,
        };
    }
    return {
        repoKey,
        fullPath,
        relativePath,
        content: await readFile(fullPath, "utf8"),
    };
}
export async function listOpenAgentMemoryTopics(args) {
    const { repoKey, root } = getMemoryRoot(args.cwd);
    return {
        repoKey,
        root,
        topics: await collectTopics(root),
    };
}
