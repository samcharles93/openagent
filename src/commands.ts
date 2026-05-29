import { existsSync } from "node:fs";
import * as path from "node:path";
import type { CommandDefinition, CopilotSession } from "@github/copilot-sdk";
import { selectOpenAgentAgent } from "./agent-selection";
import { initializeDeepAgents } from "./agents-md";
import {
  bootstrapOpenAgentTask,
  formatOpenAgentBootstrapResult,
} from "./bootstrap";
import {
  loadCustomCommands,
  renderCustomCommandPrompt,
} from "./command-loader";
import {
  OPENAGENT_AGENT_NAMES,
  formatConfigSummary,
  isOpenAgentAgentName,
  loadOpenAgentConfig,
  type OpenAgentAgentName,
} from "./config";
import { runOpenAgentDoctor } from "./doctor";
import {
  buildOpenAgentResumeHandoff,
  readOpenAgentHandoffArtifact,
  writeOpenAgentHandoffArtifact,
} from "./handoff";
import {
  buildOpenAgentLoopPrompt,
  clearOpenAgentLoopState,
  writeOpenAgentLoopState,
} from "./loop-state";
import { buildOpenAgentLookAtPrompt } from "./look-at";
import {
  formatOpenAgentPlanReviewResult,
  startPlanReviewWorkflow,
} from "./plan-review";
import {
  formatOpenAgentReviewWorkflowResult,
  startOpenAgentReviewWorkflow,
} from "./review-workflow";
import {
  formatOpenAgentRoutingStatus,
  inferOpenAgentPhase,
  isOpenAgentPhase,
  listOpenAgentPhases,
  routeOpenAgentPhase,
} from "./routing";
import { formatOpenAgentCompactionStatus } from "./compaction";
import {
  formatOpenAgentTelemetry,
  recordLookAtInvocation,
  recordLoopCancel,
  recordLoopStart,
} from "./telemetry";
import {
  formatOpenAgentWorkspaceRequirement,
  isOpenAgentWorkspaceAvailable,
} from "./workspace";

type SessionGetter = () => CopilotSession;

export function parseInitDeepArgs(rawArgs: string): {
  force: boolean;
  maxDepth?: number;
} {
  const args = rawArgs.trim().split(/\s+/).filter((part) => part.length > 0);
  let force = false;
  let maxDepth: number | undefined;

  for (const arg of args) {
    if (arg === "--force") {
      force = true;
      continue;
    }

    const match = arg.match(/^--max-depth=(\d+)$/);
    if (match) {
      maxDepth = Number(match[1]);
    }
  }

  return { force, maxDepth };
}

export function parseRouteCommandArgs(rawArgs: string): {
  phase: string;
  objective: string;
  handoff: string;
} | null {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("|");
  const left = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const right = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
  const [phase, ...objectiveParts] = left.split(/\s+/);
  const objective = objectiveParts.join(" ").trim();

  if (!phase || !objective) {
    return null;
  }

  return {
    phase,
    objective,
    handoff: right.length > 0 ? right : objective,
  };
}

export function parseLoopCommandArgs(rawArgs: string): {
  goal: string;
  maxIterations: number;
} | null {
  const parts = rawArgs.trim().split(/\s+/).filter((part) => part.length > 0);
  if (parts.length === 0) {
    return null;
  }

  let maxIterations = 8;
  const goalParts: string[] = [];

  for (const part of parts) {
    const match = part.match(/^--max-iterations=(\d+)$/);
    if (match) {
      maxIterations = Math.min(Math.max(Number(match[1]), 1), 25);
      continue;
    }

    goalParts.push(part);
  }

  const goal = goalParts.join(" ").trim();
  return goal.length > 0 ? { goal, maxIterations } : null;
}

export function parseLookAtCommandArgs(rawArgs: string): {
  file: string;
  prompt?: string;
} | null {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return null;
  }

  const separatorIndex = trimmed.indexOf("|");
  const left = separatorIndex >= 0 ? trimmed.slice(0, separatorIndex).trim() : trimmed;
  const right = separatorIndex >= 0 ? trimmed.slice(separatorIndex + 1).trim() : "";
  if (!left) {
    return null;
  }

  return {
    file: left,
    prompt: right.length > 0 ? right : undefined,
  };
}

