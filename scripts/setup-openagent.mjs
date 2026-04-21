#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function getDefaultBinDir(
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
) {
  if (platform === "win32") {
    const appData = env.APPDATA?.trim();
    return appData
      ? path.join(appData, "npm")
      : path.join(homeDir, "AppData", "Roaming", "npm");
  }

  return path.join(homeDir, ".local", "bin");
}

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
  const isWindows = process.platform === "win32";
  const wrapperFilename = isWindows ? "copilot-via-node.ps1" : "copilot-via-node.sh";
  const wrapperSource = path.join(scriptsDir, wrapperFilename);

  if (!existsSync(wrapperSource)) {
    process.stderr.write(`Warning: ${wrapperFilename} not found, skipping wrapper install.\n`);
    return;
  }

  const binDir = process.env.OPENAGENT_BIN_DIR?.trim() || getDefaultBinDir();
  mkdirSync(binDir, { recursive: true });

  if (isWindows) {
    const targetPath = path.join(binDir, "copilot-oa.ps1");
    copyFileSync(wrapperSource, targetPath);

    // Also create a .cmd shim so copilot-oa works from cmd.exe
    const cmdShimPath = path.join(binDir, "copilot-oa.cmd");
    const cmdShimContent = '@powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0copilot-oa.ps1" %*\r\n';
    writeFileSync(cmdShimPath, cmdShimContent, "utf8");

    process.stdout.write(
      [
        "",
        `Installed copilot-oa wrapper at ${targetPath}`,
        `Installed cmd shim at ${cmdShimPath}`,
        "Use 'copilot-oa' instead of 'copilot' to enable SDK extension support.",
        `Make sure ${binDir} is in your PATH.`,
        "",
      ].join("\n"),
    );
  } else {
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
