import { spawnSync } from "node:child_process";
import * as path from "node:path";
import { resolveBundledAstGrepBinary } from "./bundled-deps.js";

const DEFAULT_AST_GREP_BINARY = "ast-grep";

export type OpenAgentAstSearchResult = {
  command: string;
  stdout: string;
  stderr: string;
  status: number;
};

export type OpenAgentAstReplaceResult = OpenAgentAstSearchResult & {
  applied: boolean;
};

function resolvePaths(cwd: string, pathsToSearch?: string[]): string[] {
  if (!pathsToSearch || pathsToSearch.length === 0) {
    return [cwd];
  }

  return pathsToSearch.map((target) =>
    path.isAbsolute(target) ? target : path.resolve(cwd, target),
  );
}

function runAstGrep(args: {
  cwd: string;
  binary?: string;
  pattern: string;
  rewrite?: string;
  language?: string;
  globs?: string[];
  paths?: string[];
  apply?: boolean;
  json?: boolean;
}): OpenAgentAstSearchResult {
  const binary =
    args.binary?.trim() || resolveBundledAstGrepBinary() || DEFAULT_AST_GREP_BINARY;
  const commandArgs = ["run", "--pattern", args.pattern];

  if (args.rewrite) {
    commandArgs.push("--rewrite", args.rewrite);
    if (args.apply) {
      commandArgs.push("--update-all");
    }
  }
  if (args.language) {
    commandArgs.push("--lang", args.language);
  }
  for (const glob of args.globs ?? []) {
    commandArgs.push("--globs", glob);
  }
  if (args.json) {
    commandArgs.push("--json=stream");
  }

  commandArgs.push(...resolvePaths(args.cwd, args.paths));
  const result = spawnSync(binary, commandArgs, {
    cwd: args.cwd,
    encoding: "utf8",
  });

  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `OpenAgent could not find a bundled or PATH-visible ast-grep binary. Tried "${binary}".`,
      );
    }
    throw result.error;
  }

  return {
    command: `${binary} ${commandArgs.join(" ")}`,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    status: result.status ?? 1,
  };
}

export function runOpenAgentAstSearch(args: {
  cwd: string;
  pattern: string;
  language?: string;
  globs?: string[];
  paths?: string[];
  json?: boolean;
}): OpenAgentAstSearchResult {
  return runAstGrep({
    cwd: args.cwd,
    pattern: args.pattern,
    language: args.language,
    globs: args.globs,
    paths: args.paths,
    json: args.json,
  });
}

export function runOpenAgentAstReplace(args: {
  cwd: string;
  pattern: string;
  rewrite: string;
  language?: string;
  globs?: string[];
  paths?: string[];
  apply?: boolean;
}): OpenAgentAstReplaceResult {
  const result = runAstGrep({
    cwd: args.cwd,
    pattern: args.pattern,
    rewrite: args.rewrite,
    language: args.language,
    globs: args.globs,
    paths: args.paths,
    apply: args.apply,
  });

  return {
    ...result,
    applied: args.apply === true,
  };
}
