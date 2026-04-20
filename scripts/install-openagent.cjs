#!/usr/bin/env node

const { existsSync, mkdirSync, rmSync, writeFileSync } = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_REPO_URL = "https://github.com/samcharles93/oh-my-copilot.git";
const DEFAULT_BRANCH = "main";
const DEFAULT_INSTALL_ROOT = path.join(os.homedir(), ".copilot", "openagent");

function parseArgs(argv) {
  const parsed = {
    branch: DEFAULT_BRANCH,
    installRoot: process.env.OPENAGENT_INSTALL_ROOT?.trim()
      ? path.resolve(process.env.OPENAGENT_INSTALL_ROOT.trim())
      : DEFAULT_INSTALL_ROOT,
    repoUrl: process.env.OPENAGENT_REPO_URL?.trim() || DEFAULT_REPO_URL,
  };

  for (const arg of argv) {
    if (arg.startsWith("--branch=")) {
      const value = arg.slice("--branch=".length).trim();
      if (value) {
        parsed.branch = value;
      }
      continue;
    }

    if (arg.startsWith("--install-root=")) {
      const value = arg.slice("--install-root=".length).trim();
      if (value) {
        parsed.installRoot = path.resolve(value);
      }
      continue;
    }

    if (arg.startsWith("--repo-url=")) {
      const value = arg.slice("--repo-url=".length).trim();
      if (value) {
        parsed.repoUrl = value;
      }
    }
  }

  return parsed;
}

function resolveCommand(command) {
  if (process.platform === "win32" && command === "npm") {
    return "npm.cmd";
  }

  return command;
}

function run(command, args, options = {}) {
  const result = spawnSync(resolveCommand(command), args, {
    cwd: options.cwd,
    stdio: "inherit",
    env: options.env ?? process.env,
  });

  if (result.error) {
    throw new Error(`Failed to launch ${command}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with code ${result.status}`);
  }
}

function assertBinary(command, versionArgs = ["--version"]) {
  const result = spawnSync(resolveCommand(command), versionArgs, {
    stdio: "ignore",
    env: process.env,
  });

  if (result.error || result.status !== 0) {
    throw new Error(
      `OpenAgent installer requires \`${command}\` on PATH. Install it first, then rerun this command.`,
    );
  }
}

function main() {
  const { branch, installRoot, repoUrl } = parseArgs(process.argv.slice(2));
  const checkoutDir = path.join(installRoot, "repo");
  const metadataPath = path.join(installRoot, "install.json");

  assertBinary("git");
  assertBinary("npm");

  if (installRoot === path.parse(installRoot).root) {
    throw new Error("Refusing to install OpenAgent at the filesystem root.");
  }

  mkdirSync(installRoot, { recursive: true });

  if (existsSync(checkoutDir)) {
    rmSync(checkoutDir, { recursive: true, force: true });
  }

  run("git", ["clone", "--depth=1", "--branch", branch, repoUrl, checkoutDir]);
  run("npm", ["install", "--no-audit", "--no-fund", "--package-lock=false"], {
    cwd: checkoutDir,
  });
  run("npm", ["run", "setup:copilot", "--", "--force"], {
    cwd: checkoutDir,
    env: process.env,
  });

  const metadata = {
    installedAt: new Date().toISOString(),
    installRoot,
    checkoutDir,
    repoUrl,
    branch,
  };

  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

  process.stdout.write(
    [
      "",
      "OpenAgent is installed for GitHub Copilot CLI.",
      `Managed checkout: ${checkoutDir}`,
      `Copilot extension wrapper: ${path.join(process.env.COPILOT_EXTENSIONS_DIR || path.join(os.homedir(), ".copilot", "extensions"), "openagent")}`,
      "",
      "Next steps:",
      "1. Restart `copilot`, or run `/clear` in an existing session.",
      "2. Start using OpenAgent with `/oa-start <request>`.",
      "3. Re-run this installer any time you want to refresh the managed checkout.",
    ].join("\n"),
  );
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
