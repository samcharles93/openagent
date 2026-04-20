import * as os from "node:os";
import * as path from "node:path";
import type {
  PermissionHandler,
  PermissionRequest,
  PermissionRequestResult,
} from "@github/copilot-sdk";
import { loadOpenAgentConfig } from "./config.js";

type ShellPermissionRequest = PermissionRequest & {
  kind: "shell";
  fullCommandText?: unknown;
  possiblePaths?: unknown;
  possibleUrls?: unknown;
  commands?: unknown;
};

type WritePermissionRequest = PermissionRequest & {
  kind: "write";
  fileName?: unknown;
};

type ReadPermissionRequest = PermissionRequest & {
  kind: "read";
  path?: unknown;
};

type McpPermissionRequest = PermissionRequest & {
  kind: "mcp";
  readOnly?: unknown;
};

function deny(message: string): PermissionRequestResult {
  return {
    kind: "denied-by-permission-request-hook",
    message,
    interrupt: true,
  };
}

function approve(): PermissionRequestResult {
  return { kind: "approved" };
}

function isInsideRoot(candidatePath: string, rootPath: string): boolean {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);

  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function collectAllowedRoots(initialCwd: string): string[] {
  const cwd = process.cwd() || initialCwd;
  return [
    path.resolve(cwd),
    path.join(os.homedir(), ".copilot", "session-state"),
  ];
}

function areAllPathsAllowed(
  rawPaths: unknown,
  allowedRoots: string[],
  initialCwd: string,
): boolean {
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

function hasPossibleUrls(rawUrls: unknown): boolean {
  return Array.isArray(rawUrls) && rawUrls.length > 0;
}

function commandLooksSafe(rawCommand: unknown, initialCwd: string): boolean {
  if (typeof rawCommand !== "string" || rawCommand.trim().length === 0) {
    return false;
  }

  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  return !resolution.config.guardrails.dangerousShellPatterns.some((pattern) =>
    new RegExp(pattern, "i").test(rawCommand),
  );
}

function hasReadOnlyCommands(rawCommands: unknown): boolean {
  if (!Array.isArray(rawCommands) || rawCommands.length === 0) {
    return false;
  }

  return rawCommands.every((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }

    const readOnly = (entry as { readOnly?: unknown }).readOnly;
    return readOnly === true;
  });
}

function getStringField(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate
    : null;
}

export function createPermissionHandler(args: {
  initialCwd: string;
}): PermissionHandler {
  const { initialCwd } = args;

  return async (request) => {
    const allowedRoots = collectAllowedRoots(initialCwd);

    switch (request.kind) {
      case "read": {
        const targetPath = getStringField(request as ReadPermissionRequest, "path");
        if (!targetPath) {
          return deny("OpenAgent could not determine the requested read path.");
        }

        return allowedRoots.some((root) => isInsideRoot(targetPath, root))
          ? approve()
          : deny("OpenAgent only auto-approves reads inside the repo or session workspace.");
      }

      case "write": {
        const fileName = getStringField(request as WritePermissionRequest, "fileName");
        if (!fileName) {
          return deny("OpenAgent could not determine the requested write path.");
        }

        return allowedRoots.some((root) => isInsideRoot(fileName, root))
          ? approve()
          : deny("OpenAgent only auto-approves writes inside the repo or session workspace.");
      }

      case "shell": {
        const shellRequest = request as ShellPermissionRequest;
        const fullCommandText = getStringField(shellRequest, "fullCommandText");

        if (!commandLooksSafe(fullCommandText, initialCwd)) {
          return deny("OpenAgent blocked a shell command that matched its dangerous-command policy.");
        }

        if (hasPossibleUrls(shellRequest.possibleUrls)) {
          return deny("OpenAgent does not auto-approve shell commands that may access external URLs.");
        }

        if (
          areAllPathsAllowed(shellRequest.possiblePaths, allowedRoots, initialCwd) ||
          hasReadOnlyCommands(shellRequest.commands)
        ) {
          return approve();
        }

        return deny(
          "OpenAgent only auto-approves repo-local shell commands or commands classified as read-only.",
        );
      }

      case "mcp": {
        const mcpRequest = request as McpPermissionRequest;
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
