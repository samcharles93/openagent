import { spawnSync } from "node:child_process";
import type { CopilotSession } from "@github/copilot-sdk";
import {
  resolveBundledAstGrepBinary,
  resolveBundledCopilotCliPath,
} from "./bundled-deps";
import type { OpenAgentConfig, OpenAgentConfigResolution } from "./config";
import { formatConfigSummary } from "./config";
import { recordContinuousImprovementArtifact } from "./continuous-improvement";
import {
  formatOpenAgentRoutingStatus,
} from "./routing";
import {
  isOpenAgentWorkspaceAvailable,
  writeOpenAgentWorkspaceNote,
} from "./workspace";

type BinaryCheck = {
  name: string;
  path: string | null;
};

export type OpenAgentDoctorResult = {
  report: string;
  reportWorkspacePath: string | null;
  improvementWorkspacePath: string | null;
  improvementMemoryPath: string;
};

export function getBinaryLookupCommand(
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === "win32" ? "where.exe" : "which";
}

export function parseBinaryLookupOutput(stdout: string): string | null {
  return (
    stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? null
  );
}

function checkBinary(name: string): BinaryCheck {
  const result = spawnSync(getBinaryLookupCommand(), [name], { encoding: "utf8" });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { name, path: null };
    }
    throw result.error;
  }

  const resolvedPath =
    result.status === 0 ? parseBinaryLookupOutput(result.stdout) : null;
  return {
    name,
    path: resolvedPath,
  };
}

function formatBinaryLine(check: BinaryCheck): string {
  return `- ${check.name}: ${check.path ?? "missing"}`;
}

export async function runOpenAgentDoctor(args: {
  session: CopilotSession;
  cwd: string;
  resolution: OpenAgentConfigResolution;
  writeReport?: boolean;
}): Promise<OpenAgentDoctorResult> {
  const { session, cwd, resolution } = args;
  const shouldWriteReport = args.writeReport !== false;
  const [mode, model, agent, plan, routingStatus] = await Promise.all([
    session.rpc.mode.get(),
    session.rpc.model.getCurrent(),
    session.rpc.agent.getCurrent(),
    session.rpc.plan.read(),
    formatOpenAgentRoutingStatus({
      session,
      config: resolution.config,
    }),
  ]);

  const binaryChecks = [
    "node",
    "npm",
    "git",
    "rg",
    "gh",
    "ast-grep",
    "tsserver",
    "typescript-language-server",
    "pdftotext",
    "pdfinfo",
    "identify",
    "file",
  ].map(checkBinary);
  const bundledChecks: BinaryCheck[] = [
    {
      name: "bundled ast-grep",
      path: resolveBundledAstGrepBinary(),
    },
    {
      name: "bundled copilot cli",
      path: resolveBundledCopilotCliPath(),
    },
  ];
  const missingBinaryNames = binaryChecks
    .filter((check) => {
      if (check.name === "ast-grep") {
        return check.path === null && bundledChecks[0].path === null;
      }
      return check.path === null;
    })
    .map((check) => check.name);

  const report = [
    "# OpenAgent doctor report",
    "",
    `cwd: ${cwd}`,
    `workspace path: ${session.workspacePath ?? "disabled"}`,
    `current mode: ${mode}`,
    `current model: ${model.modelId ?? "host default"}`,
    `current agent: ${agent.agent?.name ?? "host default"}`,
    `plan path: ${plan.path ?? "not available"}`,
    `plan exists: ${plan.exists ? "yes" : "no"}`,
    "",
    "## Config",
    formatConfigSummary(resolution),
    "",
    "## Routing",
    routingStatus,
    "",
    "## Binary checks",
    ...binaryChecks.map(formatBinaryLine),
    "",
    "## Bundled runtimes",
    ...bundledChecks.map(formatBinaryLine),
  ].join("\n");

  let reportWorkspacePath: string | null = null;
  if (shouldWriteReport && isOpenAgentWorkspaceAvailable(session)) {
    const note = await writeOpenAgentWorkspaceNote({
      session,
      config: resolution.config,
      relativePath: `doctor/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
      content: report,
      mode: "replace",
    });
    reportWorkspacePath = note.workspaceRelativePath;
  }

  const improvement = await recordContinuousImprovementArtifact({
    cwd,
    source: "doctor",
    title: "Doctor follow-up candidate",
    summary:
      missingBinaryNames.length > 0
        ? `Doctor found missing local binaries: ${missingBinaryNames.join(", ")}. Promote stable setup guidance if these tools are routinely expected in this repo.`
        : "Doctor completed without missing binary checks. If doctor output reveals recurring config or workflow confusion, promote that guidance into rules or AGENTS.",
    evidence: [
      `Report path: ${reportWorkspacePath ?? "not written to workspace"}`,
      `Current mode: ${mode}`,
      `Current agent: ${agent.agent?.name ?? "host default"}`,
    ],
    recommendations: [
      missingBinaryNames.length > 0
        ? `Decide whether ${missingBinaryNames.join(", ")} should be documented in repo guidance.`
        : "Review whether any config, routing, or environment advice should become durable repo guidance.",
      "Promote repeated setup guidance into `.openagent/rules/*.md` before relying on repeated doctor runs.",
    ],
    session,
    config: resolution.config,
  });

  return {
    report,
    reportWorkspacePath,
    improvementWorkspacePath: improvement.workspaceRelativePath,
    improvementMemoryPath: improvement.memoryRelativePath,
  };
}
