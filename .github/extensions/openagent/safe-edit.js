import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
function isInsideRoot(candidatePath, rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedCandidate = path.resolve(candidatePath);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function countOccurrences(haystack, needle) {
    if (needle.length === 0) {
        return 0;
    }
    let count = 0;
    let index = 0;
    while (true) {
        index = haystack.indexOf(needle, index);
        if (index === -1) {
            return count;
        }
        count += 1;
        index += needle.length;
    }
}
export function hashSafeEditLine(line) {
    return createHash("sha256").update(line, "utf8").digest("hex").slice(0, 16);
}
export async function applyOpenAgentSafeEdit(args) {
    const resolvedFilePath = path.resolve(args.cwd, args.file);
    const allowedRoots = [path.resolve(args.cwd)];
    if (args.workspacePath) {
        allowedRoots.push(path.resolve(args.workspacePath));
    }
    if (!allowedRoots.some((root) => isInsideRoot(resolvedFilePath, root))) {
        throw new Error("openagent_safe_edit only allows files inside the repo or session workspace.");
    }
    if (args.oldBlock.length === 0) {
        throw new Error("openagent_safe_edit requires a non-empty oldBlock.");
    }
    const currentContent = await readFile(resolvedFilePath, "utf8");
    const occurrenceCount = countOccurrences(currentContent, args.oldBlock);
    if (occurrenceCount === 0) {
        throw new Error("openagent_safe_edit could not find oldBlock in the target file.");
    }
    if (occurrenceCount > 1) {
        throw new Error("openagent_safe_edit found multiple oldBlock matches; refine the block.");
    }
    const matchIndex = currentContent.indexOf(args.oldBlock);
    const lineNumber = currentContent.slice(0, matchIndex).split(/\r?\n/).length;
    const currentFirstLine = args.oldBlock.split(/\r?\n/, 1)[0] ?? "";
    const currentHash = hashSafeEditLine(currentFirstLine);
    if (currentHash !== args.lineHash) {
        throw new Error(`openagent_safe_edit refused to edit because the target line hash drifted (expected ${args.lineHash}, found ${currentHash}).`);
    }
    const nextContent = currentContent.replace(args.oldBlock, args.newBlock);
    await writeFile(resolvedFilePath, nextContent, "utf8");
    return {
        filePath: resolvedFilePath,
        lineNumber,
        nextContent,
    };
}
