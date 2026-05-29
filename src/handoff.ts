import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentAgentName, OpenAgentConfig } from "./config";
import {
  getOpenAgentWorkspacePaths,
  requireOpenAgentWorkspacePath,
  writeOpenAgentWorkspaceNote,
} from "./workspace";
import {
  inferOpenAgentPhase,
  readOpenAgentRouteState,
  type OpenAgentMode,
  type OpenAgentPhase,
} from "./routing";

export type OpenAgentHandoffArtifact = {
  version: 2;
  createdAt: string;
  requestedBy: string;
  fromPhase: OpenAgentPhase;
  fromAgent: OpenAgentAgentName;
  fromMode: OpenAgentMode;
  toPhase: OpenAgentPhase;
  toAgent: OpenAgentAgentName;
  goal: string;
  workDone: string[];
  openRisks: string[];
  nextSteps: string[];
  touchedFiles: string[];
  refs: string[];
  latestHandoffPath: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
}

function sanitizeArtifact(value: unknown): OpenAgentHandoffArtifact | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    value.version !== 2 ||
    typeof value.createdAt !== "string" ||
    typeof value.requestedBy !== "string" ||
    typeof value.fromPhase !== "string" ||
    typeof value.fromAgent !== "string" ||
    typeof value.fromMode !== "string" ||
    typeof value.toPhase !== "string" ||
    typeof value.toAgent !== "string" ||
    typeof value.goal !== "string"
  ) {
    return null;
  }

  return {
    version: 2,
    createdAt: value.createdAt,
    requestedBy: value.requestedBy,
    fromPhase: value.fromPhase as OpenAgentPhase,
    fromAgent: value.fromAgent as OpenAgentAgentName,
    fromMode: value.fromMode as OpenAgentMode,
    toPhase: value.toPhase as OpenAgentPhase,
    toAgent: value.toAgent as OpenAgentAgentName,
    goal: value.goal,
    workDone: normalizeStringArray(value.workDone),
    openRisks: normalizeStringArray(value.openRisks),
    nextSteps: normalizeStringArray(value.nextSteps),
    touchedFiles: normalizeStringArray(value.touchedFiles),
    refs: normalizeStringArray(value.refs),
    latestHandoffPath:
      typeof value.latestHandoffPath === "string" ? value.latestHandoffPath : null,
  };
}

function toBullets(lines: string[]): string {
  return lines.map((line) => `- ${line}`).join("\n");
}

function formatOptionalSection(title: string, lines: string[]): string[] {
  return lines.length > 0 ? ["", title, toBullets(lines)] : [];
}

export function buildOpenAgentResumeHandoff(
  artifact: OpenAgentHandoffArtifact,
  extraContext?: string,
): string {
  return [
    "Resume this handoff artifact exactly as the durable source of truth.",
    "",
    `Created at: ${artifact.createdAt}`,
    `Requested by: ${artifact.requestedBy}`,
    `From: ${artifact.fromPhase} / ${artifact.fromAgent} / ${artifact.fromMode}`,
    `To: ${artifact.toPhase} / ${artifact.toAgent}`,
    "",
    "## Goal",
    artifact.goal,
    ...formatOptionalSection("## Work done", artifact.workDone),
    ...formatOptionalSection("## Open risks", artifact.openRisks),
    ...formatOptionalSection("## Next steps", artifact.nextSteps),
    ...formatOptionalSection("## Touched files", artifact.touchedFiles),
    ...formatOptionalSection("## References", artifact.refs),
    ...(extraContext && extraContext.trim().length > 0
      ? ["", "## Resume note", extraContext.trim()]
      : []),
  ].join("\n");
}

