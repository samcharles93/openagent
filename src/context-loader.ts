import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import * as path from "node:path";
import { formatSkillsForPrompt, loadSkills } from "./skill-loader";

const MAX_SINGLE_FILE_CHARS = 4000;
const README_TRUNCATE_CHARS = 2000;
const TOTAL_CONTEXT_BUDGET = 12000;

export type ProjectContextFile = {
  source: string;
  content: string;
  truncated: boolean;
};

export type ProjectContextResult = {
  files: ProjectContextFile[];
  totalChars: number;
  summary: string;
};

async function tryReadFile(
  filePath: string,
  maxChars: number,
): Promise<{ content: string; truncated: boolean } | null> {
  try {
    if (!existsSync(filePath)) {
      return null;
    }
    const raw = await readFile(filePath, "utf-8");
    if (raw.length > maxChars) {
      return { content: raw.slice(0, maxChars), truncated: true };
    }
    return { content: raw, truncated: false };
  } catch {
    return null;
  }
}

async function discoverRuleFiles(cwd: string): Promise<string[]> {
  const rulesDir = path.join(cwd, ".openagent", "rules");
  try {
    if (!existsSync(rulesDir)) {
      return [];
    }
    const entries = await readdir(rulesDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort()
      .map((name) => path.join(".openagent", "rules", name));
  } catch {
    return [];
  }
}

export function formatProjectContext(files: ProjectContextFile[]): string {
  const parts = files.map(
    (f) =>
      `--- ${f.source} ---\n${f.content}\n--- end ${f.source} ---`,
  );
  return `<openagent_project_context>\n${parts.join("\n\n")}\n</openagent_project_context>`;
}

export async function loadProjectContext(
  cwd: string,
): Promise<ProjectContextResult> {
  const candidates: Array<{ relativePath: string; maxChars: number }> = [];

  // 1. AGENTS.md
  candidates.push({ relativePath: "AGENTS.md", maxChars: MAX_SINGLE_FILE_CHARS });

  // 2. README.md (first 2000 chars)
  candidates.push({ relativePath: "README.md", maxChars: README_TRUNCATE_CHARS });

  // 3. .openagent/rules/*.md (sorted alphabetically)
  const ruleFiles = await discoverRuleFiles(cwd);
  for (const rel of ruleFiles) {
    candidates.push({ relativePath: rel, maxChars: MAX_SINGLE_FILE_CHARS });
  }

  // 4. .github/copilot-instructions.md
  candidates.push({
    relativePath: path.join(".github", "copilot-instructions.md"),
    maxChars: MAX_SINGLE_FILE_CHARS,
  });

  const files: ProjectContextFile[] = [];
  let totalChars = 0;

  for (const candidate of candidates) {
    const fullPath = path.join(cwd, candidate.relativePath);
    const result = await tryReadFile(fullPath, candidate.maxChars);
    if (!result) {
      continue;
    }

    if (totalChars + result.content.length > TOTAL_CONTEXT_BUDGET) {
      break;
    }

    files.push({
      source: candidate.relativePath,
      content: result.content,
      truncated: result.truncated,
    });
    totalChars += result.content.length;
  }

  // Load skills and add formatted summary if any found and budget allows
  const skills = await loadSkills(cwd);
  if (skills.length > 0) {
    const skillsSection = formatSkillsForPrompt(skills);
    if (totalChars + skillsSection.length <= TOTAL_CONTEXT_BUDGET) {
      files.push({
        source: "openagent-skills",
        content: skillsSection,
        truncated: false,
      });
      totalChars += skillsSection.length;
    }
  }

  const summary =
    files.length === 0
      ? "No project context files found."
      : `Loaded ${files.length} context files (${totalChars} chars): ${files.map((f) => f.source).join(", ")}`;

  return { files, totalChars, summary };
}
