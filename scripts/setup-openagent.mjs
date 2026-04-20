#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function runNode(scriptPath, args) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Failed to launch ${scriptPath}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${path.basename(scriptPath)} exited with code ${result.status}`);
  }
}

function installNodeWrapper(scriptsDir) {
  const wrapperSource = path.join(scriptsDir, "copilot-via-node.sh");
  if (!existsSync(wrapperSource)) {
    process.stderr.write("Warning: copilot-via-node.sh not found, skipping wrapper install.\n");
    return;
  }

  const binDir = process.env.OPENAGENT_BIN_DIR?.trim()
    || path.join(os.homedir(), ".local", "bin");
  mkdirSync(binDir, { recursive: true });

  const targetPath = path.join(binDir, "copilot-oa");
  copyFileSync(wrapperSource, targetPath);
  chmodSync(targetPath, 0o755);

  process.stdout.write(
    [
      "",
      `Installed copilot-oa wrapper at ${targetPath}`,
      "Use 'copilot-oa' instead of 'copilot' to enable SDK extension support.",
      `Make sure ${binDir} is in your PATH.`,
      "",
    ].join("\n"),
  );
}

function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptsDir = path.dirname(scriptPath);
  const args = process.argv.slice(2);

  runNode(path.join(scriptsDir, "setup-copilot-extension.mjs"), args);
  runNode(path.join(scriptsDir, "setup-copilot-agents.mjs"), args);
  installNodeWrapper(scriptsDir);
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