export function parseStartCommandArgs(rawArgs: string): {
  request?: string;
  resumePath?: string;
  resumeNote?: string;
} {
  const trimmed = rawArgs.trim();
  if (!trimmed) {
    return {};
  }

  const parts = trimmed.split(/\s+/);
  const first = parts[0];
  if (first === "--resume" || first.startsWith("--resume=")) {
    const resumePath =
      first === "--resume" ? parts[1] : first.slice("--resume=".length).trim();
    const consumed = first === "--resume" ? 2 : 1;
    const resumeNote = parts.slice(consumed).join(" ").trim();
    return {
      resumePath: resumePath && resumePath.length > 0 ? resumePath : undefined,
      resumeNote: resumeNote.length > 0 ? resumeNote : undefined,
    };
  }

  return {
    request: trimmed,
  };
}

export function createCommands(args: {
  getSession: SessionGetter;
  initialCwd: string;
}): CommandDefinition[] {
  const { getSession, initialCwd } = args;
  const cwd = process.cwd() || initialCwd;
  const customCommands = loadCustomCommands(cwd);

  const allCommands: CommandDefinition[] = [
    {
      name: "oa-init-deep",
      description: "Generate AGENTS.md files across the repo and its key subdirectories.",
      handler: async (context) => {
        const session = getSession();
        const cwd = process.cwd() || initialCwd;
        const parsedArgs = parseInitDeepArgs(context.args);
        const result = await initializeDeepAgents({
          cwd,
          force: parsedArgs.force,
          maxDepth: parsedArgs.maxDepth,
        });

        await session.log(
          [
            "OpenAgent generated hierarchical AGENTS.md files.",
            `Root: ${result.root}`,
            `Written: ${result.written.length}`,
            `Skipped existing: ${result.skipped.length}`,
            result.written.length > 0 ? `Files: ${result.written.join(", ")}` : "Files: none",
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-loop",
      description: "Start a continuation loop that keeps sending follow-up turns until the goal is done.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent loop"), {
            level: "warning",
          });
          return;
        }

        const parsedArgs = parseLoopCommandArgs(context.args);
        if (!parsedArgs) {
          await session.log("Usage: /oa-loop [--max-iterations=N] <goal>", {
            level: "warning",
          });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const timestamp = new Date().toISOString();
        await writeOpenAgentLoopState({
          session,
          config: resolution.config,
          state: {
            goal: parsedArgs.goal,
            iterations: 0,
            maxIterations: parsedArgs.maxIterations,
            active: true,
            startedAt: timestamp,
            updatedAt: timestamp,
          },
        });

        recordLoopStart();
        await session.log(
          `OpenAgent started /oa-loop for "${parsedArgs.goal}" with a ${parsedArgs.maxIterations}-iteration cap.`,
        );
        await session.send({
          prompt: buildOpenAgentLoopPrompt({
            goal: parsedArgs.goal,
            iterations: 0,
            maxIterations: parsedArgs.maxIterations,
          }),
        });
      },
    },
    {
      name: "oa-loop-cancel",
      description: "Cancel the active OpenAgent continuation loop for this session.",
      handler: async () => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent loop cancel"), {
            level: "warning",
          });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        await clearOpenAgentLoopState({
          session,
          config: resolution.config,
        });
        recordLoopCancel();
        await session.log("OpenAgent cancelled the active continuation loop.");
      },
    },
    {
      name: "oa-doctor",
      description: "Inspect OpenAgent config, routing state, and local tool availability.",
      handler: async () => {
        const session = getSession();
        const cwd = process.cwd() || initialCwd;
        const resolution = loadOpenAgentConfig(cwd);
        const result = await runOpenAgentDoctor({
          session,
          cwd,
          resolution,
          writeReport: true,
        });

        await session.log(
          [
            result.report,
            "",
            `Saved report: ${result.reportWorkspacePath ?? "not written to workspace"}`,
            `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
            `Improvement memory: ${result.improvementMemoryPath}`,
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-status",
      description: "Show OpenAgent runtime configuration and session state.",
      handler: async () => {
        const session = getSession();
        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const [mode, model, agent, routingStatus] = await Promise.all([
          session.rpc.mode.get(),
          session.rpc.model.getCurrent(),
          session.rpc.agent.getCurrent(),
          formatOpenAgentRoutingStatus({
            session,
            config: resolution.config,
          }),
        ]);

        await session.log(
          [
            "OpenAgent status",
            formatConfigSummary(resolution),
            `mode: ${mode}`,
            `model: ${model.modelId ?? "host default"}`,
            `agent: ${agent.agent?.name ?? "host default"}`,
            `workspace path: ${session.workspacePath ?? "disabled"}`,
            "",
            routingStatus,
            "",
            formatOpenAgentCompactionStatus(),
            "",
            formatOpenAgentTelemetry(),
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-plan",
      description: "Switch the current session to plan mode.",
      handler: async () => {
        const session = getSession();
        await session.rpc.mode.set({ mode: "plan" });
        await session.log("OpenAgent switched the current session to plan mode.");
      },
    },
    {
      name: "oa-autopilot",
      description: "Switch the current session to autopilot mode.",
      handler: async () => {
        const session = getSession();
        await session.rpc.mode.set({ mode: "autopilot" });
        await session.log("OpenAgent switched the current session to autopilot mode.");
      },
    },
    {
      name: "oa-agent",
      description: "Select an OpenAgent custom agent by name.",
      handler: async (context) => {
        const session = getSession();
        const requestedAgent = context.args.trim();

        if (!requestedAgent) {
          await session.log(
            `Choose one of: ${OPENAGENT_AGENT_NAMES.join(", ")}`,
            { level: "warning" },
          );
          return;
        }

        if (!isOpenAgentAgentName(requestedAgent)) {
          await session.log(
            `Unknown OpenAgent agent "${requestedAgent}". Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`,
            { level: "warning" },
          );
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await selectOpenAgentAgent({
          session,
          agentName: requestedAgent,
          config: resolution.config,
        });
        await session.log(`OpenAgent selected ${result.agent.displayName}.`);
      },
    },
    {
      name: "oa-look-at",
      description: "Attach an image, PDF, or file to the active session for direct inspection.",
      handler: async (context) => {
        const session = getSession();
        const parsedArgs = parseLookAtCommandArgs(context.args);
        if (!parsedArgs) {
          await session.log("Usage: /oa-look-at <file> [| question]", { level: "warning" });
          return;
        }

        const cwd = process.cwd() || initialCwd;
        const filePath = path.isAbsolute(parsedArgs.file)
          ? parsedArgs.file
          : path.resolve(cwd, parsedArgs.file);
        if (!existsSync(filePath)) {
          await session.log(`OpenAgent could not find "${parsedArgs.file}".`, {
            level: "warning",
          });
          return;
        }

        recordLookAtInvocation();
        await session.log(`OpenAgent attached ${parsedArgs.file} for inspection.`, {
          ephemeral: true,
        });
        await session.send({
          prompt: buildOpenAgentLookAtPrompt({
            filePath,
            prompt: parsedArgs.prompt,
          }),
          attachments: [{ type: "file", path: filePath }],
        });
      },
    },
    {
      name: "oa-start",
      description: "Bootstrap a raw request or resume a structured handoff artifact.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent bootstrap"), {
            level: "warning",
          });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const parsedArgs = parseStartCommandArgs(context.args);

        if (parsedArgs.resumePath) {
          const artifact = await readOpenAgentHandoffArtifact({
            session,
            config: resolution.config,
            cwd: process.cwd() || initialCwd,
            artifactPath: parsedArgs.resumePath,
          });
          // Guard against stale handoffs saved before fleet dispatch was introduced.
          const resumePhase =
            artifact.toPhase === "implementer" ? "orchestrator" : artifact.toPhase;
          const result = await routeOpenAgentPhase({
            session,
            config: resolution.config,
            request: {
              phase: resumePhase,
              agent: resumePhase === "orchestrator" ? undefined : artifact.toAgent,
              objective: `Resume handoff: ${artifact.goal}`,
              handoff: buildOpenAgentResumeHandoff(artifact, parsedArgs.resumeNote),
              requestedBy: "oa-start resume command",
              syncPlan: true,
            },
          });

          await session.log(
            [
              `OpenAgent resumed handoff artifact into ${result.phase}.`,
              `Selected agent: ${result.agent}`,
              `Mode: ${result.mode}`,
              `Handoff note: ${result.handoffWorkspacePath}`,
            ].join("\n"),
          );
          return;
        }

        const request = parsedArgs.request?.trim();
        if (!request) {
          await session.log("Usage: /oa-start <request> OR /oa-start --resume <artifact>", {
            level: "warning",
          });
          return;
        }

        const result = await bootstrapOpenAgentTask({
          session,
          config: resolution.config,
          request,
          requestedBy: "oa-start command",
          syncPlan: true,
        });

        await session.log(formatOpenAgentBootstrapResult(result));
      },
    },
    {
      name: "oa-plan-review",
      description: "Start a planner -> critic -> reviewer workflow before implementation begins.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent plan review"), {
            level: "warning",
          });
          return;
        }

        const request = context.args.trim();
        if (!request) {
          await session.log("Usage: /oa-plan-review <request>", { level: "warning" });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await startPlanReviewWorkflow({
          session,
          config: resolution.config,
          request,
          requestedBy: "oa-plan-review command",
          syncPlan: true,
        });

        await session.log(formatOpenAgentPlanReviewResult(result));
      },
    },
    {
      name: "oa-route",
      description: "Route to an OpenAgent phase with a durable handoff note.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent routing"), {
            level: "warning",
          });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const parsedArgs = parseRouteCommandArgs(context.args);

        if (!parsedArgs || !isOpenAgentPhase(parsedArgs.phase)) {
          await session.log(
            `Usage: /oa-route <phase> <objective> [| handoff]. Phases: ${listOpenAgentPhases()}`,
            { level: "warning" },
          );
          return;
        }

        const result = await routeOpenAgentPhase({
          session,
          config: resolution.config,
          request: {
            phase: parsedArgs.phase,
            objective: parsedArgs.objective,
            handoff: parsedArgs.handoff,
            requestedBy: "oa-route command",
            syncPlan: true,
          },
        });

        await session.log(
          [
            `OpenAgent routed from ${result.previousPhase} to ${result.phase}.`,
            `Selected agent: ${result.agent}`,
            `Mode: ${result.mode}`,
            `Handoff note: ${result.handoffWorkspacePath}`,
            `Plan updated: ${result.planUpdated ? "yes" : "no"}`,
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-refactor",
      description: "Start a guided refactoring workflow with LSP-backed safety checks.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent refactor"), {
            level: "warning",
          });
          return;
        }

        const target = context.args.trim();
        if (!target) {
          await session.log("Usage: /oa-refactor <target description>", { level: "warning" });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution.config,
          request: {
            phase: "orchestrator",
            objective: `Execute refactoring: ${target}`,
            handoff: [
              "Refactoring objective: execute the scoped refactor described above.",
              "Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool.",
              "1. Break the refactor into non-overlapping scoped tasks per wave",
              "2. Dispatch all tasks in a wave simultaneously with the `agent` tool",
              "3. Verify each wave before dispatching the next",
              "4. Summarize what changed and any remaining risks",
            ].join("\n"),
            requestedBy: "oa-refactor command",
            syncPlan: true,
          },
        });

        await session.log(
          [
            `OpenAgent refactor routed to ${result.phase}.`,
            `Selected agent: ${result.agent}`,
            `Mode: ${result.mode}`,
            `Handoff note: ${result.handoffWorkspacePath}`,
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-handoff",
      description: "Hand off the current work to another OpenAgent persona and persist a resume artifact.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent handoff"), {
            level: "warning",
          });
          return;
        }

        const trimmed = context.args.trim();
        const spaceIndex = trimmed.indexOf(" ");
        const agentName = spaceIndex >= 0 ? trimmed.slice(0, spaceIndex) : trimmed;
        const description = spaceIndex >= 0 ? trimmed.slice(spaceIndex + 1).trim() : "";

        if (!agentName) {
          await session.log(
            `Usage: /oa-handoff <agent-name> <description>. Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`,
            { level: "warning" },
          );
          return;
        }

        if (!isOpenAgentAgentName(agentName)) {
          await session.log(
            `Unknown agent "${agentName}". Available agents: ${OPENAGENT_AGENT_NAMES.join(", ")}`,
            { level: "warning" },
          );
          return;
        }

        const phase = inferOpenAgentPhase(agentName);
        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const [currentAgentResult, currentModeResult] = await Promise.all([
          session.rpc.agent.getCurrent(),
          session.rpc.mode.get(),
        ]);
        const fromAgent: OpenAgentAgentName = isOpenAgentAgentName(currentAgentResult.agent?.name ?? "")
          ? (currentAgentResult.agent!.name as OpenAgentAgentName)
          : resolution.config.defaultAgent;
        const fromPhase = inferOpenAgentPhase(fromAgent);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution.config,
          request: {
            phase,
            agent: agentName,
            objective: description || `Handoff to ${agentName}`,
            handoff: description || `Continue the current work as ${agentName}.`,
            requestedBy: "oa-handoff command",
            syncPlan: true,
          },
        });
        const artifact = await writeOpenAgentHandoffArtifact({
          session,
          config: resolution.config,
          targetAgent: agentName,
          goal: description || `Handoff to ${agentName}`,
          requestedBy: "oa-handoff command",
          nextStep: description || `Continue the current work as ${agentName}.`,
          fromAgent,
          fromPhase,
          fromMode:
            currentModeResult === "interactive" ||
            currentModeResult === "plan" ||
            currentModeResult === "autopilot"
              ? currentModeResult
              : "interactive",
          refs: [result.handoffWorkspacePath],
          latestHandoffPath: result.handoffWorkspacePath,
        });

        await session.log(
          [
            `OpenAgent handed off from ${result.previousPhase} to ${result.phase}.`,
            `Selected agent: ${result.agent}`,
            `Mode: ${result.mode}`,
            `Handoff note: ${result.handoffWorkspacePath}`,
            `Handoff artifact: ${artifact.workspaceRelativePath}`,
          ].join("\n"),
        );
      },
    },
    {
      name: "oa-review",
      description: "Start a parallel review fan-out across correctness, regressions, architecture, and QA.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent review"), {
            level: "warning",
          });
          return;
        }

        const scope = context.args.trim() || "all pending changes";
        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await startOpenAgentReviewWorkflow({
          session,
          config: resolution.config,
          scope,
          requestedBy: "oa-review command",
          syncPlan: true,
        });

        await session.log(formatOpenAgentReviewWorkflowResult(result));
      },
    },
    {
      name: "oa-start-work",
      description: "Execute the current plan from the session workspace.",
      handler: async (context) => {
        const session = getSession();
        if (!isOpenAgentWorkspaceAvailable(session)) {
          await session.log(formatOpenAgentWorkspaceRequirement("OpenAgent start-work"), {
            level: "warning",
          });
          return;
        }

        const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
        const result = await routeOpenAgentPhase({
          session,
          config: resolution.config,
          request: {
            phase: "orchestrator",
            objective: "Execute the active plan end-to-end",
            handoff: [
              "Execution objective: work through plan.md using fleet dispatch.",
              "Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool.",
              "1. Read plan.md from the session workspace",
              "2. Decompose planned tasks into non-overlapping scoped waves",
              "3. Dispatch all tasks in each wave simultaneously with the `agent` tool",
              "4. Verify each wave before proceeding to the next",
              "5. Keep plan.md updated with progress and completion status",
            ].join("\n"),
            requestedBy: "oa-start-work command",
            syncPlan: true,
          },
        });

        await session.log(
          [
            `OpenAgent start-work routed to ${result.phase}.`,
            `Selected agent: ${result.agent}`,
            `Mode: ${result.mode}`,
            `Handoff note: ${result.handoffWorkspacePath}`,
          ].join("\n"),
        );
      },
    },
  ];

  const builtinCommandNames = new Set(allCommands.map((command) => command.name));
  for (const customCommand of customCommands) {
    if (builtinCommandNames.has(customCommand.name)) {
      continue;
    }

    allCommands.push({
      name: customCommand.name,
      description: customCommand.description,
      handler: async (context) => {
        const session = getSession();
        await session.log(
          `OpenAgent executing custom command /${customCommand.name} from ${customCommand.source}.`,
          { ephemeral: true },
        );
        await session.send({
          prompt: renderCustomCommandPrompt(customCommand, context.args),
        });
      },
    });
  }

  const resolution = loadOpenAgentConfig(cwd);
  const disabledCommandSet = new Set(resolution.config.disabledCommands);
  return allCommands.filter((cmd) => !disabledCommandSet.has(cmd.name));
}
