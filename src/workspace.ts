import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";

export type OpenAgentWorkspacePaths = {
  workspacePath: string;
  notesRoot: string;
  routingRoot: string;
  handoffsRoot: string;
  routeStateFile: string;
};

export function isOpenAgentWorkspaceAvailable(session: CopilotSession): boolean {
  return typeof session.workspacePath === "string" && session.workspacePath.length > 0;
}

export function formatOpenAgentWorkspaceRequirement(action: string): string {
  return `${action} requires the session workspace because OpenAgent persists durable handoffs and notes under files/openagent/.`;
}

export function requireOpenAgentWorkspacePath(
  session: CopilotSession,
  action = "This action",
): string {
  const { workspacePath } = session;
  if (typeof workspacePath !== "string" || workspacePath.length === 0) {
    throw new Error(formatOpenAgentWorkspaceRequirement(action));
  }

  return workspacePath;
}

export function normalizeOpenAgentRelativePath(rawPath: string): string {
  const normalized = rawPath
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (normalized.length === 0 || normalized.some((segment) => segment === "..")) {
    throw new Error("Workspace note path must stay inside the OpenAgent notes directory.");
  }

  const joined = normalized.join("/");
  return path.posix.extname(joined).length > 0 ? joined : `${joined}.md`;
}

export function getOpenAgentWorkspacePaths(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): OpenAgentWorkspacePaths {
  const { session, config } = args;
  const workspacePath = requireOpenAgentWorkspacePath(session);
  const notesRoot = path.join(
    workspacePath,
    "files",
    ...config.workspace.notesDirectory.split("/"),
  );

  return {
    workspacePath,
    notesRoot,
    routingRoot: path.join(notesRoot, "routing"),
    handoffsRoot: path.join(notesRoot, "routing", "handoffs"),
    routeStateFile: path.join(notesRoot, "routing", "route-state.json"),
  };
}

export async function writeOpenAgentWorkspaceNote(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  relativePath: string;
  content: string;
  mode?: "append" | "replace";
}): Promise<{
  fullPath: string;
  workspaceRelativePath: string;
  nextContent: string;
}> {
  const { session, config, content } = args;
  const fileMode = args.mode === "replace" ? "replace" : "append";
  const relativePath = normalizeOpenAgentRelativePath(args.relativePath);
  const paths = getOpenAgentWorkspacePaths({ session, config });
  const fullPath = path.join(paths.notesRoot, ...relativePath.split("/"));

  await mkdir(path.dirname(fullPath), { recursive: true });

  let nextContent = content;
  if (fileMode === "append" && existsSync(fullPath)) {
    const current = await readFile(fullPath, "utf8");
    nextContent = `${current.trimEnd()}\n\n${content}`;
  }

  await writeFile(fullPath, nextContent, "utf8");

  return {
    fullPath,
    workspaceRelativePath: path.relative(paths.workspacePath, fullPath),
    nextContent,
  };
}
