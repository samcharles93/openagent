import * as os from "node:os";
import * as path from "node:path";
import { loadOpenAgentConfig } from "./config.js";
function deny(message) {
    return {
        kind: "denied-by-permission-request-hook",
        message,
        interrupt: true,
    };
}
function approve() {
    return { kind: "approved" };
}
function isInsideRoot(candidatePath, rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedCandidate = path.resolve(candidatePath);
    const relative = path.relative(resolvedRoot, resolvedCandidate);
    return (relative === "" ||
        (!relative.startsWith("..") && !path.isAbsolute(relative)));
}
function collectAllowedRoots(initialCwd) {
    const cwd = process.cwd() || initialCwd;
    return [
        path.resolve(cwd),
        path.join(os.homedir(), ".copilot", "session-state"),
    ];
}
function areAllPathsAllowed(rawPaths, allowedRoots, initialCwd) {
    if (!Array.isArray(rawPaths)) {
        return true;
    }
    return rawPaths.every((entry) => {
        if (typeof entry !== "string" || entry.trim().length === 0) {
            return true;
        }
        const resolved = path.resolve(process.cwd() || initialCwd, entry);
        return allowedRoots.some((root) => isInsideRoot(resolved, root));
    });
}
function hasPossibleUrls(rawUrls) {
    return Array.isArray(rawUrls) && rawUrls.length > 0;
}
function commandLooksSafe(rawCommand, initialCwd) {
    if (typeof rawCommand !== "string" || rawCommand.trim().length === 0) {
        return false;
    }
    const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
    return !resolution.config.guardrails.dangerousShellPatterns.some((pattern) => new RegExp(pattern, "i").test(rawCommand));
}
function hasReadOnlyCommands(rawCommands) {
    if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
        return false;
    }
    return rawCommands.every((entry) => {
        if (typeof entry !== "object" || entry === null) {
            return false;
        }
        const readOnly = entry.readOnly;
        return readOnly === true;
    });
}
function getStringField(value, key) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return null;
    }
    const candidate = value[key];
    return typeof candidate === "string" && candidate.trim().length > 0
        ? candidate
        : null;
}
export function createPermissionHandler(args) {
    const { initialCwd } = args;
    return async (request) => {
        const allowedRoots = collectAllowedRoots(initialCwd);
        switch (request.kind) {
            case "read": {
                const targetPath = getStringField(request, "path");
                if (!targetPath) {
                    return deny("OpenAgent could not determine the requested read path.");
                }
                return allowedRoots.some((root) => isInsideRoot(targetPath, root))
                    ? approve()
                    : deny("OpenAgent only auto-approves reads inside the repo or session workspace.");
            }
            case "write": {
                const fileName = getStringField(request, "fileName");
                if (!fileName) {
                    return deny("OpenAgent could not determine the requested write path.");
                }
                return allowedRoots.some((root) => isInsideRoot(fileName, root))
                    ? approve()
                    : deny("OpenAgent only auto-approves writes inside the repo or session workspace.");
            }
            case "shell": {
                const shellRequest = request;
                const fullCommandText = getStringField(shellRequest, "fullCommandText");
                if (!commandLooksSafe(fullCommandText, initialCwd)) {
                    return deny("OpenAgent blocked a shell command that matched its dangerous-command policy.");
                }
                if (hasPossibleUrls(shellRequest.possibleUrls)) {
                    return deny("OpenAgent does not auto-approve shell commands that may access external URLs.");
                }
                if (areAllPathsAllowed(shellRequest.possiblePaths, allowedRoots, initialCwd) ||
                    hasReadOnlyCommands(shellRequest.commands)) {
                    return approve();
                }
                return deny("OpenAgent only auto-approves repo-local shell commands or commands classified as read-only.");
            }
            case "mcp": {
                const mcpRequest = request;
                return mcpRequest.readOnly === true
                    ? approve()
                    : deny("OpenAgent only auto-approves read-only MCP tool calls.");
            }
            case "custom-tool":
                return approve();
            case "url":
                return deny("OpenAgent does not auto-approve direct URL access.");
            default:
                return deny(`OpenAgent does not auto-approve ${request.kind} permissions.`);
        }
    };
}
