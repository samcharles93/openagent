import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import * as path from "node:path";

const DEFAULT_MAX_DEPTH = 4;
const MAX_CONTEXT_CHARS = 6000;
const MAX_SINGLE_AGENT_CHARS = 2000;
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

type AgentContextFile = {
  source: string;
  content: string;
  truncated: boolean;
};

function formatRelativeDir(root: string, dir: string): string {
  const relative = path.relative(root, dir);
  return relative.length > 0 ? relative.replace(/\\/g, "/") : ".";
}

async function summarizeDirectory(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => !entry.name.startsWith("."))
      .slice(0, 8)
      .map((entry) => `${entry.isDirectory() ? "dir" : "file"}: ${entry.name}`);
  } catch {
    return [];
  }
}

async function collectDirectories(
  dir: string,
  depth: number,
  maxDepth: number,
  output: string[],
): Promise<void> {
  output.push(dir);
  if (depth >= maxDepth) {
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    await collectDirectories(path.join(dir, entry.name), depth + 1, maxDepth, output);
  }
}

function buildAgentsFileContent(args: {
  root: string;
  dir: string;
  sampleEntries: string[];
}): string {
  const relativeDir = formatRelativeDir(args.root, args.dir);
  const scopeLabel = relativeDir === "." ? "the repository root" : `\`${relativeDir}\``;
  const sampleSection =
    args.sampleEntries.length > 0
      ? args.sampleEntries.map((entry) => `- ${entry}`).join("\n")
      : "- No visible child entries at generation time";

  return [
    "# AGENTS.md",
    "",
    `This file applies to ${scopeLabel} and its descendants.`,
    "",
    "## Local guidance",
    "- Keep edits scoped to this subtree unless the change clearly crosses boundaries.",
    "- Reuse nearby patterns before introducing new abstractions.",
    "- Update tests, docs, and config in this subtree when behavior changes here.",
    "- Call out cross-directory dependencies explicitly when work spans beyond this scope.",
    "",
    "## Visible entries",
    sampleSection,
  ].join("\n");
}

export async function initializeDeepAgents(args: {
  cwd: string;
  maxDepth?: number;
  force?: boolean;
}): Promise<{
  root: string;
  written: string[];
  skipped: string[];
}> {
  const root = path.resolve(args.cwd);
  const maxDepth =
    typeof args.maxDepth === "number" && args.maxDepth >= 0
      ? Math.min(Math.floor(args.maxDepth), 8)
      : DEFAULT_MAX_DEPTH;
  const force = args.force === true;
  const directories: string[] = [];
  await collectDirectories(root, 0, maxDepth, directories);

  const written: string[] = [];
  const skipped: string[] = [];

  for (const dir of directories) {
    const agentFilePath = path.join(dir, "AGENTS.md");
    const relativeFilePath = formatRelativeDir(root, agentFilePath);
    if (!force && existsSync(agentFilePath)) {
      skipped.push(relativeFilePath);
      continue;
    }

    const sampleEntries = await summarizeDirectory(dir);
    await mkdir(dir, { recursive: true });
    await writeFile(
      agentFilePath,
      buildAgentsFileContent({ root, dir, sampleEntries }),
      "utf8",
    );
    written.push(relativeFilePath);
  }

  return { root, written, skipped };
}

async function tryReadAgentFile(filePath: string): Promise<AgentContextFile | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }

    const raw = await readFile(filePath, "utf8");
    const truncated = raw.length > MAX_SINGLE_AGENT_CHARS;
    return {
      source: filePath,
      content: truncated ? raw.slice(0, MAX_SINGLE_AGENT_CHARS) : raw,
      truncated,
    };
  } catch {
    return null;
  }
}

export async function loadAncestorAgentContext(args: {
  cwd: string;
  targetPath: string;
}): Promise<AgentContextFile[]> {
  const root = path.resolve(args.cwd);
  const absoluteTarget = path.resolve(root, args.targetPath);
  const relativeTarget = path.relative(root, absoluteTarget);

  if (relativeTarget.startsWith("..") || path.isAbsolute(relativeTarget)) {
    return [];
  }

  const targetDir = path.dirname(absoluteTarget);
  const files: AgentContextFile[] = [];
  let currentDir = targetDir;
  let totalChars = 0;

  while (true) {
    const candidate = path.join(currentDir, "AGENTS.md");
    if (candidate !== absoluteTarget) {
      const result = await tryReadAgentFile(candidate);
      if (result) {
        const nextLength = totalChars + result.content.length;
        if (nextLength > MAX_CONTEXT_CHARS) {
          break;
        }

        files.push({
          ...result,
          source: path.relative(root, candidate).replace(/\\/g, "/"),
        });
        totalChars = nextLength;
      }
    }

    if (currentDir === root) {
      break;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  return files.reverse();
}
