#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  let force = false;
  let targetDir;

  for (const arg of argv) {
    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg.startsWith("--agents-dir=")) {
      const value = arg.slice("--agents-dir=".length).trim();
      if (value.length > 0) {
        targetDir = path.resolve(value);
      }
    }
  }

  return { force, targetDir };
}

function getDefaultAgentsDir() {
  const configuredDir = process.env.COPILOT_AGENTS_DIR?.trim();
  if (configuredDir) {
    return path.resolve(configuredDir);
  }

  return path.join(os.homedir(), ".copilot", "agents");
}

function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "..");
  const sourceDir = path.join(repoRoot, ".github", "agents");
  const { force, targetDir } = parseArgs(process.argv.slice(2));
  const agentsDir = targetDir ?? getDefaultAgentsDir();

  if (!existsSync(sourceDir)) {
    throw new Error(`OpenAgent native agent profiles are missing: ${sourceDir}`);
  }

  mkdirSync(agentsDir, { recursive: true });

  const agentFiles = readdirSync(sourceDir)
    .filter((name) => name.endsWith(".agent.md"))
    .sort();
  const installed = [];
  const skipped = [];

  for (const name of agentFiles) {
    const sourcePath = path.join(sourceDir, name);
    const targetPath = path.join(agentsDir, name);
    const content = readFileSync(sourcePath, "utf8");

    if (existsSync(targetPath) && !force && readFileSync(targetPath, "utf8") !== content) {
      skipped.push(name);
      continue;
    }

    writeFileSync(targetPath, content, "utf8");
    installed.push(name);
  }

  process.stdout.write(
    [
      `Installed OpenAgent native custom agents into ${agentsDir}.`,
      installed.length > 0 ? `Installed: ${installed.join(", ")}` : "Installed: none",
      skipped.length > 0
        ? `Skipped existing customized files: ${skipped.join(", ")}`
        : "Skipped existing customized files: none",
      "",
      "Copilot CLI and VS Code discover user custom agents from ~/.copilot/agents.",
      "Restart Copilot CLI and reload VS Code windows to pick up changes.",
    ].join("\n") + "\n",
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