export async function writeOpenAgentHandoffArtifact(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  targetAgent: OpenAgentAgentName;
  goal: string;
  requestedBy: string;
  nextStep?: string;
  fromPhase?: OpenAgentPhase;
  fromAgent?: OpenAgentAgentName;
  fromMode?: OpenAgentMode;
  workDone?: string[];
  openRisks?: string[];
  touchedFiles?: string[];
  refs?: string[];
  latestHandoffPath?: string | null;
  /** When true, validation errors throw instead of being embedded as warnings. Default true. */
  enforceValidation?: boolean;
}): Promise<{
  artifact: OpenAgentHandoffArtifact;
  workspaceRelativePath: string;
  validationErrors: string[];
  validationWarnings: string[];
}> {
  requireOpenAgentWorkspacePath(args.session, "OpenAgent handoff");
  const [agentResult, modeResult, planResult, routeState] = await Promise.all([
    args.session.rpc.agent.getCurrent(),
    args.session.rpc.mode.get(),
    args.session.rpc.plan.read(),
    readOpenAgentRouteState({
      session: args.session,
      config: args.config,
    }),
  ]);

  const fromAgent = (args.fromAgent ??
    routeState?.currentAgent ??
    agentResult.agent?.name ??
    "conductor") as OpenAgentAgentName;
  const fromPhase = args.fromPhase ?? routeState?.currentPhase ?? inferOpenAgentPhase(fromAgent);
  const fromMode = (args.fromMode ?? routeState?.currentMode ?? modeResult ?? "interactive") as OpenAgentMode;
  const latestHandoffPath = args.latestHandoffPath ?? routeState?.latestHandoffPath ?? null;
  const toPhase = inferOpenAgentPhase(args.targetAgent);

  // ── Handoff validation gate ──────────────────────────────────────────
  const validationErrors: string[] = [];
  const validationWarnings: string[] = [];

  // Builder → conductor: must show verification evidence
  if (fromAgent === "builder" && args.targetAgent === "conductor") {
    const workDoneRaw = args.workDone ?? [];
    const workDoneText = workDoneRaw.join(" ").toLowerCase();
    const hasVerification =
      /build|compile|test|lint|verify|check|pass/i.test(workDoneText) ||
      workDoneRaw.some((line) => /^(?:✓|✅|PASS|OK|SUCCESS)/.test(line));

    if (!hasVerification) {
      const msg =
        "Builder → Conductor handoff requires build/test verification evidence in workDone. " +
        "Add build results, test output, or verification steps before handing off.";
      if (args.enforceValidation !== false) {
        throw new Error(msg);
      }
      validationErrors.push(msg);
    }
  }

  // Leaving implementer phase with no touched files
  if (fromPhase === "implementer" && (args.touchedFiles ?? []).length === 0) {
    validationWarnings.push(
      "Handoff from implementer phase with zero touched files — verify that implementation work was actually performed.",
    );
  }

  // Empty workDone
  if ((args.workDone ?? []).length === 0) {
    validationWarnings.push(
      "Handoff with empty workDone — add at least one entry describing what was accomplished.",
    );
  }

  const artifact: OpenAgentHandoffArtifact = {
    version: 2,
    createdAt: new Date().toISOString(),
    requestedBy: args.requestedBy,
    fromPhase,
    fromAgent,
    fromMode,
    toPhase,
    toAgent: args.targetAgent,
    goal: args.goal.trim(),
    workDone:
      args.workDone && args.workDone.length > 0
        ? args.workDone
        : [
            `Current phase before handoff: ${fromPhase}`,
            `Current agent before handoff: ${fromAgent}`,
            ...(planResult.path ? [`Active plan: ${planResult.path}`] : []),
            ...(latestHandoffPath ? [`Latest handoff note: ${latestHandoffPath}`] : []),
          ],
    openRisks: args.openRisks ?? [],
    nextSteps: [args.nextStep?.trim() || `Continue the current work as ${args.targetAgent}.`],
    touchedFiles: args.touchedFiles ?? [],
    refs:
      args.refs && args.refs.length > 0
        ? args.refs
        : [
            ...(planResult.path ? [planResult.path] : []),
            ...(latestHandoffPath ? [latestHandoffPath] : []),
          ],
    latestHandoffPath,
  };

  const note = await writeOpenAgentWorkspaceNote({
    session: args.session,
    config: args.config,
    relativePath: `handoffs/${artifact.createdAt.replace(/[:.]/g, "-")}-${args.targetAgent}.json`,
    content: JSON.stringify(artifact, null, 2),
    mode: "replace",
  });

  return {
    artifact,
    workspaceRelativePath: note.workspaceRelativePath,
    validationErrors,
    validationWarnings,
  };
}

export async function readOpenAgentHandoffArtifact(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  cwd: string;
  artifactPath: string;
}): Promise<OpenAgentHandoffArtifact> {
  const workspacePath = requireOpenAgentWorkspacePath(args.session, "OpenAgent resume handoff");
  const workspacePaths = getOpenAgentWorkspacePaths({
    session: args.session,
    config: args.config,
  });

  const candidates = [
    args.artifactPath,
    path.resolve(args.cwd, args.artifactPath),
    path.resolve(workspacePath, args.artifactPath),
    path.resolve(workspacePath, "files", args.artifactPath),
    path.resolve(workspacePaths.notesRoot, args.artifactPath),
  ];

  const resolvedPath = candidates.find((candidate) => existsSync(candidate));
  if (!resolvedPath) {
    throw new Error(`Could not find handoff artifact "${args.artifactPath}".`);
  }

  const raw = await readFile(resolvedPath, "utf8");
  const parsed = sanitizeArtifact(JSON.parse(raw) as unknown);
  if (!parsed) {
    throw new Error(`"${resolvedPath}" is not a valid OpenAgent handoff v2 artifact.`);
  }

  return parsed;
}
