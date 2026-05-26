import type { CopilotSession, Tool, ToolResultObject } from "@github/copilot-sdk";
import {
  cancelBackgroundTask,
  formatBackgroundTasksSummary,
  getBackgroundTaskStats,
  listBackgroundTasks,
  registerBackgroundTask,
  updateBackgroundTask,
  type BackgroundTaskStatus,
} from "./background-tasks";
import {
  bootstrapOpenAgentTask,
  formatOpenAgentBootstrapResult,
  isOpenAgentBootstrapPhase,
  listOpenAgentBootstrapPhases,
} from "./bootstrap";
import {
  formatBootstrapHistorySummary,
  readBootstrapHistory,
} from "./bootstrap-history";
import {
  applyCategoryOverrides,
  formatCategorySummary,
  getCategoryByName,
  inferCategoryFromObjective,
  listCategoryNames,
} from "./categories";
import {
  formatOpenAgentCompactionStatus,
} from "./compaction";
import {
  formatConfigSummary,
  formatModelTargets,
  type OpenAgentAgentName,
  isOpenAgentAgentName,
  loadOpenAgentConfig,
  OPENAGENT_AGENT_NAMES,
} from "./config";
import { runOpenAgentDoctor } from "./doctor";
import { runOpenAgentAstReplace, runOpenAgentAstSearch } from "./ast-grep";
import {
  getOpenAgentLspDefinitions,
  getOpenAgentLspDiagnostics,
  getOpenAgentLspReferences,
  runOpenAgentLspRename,
} from "./lsp-lite";
import { runOpenAgentLookAt } from "./look-at";
import {
  listOpenAgentMemoryTopics,
  readOpenAgentMemory,
  writeOpenAgentMemory,
} from "./memory";
import { formatFallbackStatus } from "./model-fallback";
import { updateSessionPlan } from "./plan";
import {
  formatOpenAgentPlanReviewResult,
  startPlanReviewWorkflow,
} from "./plan-review";
import {
  formatSessionHistoryEntry,
  readSessionHistory,
  searchSessionHistory,
} from "./session-history";
import { applyOpenAgentSafeEdit } from "./safe-edit";
import { createTaskTools } from "./task-tools";
import {
  formatOpenAgentTelemetry,
} from "./telemetry";
import {
  clearFleetState,
  formatFleetDispatchInstructions,
  writeFleetState,
  type FleetTask,
} from "./fleet";
import {
  formatOpenAgentRoutingStatus,
  isOpenAgentPhase,
  listOpenAgentPhases,
  routeOpenAgentPhase,
  type OpenAgentMode,
} from "./routing";
import {
  formatOpenAgentWorkspaceRequirement,
  isOpenAgentWorkspaceAvailable,
  writeOpenAgentWorkspaceNote,
} from "./workspace";

type SessionGetter = () => CopilotSession;

type PlanNoteArgs = {
  content: string;
  mode?: "append" | "replace";
};

type WorkspaceNoteArgs = {
  path: string;
  content: string;
  mode?: "append" | "replace";
};

type BootstrapTaskArgs = {
  request: string;
  requestedBy?: string;
  phase?: "auto" | "planner" | "researcher" | "orchestrator";
  syncPlan?: boolean;
  mode?: OpenAgentMode | "default";
};

type RoutePhaseArgs = {
  phase: string;
  agent?: OpenAgentAgentName;
  objective: string;
  handoff: string;
  requestedBy?: string;
  syncPlan?: boolean;
  mode?: OpenAgentMode | "default";
};

type PlanReviewArgs = {
  request: string;
  requestedBy?: string;
  syncPlan?: boolean;
  mode?: OpenAgentMode | "default";
};

type FleetArgs = {
  objective: string;
  tasks: Array<{ title: string; description: string; scope?: string }>;
};

type MemoryWriteArgs = {
  topic: string;
  content: string;
  mode?: "append" | "replace";
};

type MemoryReadArgs = {
  topic: string;
};

type SafeEditArgs = {
  file: string;
  lineHash: string;
  oldBlock: string;
  newBlock: string;
};

type DelegateArgs = {
  category: string | null;
  objective: string;
  handoff: string;
};

type LspLocationArgs = {
  file: string;
  line: number;
  character: number;
  maxResults?: number;
};

type LspDiagnosticsArgs = {
  file: string;
  maxResults?: number;
};

type LspRenameArgs = LspLocationArgs & {
  newName: string;
  apply?: boolean;
};

type AstSearchArgs = {
  pattern: string;
  language?: string;
  globs?: string[];
  paths?: string[];
  json?: boolean;
};

type AstReplaceArgs = AstSearchArgs & {
  rewrite: string;
  apply?: boolean;
};

type LookAtArgs = {
  file: string;
  prompt?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSuccessResult(
  textResultForLlm: string,
  sessionLog?: string,
): ToolResultObject {
  return {
    textResultForLlm,
    resultType: "success",
    sessionLog,
  };
}

function createFailureResult(
  textResultForLlm: string,
  error: string,
): ToolResultObject {
  return {
    textResultForLlm,
    resultType: "failure",
    error,
  };
}

function resolveCwd(initialCwd: string): string {
  const current = process.cwd();
  return current.length > 0 ? current : initialCwd;
}

function parsePlanNoteArgs(args: unknown): PlanNoteArgs {
  if (!isRecord(args) || typeof args.content !== "string" || args.content.length === 0) {
    throw new Error("openagent_plan_note requires a non-empty string content field.");
  }

  return {
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append",
  };
}

function parseWorkspaceNoteArgs(args: unknown): WorkspaceNoteArgs {
  if (
    !isRecord(args) ||
    typeof args.path !== "string" ||
    args.path.length === 0 ||
    typeof args.content !== "string" ||
    args.content.length === 0
  ) {
    throw new Error(
      "openagent_workspace_note requires non-empty string path and content fields.",
    );
  }

  return {
    path: args.path,
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append",
  };
}

function parseBootstrapTaskArgs(args: unknown): BootstrapTaskArgs {
  if (!isRecord(args) || typeof args.request !== "string" || args.request.trim().length === 0) {
    throw new Error("openagent_bootstrap_task requires a non-empty string request field.");
  }

  const mode =
    args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot"
      ? args.mode
      : "default";
  const rawPhase = args.phase;

  if (
    typeof rawPhase !== "undefined" &&
    rawPhase !== "auto" &&
    (typeof rawPhase !== "string" || !isOpenAgentBootstrapPhase(rawPhase))
  ) {
    throw new Error(
      `openagent_bootstrap_task phase must be "auto" or one of: ${listOpenAgentBootstrapPhases()}.`,
    );
  }

  return {
    request: args.request.trim(),
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    phase:
      rawPhase === "auto" || (typeof rawPhase === "string" && isOpenAgentBootstrapPhase(rawPhase))
        ? rawPhase
        : "auto",
    syncPlan: args.syncPlan === false ? false : true,
    mode,
  };
}

function parseRoutePhaseArgs(args: unknown): RoutePhaseArgs {
  if (
    !isRecord(args) ||
    typeof args.phase !== "string" ||
    typeof args.objective !== "string" ||
    typeof args.handoff !== "string"
  ) {
    throw new Error(
      `openagent_route_phase requires string phase, objective, and handoff fields. Available phases: ${listOpenAgentPhases()}.`,
    );
  }

  const mode =
    args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot"
      ? args.mode
      : "default";
  const rawAgent = args.agent;

  if (
    typeof rawAgent !== "undefined" &&
    (typeof rawAgent !== "string" || !isOpenAgentAgentName(rawAgent))
  ) {
    throw new Error(
      `openagent_route_phase agent must be one of: ${OPENAGENT_AGENT_NAMES.join(", ")}.`,
    );
  }

  return {
    phase: args.phase,
    agent: rawAgent,
    objective: args.objective,
    handoff: args.handoff,
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    syncPlan: args.syncPlan === false ? false : true,
    mode,
  };
}

function parsePlanReviewArgs(args: unknown): PlanReviewArgs {
  if (!isRecord(args) || typeof args.request !== "string" || args.request.trim().length === 0) {
    throw new Error("openagent_plan_review requires a non-empty string request field.");
  }

  const mode =
    args.mode === "interactive" || args.mode === "plan" || args.mode === "autopilot"
      ? args.mode
      : "default";

  return {
    request: args.request.trim(),
    requestedBy: typeof args.requestedBy === "string" ? args.requestedBy : undefined,
    syncPlan: args.syncPlan === false ? false : true,
    mode,
  };
}

function parseFleetArgs(args: unknown): FleetArgs {
  if (
    !isRecord(args) ||
    typeof args.objective !== "string" ||
    args.objective.trim().length === 0 ||
    !Array.isArray(args.tasks) ||
    args.tasks.length === 0
  ) {
    throw new Error(
      "openagent_fleet requires a non-empty objective string and a non-empty tasks array.",
    );
  }

  const tasks: FleetArgs["tasks"] = [];
  for (const [i, raw] of args.tasks.entries()) {
    if (
      !isRecord(raw) ||
      typeof raw.title !== "string" ||
      raw.title.trim().length === 0 ||
      typeof raw.description !== "string" ||
      raw.description.trim().length === 0
    ) {
      throw new Error(
        `openagent_fleet tasks[${i}] must have non-empty title and description strings.`,
      );
    }
    tasks.push({
      title: raw.title.trim(),
      description: raw.description.trim(),
      scope: typeof raw.scope === "string" ? raw.scope.trim() : undefined,
    });
  }

  return { objective: args.objective.trim(), tasks };
}

function parseMemoryWriteArgs(args: unknown): MemoryWriteArgs {
  if (
    !isRecord(args) ||
    typeof args.topic !== "string" ||
    args.topic.trim().length === 0 ||
    typeof args.content !== "string" ||
    args.content.length === 0
  ) {
    throw new Error(
      "openagent_memory_write requires non-empty string topic and content fields.",
    );
  }

  return {
    topic: args.topic.trim(),
    content: args.content,
    mode: args.mode === "replace" ? "replace" : "append",
  };
}

function parseMemoryReadArgs(args: unknown): MemoryReadArgs {
  if (!isRecord(args) || typeof args.topic !== "string" || args.topic.trim().length === 0) {
    throw new Error("openagent_memory_read requires a non-empty string topic field.");
  }

  return {
    topic: args.topic.trim(),
  };
}

function parseSafeEditArgs(args: unknown): SafeEditArgs {
  if (
    !isRecord(args) ||
    typeof args.file !== "string" ||
    args.file.trim().length === 0 ||
    typeof args.lineHash !== "string" ||
    args.lineHash.trim().length === 0 ||
    typeof args.oldBlock !== "string" ||
    typeof args.newBlock !== "string"
  ) {
    throw new Error(
      "openagent_safe_edit requires string file, lineHash, oldBlock, and newBlock fields.",
    );
  }

  return {
    file: args.file.trim(),
    lineHash: args.lineHash.trim(),
    oldBlock: args.oldBlock,
    newBlock: args.newBlock,
  };
}

function parseDelegateArgs(args: unknown): DelegateArgs {
  if (
    !isRecord(args) ||
    typeof args.objective !== "string" ||
    args.objective.trim().length === 0 ||
    typeof args.handoff !== "string" ||
    args.handoff.trim().length === 0
  ) {
    throw new Error(
      "openagent_delegate requires non-empty string objective and handoff fields.",
    );
  }

  const category =
    typeof args.category === "string" && args.category.trim().length > 0
      ? args.category.trim()
      : null;

  return {
    category,
    objective: args.objective.trim(),
    handoff: args.handoff.trim(),
  };
}

function parsePositiveIntegerField(
  value: unknown,
  fieldName: string,
  fallback?: number,
): number | undefined {
  if (typeof value === "undefined") {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function parseLspDiagnosticsArgs(args: unknown): LspDiagnosticsArgs {
  if (!isRecord(args) || typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new Error("openagent_lsp_diagnostics requires a non-empty string file field.");
  }

  return {
    file: args.file.trim(),
    maxResults: parsePositiveIntegerField(args.maxResults, "maxResults"),
  };
}

function parseLspLocationArgs(args: unknown, toolName: string): LspLocationArgs {
  if (
    !isRecord(args) ||
    typeof args.file !== "string" ||
    args.file.trim().length === 0 ||
    typeof args.line !== "number" ||
    typeof args.character !== "number"
  ) {
    throw new Error(
      `${toolName} requires string file and numeric line/character fields.`,
    );
  }

  const line = parsePositiveIntegerField(args.line, "line");
  const character = parsePositiveIntegerField(args.character, "character");
  if (typeof line === "undefined" || typeof character === "undefined") {
    throw new Error(`${toolName} requires positive integer line and character fields.`);
  }

  return {
    file: args.file.trim(),
    line,
    character,
    maxResults: parsePositiveIntegerField(args.maxResults, "maxResults"),
  };
}

function parseLspRenameArgs(args: unknown): LspRenameArgs {
  const base = parseLspLocationArgs(args, "openagent_lsp_rename");
  if (!isRecord(args) || typeof args.newName !== "string" || args.newName.trim().length === 0) {
    throw new Error("openagent_lsp_rename requires a non-empty string newName field.");
  }

  return {
    ...base,
    newName: args.newName.trim(),
    apply: args.apply === true,
  };
}

function parseAstSearchArgs(args: unknown, toolName: string): AstSearchArgs {
  if (!isRecord(args) || typeof args.pattern !== "string" || args.pattern.length === 0) {
    throw new Error(`${toolName} requires a non-empty string pattern field.`);
  }

  return {
    pattern: args.pattern,
    language: typeof args.language === "string" ? args.language : undefined,
    globs: Array.isArray(args.globs)
      ? args.globs.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : undefined,
    paths: Array.isArray(args.paths)
      ? args.paths.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : undefined,
    json: args.json === true,
  };
}

function parseAstReplaceArgs(args: unknown): AstReplaceArgs {
  const base = parseAstSearchArgs(args, "openagent_ast_replace");
  if (!isRecord(args) || typeof args.rewrite !== "string") {
    throw new Error("openagent_ast_replace requires a string rewrite field.");
  }

  return {
    ...base,
    rewrite: args.rewrite,
    apply: args.apply === true,
  };
}

function parseLookAtArgs(args: unknown): LookAtArgs {
  if (!isRecord(args) || typeof args.file !== "string" || args.file.trim().length === 0) {
    throw new Error("openagent_look_at requires a non-empty string file field.");
  }

  return {
    file: args.file.trim(),
    prompt: typeof args.prompt === "string" && args.prompt.trim().length > 0 ? args.prompt.trim() : undefined,
  };
}

export function createTools(args: {
  getSession: SessionGetter;
  initialCwd: string;
}): Tool[] {
  const { getSession, initialCwd } = args;

  const runtimeStatusTool: Tool = {
    name: "openagent_runtime_status",
    description:
      "Report the active OpenAgent configuration, selected model, selected agent, current mode, workspace state, and bootstrap introspection.",
    skipPermission: true,
    handler: async () => {
      const session = getSession();
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const [mode, model, agent, plan] = await Promise.all([
        session.rpc.mode.get(),
        session.rpc.model.getCurrent(),
        session.rpc.agent.getCurrent(),
        session.rpc.plan.read(),
      ]);
      const [routingStatus, bootstrapHistory] = await Promise.all([
        formatOpenAgentRoutingStatus({
          session,
          config: resolution.config,
        }),
        isOpenAgentWorkspaceAvailable(session)
          ? readBootstrapHistory(session, resolution.config)
          : Promise.resolve(null),
      ]);
      const bootstrapSummary = bootstrapHistory
        ? formatBootstrapHistorySummary(bootstrapHistory)
        : "Bootstrap history unavailable (no workspace).";

      const bgStats = getBackgroundTaskStats();
      const bgSummary = `Background tasks: ${bgStats.total} total (${bgStats.running} running, ${bgStats.completed} completed, ${bgStats.failed} failed, ${bgStats.cancelled} cancelled)`;

      return createSuccessResult(
        [
          "OpenAgent runtime status",
          formatConfigSummary(resolution),
          `mode: ${mode.mode}`,
          `model: ${model.modelId ?? "host default"}`,
          `agent: ${agent.agent?.name ?? "host default"}`,
          `workspace path: ${session.workspacePath ?? "disabled"}`,
          `plan file: ${plan.path ?? "not available"}`,
          `plan exists: ${plan.exists ? "yes" : "no"}`,
          "",
          routingStatus,
          "",
          "Bootstrap introspection",
          bootstrapSummary,
          "",
          formatFallbackStatus(),
          "",
          formatOpenAgentCompactionStatus(),
          "",
          bgSummary,
          "",
          formatOpenAgentTelemetry(),
          "",
          formatCategorySummary(applyCategoryOverrides(resolution.config.categories)),
        ].join("\n"),
      );
    },
  };

  const bootstrapTaskTool: Tool = {
    name: "openagent_bootstrap_task",
    description:
      "Bootstrap a raw request into an initial plan, selected phase, and durable handoff so OpenAgent can start disciplined work in one step.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "The raw task or request to bootstrap into plan + route + handoff.",
        },
        phase: {
          type: "string",
          enum: ["auto", "planner", "researcher", "orchestrator"],
          description:
            "Optional override for the starting phase. Defaults to auto classification.",
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the bootstrap.",
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append the resulting route summary into the plan.",
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the routed phase.",
        },
      },
      required: ["request"],
    },
    handler: async (args) => {
      const parsedArgs = parseBootstrapTaskArgs(args);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent bootstrap");
        return createFailureResult(message, message);
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const result = await bootstrapOpenAgentTask({
        session,
        config: resolution.config,
        ...parsedArgs,
      });

      return createSuccessResult(
        formatOpenAgentBootstrapResult(result),
        "OpenAgent bootstrapped the task into a plan and routed phase.",
      );
    },
  };

  const planNoteTool: Tool = {
    name: "openagent_plan_note",
    description:
      "Create or update the session plan with durable implementation notes that should survive future turns.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "Plan text to write into the session plan file.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the current plan or replace it.",
        },
      },
      required: ["content"],
    },
    handler: async (args) => {
      const parsedArgs = parsePlanNoteArgs(args);
      const session = getSession();
      const result = await updateSessionPlan({
        session,
        content: parsedArgs.content,
        mode: parsedArgs.mode,
      });

      return createSuccessResult(
        [
          `Updated the session plan in ${result.mode} mode.`,
          `Plan path: ${result.path ?? "workspace-managed plan.md"}`,
          `New length: ${result.nextContent.length} characters`,
        ].join("\n"),
        "OpenAgent updated the session plan.",
      );
    },
  };

  const workspaceNoteTool: Tool = {
    name: "openagent_workspace_note",
    description:
      "Write a durable note or artifact into the session workspace files directory under the OpenAgent notes folder.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Relative path for the note inside the OpenAgent workspace notes directory. .md is added if omitted.",
        },
        content: {
          type: "string",
          description: "Text content to write to the workspace note.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the note or replace it entirely.",
        },
      },
      required: ["path", "content"],
    },
    handler: async (args) => {
      const parsedArgs = parseWorkspaceNoteArgs(args);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult(
          "OpenAgent could not persist the workspace note because the session workspace is disabled.",
          "Session workspace is unavailable.",
        );
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const note = await writeOpenAgentWorkspaceNote({
        session,
        config: resolution.config,
        relativePath: parsedArgs.path,
        content: parsedArgs.content,
        mode: parsedArgs.mode,
      });

      return createSuccessResult(
        [
          `Saved OpenAgent workspace note to ${note.workspaceRelativePath}.`,
          `Write mode: ${parsedArgs.mode === "replace" ? "replace" : "append"}`,
          `Content length: ${note.nextContent.length} characters`,
        ].join("\n"),
        "OpenAgent wrote a workspace note.",
      );
    },
  };

  const routePhaseTool: Tool = {
    name: "openagent_route_phase",
    description:
      "Switch OpenAgent to a named phase, persist a durable handoff note, and select the matching phase agent or specialist variant.",
    parameters: {
      type: "object",
      properties: {
        phase: {
          type: "string",
          enum: ["orchestrator", "planner", "researcher", "reviewer"],
          description: "The target OpenAgent phase. Use `openagent_fleet` for implementation dispatch — routing directly to `implementer` is not supported.",
        },
        agent: {
          type: "string",
          enum: [...OPENAGENT_AGENT_NAMES],
          description:
            "Optional agent override inside the target phase (for example skeptic or oracle).",
        },
        objective: {
          type: "string",
          description: "The concrete goal for the next phase.",
        },
        handoff: {
          type: "string",
          description: "The durable handoff content the next phase should receive.",
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the route.",
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append a summary of the route to the session plan.",
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the target phase.",
        },
      },
      required: ["phase", "objective", "handoff"],
    },
    handler: async (args) => {
      const parsedArgs = parseRoutePhaseArgs(args);
      if (!isOpenAgentPhase(parsedArgs.phase)) {
        throw new Error(
          `Unknown OpenAgent phase "${parsedArgs.phase}". Available phases: ${listOpenAgentPhases()}.`,
        );
      }

      if (parsedArgs.phase === "implementer") {
        return createFailureResult(
          "Direct routing to the implementer phase is not supported. Use `openagent_fleet` to register implementation tasks and dispatch builders via the `agent` tool. This keeps the conductor in orchestrator phase while builders run.",
          "implementer routing disabled — use openagent_fleet",
        );
      }

      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent routing");
        return createFailureResult(message, message);
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const result = await routeOpenAgentPhase({
        session,
        config: resolution.config,
        request: {
          phase: parsedArgs.phase,
          agent: parsedArgs.agent,
          objective: parsedArgs.objective,
          handoff: parsedArgs.handoff,
          requestedBy: parsedArgs.requestedBy,
          syncPlan: parsedArgs.syncPlan,
          mode: parsedArgs.mode,
        },
      });

      return createSuccessResult(
        [
          `OpenAgent routed from ${result.previousPhase} to ${result.phase}.`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Handoff note: ${result.handoffWorkspacePath}`,
          `Plan updated: ${result.planUpdated ? "yes" : "no"}`,
        ].join("\n"),
        `OpenAgent routed to the ${result.phase} phase.`,
      );
    },
  };

  const fleetTool: Tool = {
    name: "openagent_fleet",
    description:
      "Register an implementation wave and get ready-to-dispatch agent payloads. Call the `agent` tool for each returned task in a single response to dispatch builders in parallel. For sequential waves, call `openagent_fleet` again after the previous wave completes.",
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "The overall implementation objective for this wave.",
        },
        tasks: {
          type: "array",
          description:
            "Implementation tasks for this wave. Tasks within a wave run in parallel — only group tasks here if their file scopes do not overlap.",
          items: {
            type: "object",
            properties: {
              title: {
                type: "string",
                description: "Short imperative title (e.g. 'Rename cmd/aim to cmd/tau').",
              },
              description: {
                type: "string",
                description: "Full task objective and what done looks like.",
              },
              scope: {
                type: "string",
                description:
                  "Files or packages this task modifies (e.g. 'cmd/aim/, go.mod'). Must not overlap with other tasks in the same wave.",
              },
            },
            required: ["title", "description"],
          },
          minItems: 1,
        },
      },
      required: ["objective", "tasks"],
    },
    handler: async (args) => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("openagent_fleet");
        return createFailureResult(message, message);
      }

      const parsedArgs = parseFleetArgs(args);
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const existing = await import("./fleet").then((m) =>
        m.readFleetState({ session, config: resolution.config }),
      );
      const wave = existing ? existing.wave + 1 : 1;
      const id = `fleet-${new Date().toISOString().replace(/[:.]/g, "-")}`;

      const tasks: FleetTask[] = parsedArgs.tasks.map((t, i) => ({
        id: `${id}-task-${i + 1}`,
        title: t.title,
        description: t.description,
        scope: t.scope,
      }));

      const state = {
        id,
        objective: parsedArgs.objective,
        wave,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        tasks,
      };

      await writeFleetState({ session, config: resolution.config, state });

      const instructions = formatFleetDispatchInstructions(state);
      return createSuccessResult(instructions, `Fleet ${id} registered with ${tasks.length} task(s).`);
    },
  };

  const planReviewTool: Tool = {
    name: "openagent_plan_review",
    description:
      "Start a durable planner -> critic -> reviewer workflow before implementation begins.",
    parameters: {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "The request that should be planned and review-gated before implementation.",
        },
        requestedBy: {
          type: "string",
          description: "Optional label describing who initiated the workflow.",
        },
        syncPlan: {
          type: "boolean",
          description: "Whether to append a route summary into the session plan.",
        },
        mode: {
          type: "string",
          enum: ["default", "interactive", "plan", "autopilot"],
          description: "Optional mode override for the routed planner phase.",
        },
      },
      required: ["request"],
    },
    handler: async (args) => {
      const parsedArgs = parsePlanReviewArgs(args);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent plan review");
        return createFailureResult(message, message);
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const result = await startPlanReviewWorkflow({
        session,
        config: resolution.config,
        ...parsedArgs,
      });

      return createSuccessResult(
        formatOpenAgentPlanReviewResult(result),
        "OpenAgent started the plan-review workflow.",
      );
    },
  };

  const doctorTool: Tool = {
    name: "openagent_doctor",
    description:
      "Inspect OpenAgent config, routing state, plan availability, and local binary support.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        writeReport: {
          type: "boolean",
          description:
            "When true, also save the doctor report into files/openagent/doctor/ if the session workspace is available.",
        },
      },
    },
    handler: async (args) => {
      const session = getSession();
      const cwd = resolveCwd(initialCwd);
      const resolution = loadOpenAgentConfig(cwd);
      const writeReport =
        isRecord(args) && typeof args.writeReport === "boolean" ? args.writeReport : true;
      const result = await runOpenAgentDoctor({
        session,
        cwd,
        resolution,
        writeReport,
      });

      return createSuccessResult(
        [
          result.report,
          "",
          `Saved report: ${result.reportWorkspacePath ?? "not written to workspace"}`,
          `Improvement note: ${result.improvementWorkspacePath ?? "memory only"}`,
          `Improvement memory: ${result.improvementMemoryPath}`,
        ].join("\n"),
        "OpenAgent ran doctor checks.",
      );
    },
  };

  const memoryWriteTool: Tool = {
    name: "openagent_memory_write",
    description:
      "Write a durable repository-scoped memory note under ~/.copilot/openagent/memory/ for reuse in later sessions.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic key for the memory note. Nested paths are allowed.",
        },
        content: {
          type: "string",
          description: "Text content to persist.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "Whether to append to the note or replace it entirely.",
        },
      },
      required: ["topic", "content"],
    },
    handler: async (args) => {
      const parsedArgs = parseMemoryWriteArgs(args);
      const result = await writeOpenAgentMemory({
        cwd: resolveCwd(initialCwd),
        ...parsedArgs,
      });

      return createSuccessResult(
        [
          `Saved repository memory note: ${result.relativePath}`,
          `Repo key: ${result.repoKey}`,
          `Mode: ${parsedArgs.mode === "replace" ? "replace" : "append"}`,
          `Content length: ${result.nextContent.length} characters`,
        ].join("\n"),
        "OpenAgent wrote a durable memory note.",
      );
    },
  };

  const memoryReadTool: Tool = {
    name: "openagent_memory_read",
    description: "Read a durable repository-scoped memory note from ~/.copilot/openagent/memory/.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description: "Topic key to read.",
        },
      },
      required: ["topic"],
    },
    handler: async (args) => {
      const parsedArgs = parseMemoryReadArgs(args);
      const result = await readOpenAgentMemory({
        cwd: resolveCwd(initialCwd),
        topic: parsedArgs.topic,
      });

      if (result.content === null) {
        return createFailureResult(
          `No repository memory note found for topic "${parsedArgs.topic}".`,
          "Memory note not found.",
        );
      }

      return createSuccessResult(
        [
          `Repository memory note: ${result.relativePath}`,
          `Repo key: ${result.repoKey}`,
          "",
          result.content,
        ].join("\n"),
        "OpenAgent read a durable memory note.",
      );
    },
  };

  const memoryListTool: Tool = {
    name: "openagent_memory_list",
    description: "List durable repository-scoped memory topics available for the current workspace.",
    skipPermission: true,
    handler: async () => {
      const result = await listOpenAgentMemoryTopics({
        cwd: resolveCwd(initialCwd),
      });

      if (result.topics.length === 0) {
        return createSuccessResult(
          `No repository memory topics stored for repo key "${result.repoKey}".`,
        );
      }

      return createSuccessResult(
        [
          `Repository memory topics for ${result.repoKey}:`,
          ...result.topics.map((topic) => `- ${topic}`),
        ].join("\n"),
        `OpenAgent listed ${result.topics.length} memory topic(s).`,
      );
    },
  };

  const safeEditTool: Tool = {
    name: "openagent_safe_edit",
    description:
      "Apply a precise block replacement only if the target block is unique and the first-line hash still matches.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target file path, relative to the repo when not absolute.",
        },
        lineHash: {
          type: "string",
          description:
            "Hash of the first line of oldBlock. Use this to refuse stale edits when the line has drifted.",
        },
        oldBlock: {
          type: "string",
          description: "The exact existing block that should be replaced.",
        },
        newBlock: {
          type: "string",
          description: "The replacement block.",
        },
      },
      required: ["file", "lineHash", "oldBlock", "newBlock"],
    },
    handler: async (args) => {
      const parsedArgs = parseSafeEditArgs(args);
      const session = getSession();

      try {
        const result = await applyOpenAgentSafeEdit({
          cwd: resolveCwd(initialCwd),
          workspacePath: session.workspacePath ?? undefined,
          ...parsedArgs,
        });

        return createSuccessResult(
          [
            `Applied safe edit to ${result.filePath}.`,
            `Matched line number: ${result.lineNumber}`,
            `New file length: ${result.nextContent.length} characters`,
          ].join("\n"),
          `OpenAgent safely edited ${parsedArgs.file}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const lspDiagnosticsTool: Tool = {
    name: "openagent_lsp_diagnostics",
    description:
      "Read TypeScript or JavaScript diagnostics for a file using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file.",
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of diagnostics to return.",
        },
      },
      required: ["file"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseLspDiagnosticsArgs(args);
        const result = getOpenAgentLspDiagnostics({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });

        if (result.diagnostics.length === 0) {
          return createSuccessResult(
            [
              `No TypeScript diagnostics found for ${result.filePath}.`,
              `Config: ${result.configPath ?? "inferred project"}`,
            ].join("\n"),
            "OpenAgent found no LSP diagnostics.",
          );
        }

        return createSuccessResult(
          [
            `TypeScript diagnostics for ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`,
            ...result.diagnostics.map(
              (diagnostic) =>
                `- [${diagnostic.category}] ${diagnostic.filePath}:${diagnostic.start.line}:${diagnostic.start.character} TS${diagnostic.code} ${diagnostic.message}`,
            ),
          ].join("\n"),
          `OpenAgent reported ${result.diagnostics.length} LSP diagnostic(s).`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const lspGotoDefinitionTool: Tool = {
    name: "openagent_lsp_goto_definition",
    description:
      "Find TypeScript or JavaScript symbol definitions for a file position using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file.",
        },
        line: {
          type: "number",
          description: "1-based line number.",
        },
        character: {
          type: "number",
          description: "1-based character number.",
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of definitions to return.",
        },
      },
      required: ["file", "line", "character"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseLspLocationArgs(args, "openagent_lsp_goto_definition");
        const result = getOpenAgentLspDefinitions({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });

        if (result.definitions.length === 0) {
          return createSuccessResult(
            [
              `No definitions found for ${result.symbolName}.`,
              `Source file: ${result.filePath}`,
              `Config: ${result.configPath ?? "inferred project"}`,
            ].join("\n"),
            "OpenAgent found no LSP definitions.",
          );
        }

        return createSuccessResult(
          [
            `Definitions for ${result.symbolName}`,
            `Source file: ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`,
            ...result.definitions.map(
              (definition) =>
                `- ${definition.filePath}:${definition.start.line}:${definition.start.character} ${definition.context}`,
            ),
          ].join("\n"),
          `OpenAgent found ${result.definitions.length} definition(s).`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const lspFindReferencesTool: Tool = {
    name: "openagent_lsp_find_references",
    description:
      "Find TypeScript or JavaScript references for a file position using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file.",
        },
        line: {
          type: "number",
          description: "1-based line number.",
        },
        character: {
          type: "number",
          description: "1-based character number.",
        },
        includeDeclaration: {
          type: "boolean",
          description: "Whether to include the definition in the reference results.",
        },
        maxResults: {
          type: "number",
          description: "Optional maximum number of references to return.",
        },
      },
      required: ["file", "line", "character"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseLspLocationArgs(args, "openagent_lsp_find_references");
        const includeDeclaration =
          isRecord(args) && typeof args.includeDeclaration === "boolean"
            ? args.includeDeclaration
            : true;
        const result = getOpenAgentLspReferences({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
          includeDeclaration,
        });

        if (result.references.length === 0) {
          return createSuccessResult(
            [
              `No references found for ${result.symbolName}.`,
              `Source file: ${result.filePath}`,
              `Config: ${result.configPath ?? "inferred project"}`,
            ].join("\n"),
            "OpenAgent found no LSP references.",
          );
        }

        return createSuccessResult(
          [
            `References for ${result.symbolName}`,
            `Source file: ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`,
            ...result.references.map(
              (reference) =>
                `- ${reference.filePath}:${reference.start.line}:${reference.start.character}${reference.isDefinition ? " [definition]" : ""} ${reference.context}`,
            ),
          ].join("\n"),
          `OpenAgent found ${result.references.length} reference(s).`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const lspRenameTool: Tool = {
    name: "openagent_lsp_rename",
    description:
      "Preview or apply a TypeScript or JavaScript symbol rename using the TypeScript language service.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target TypeScript or JavaScript file.",
        },
        line: {
          type: "number",
          description: "1-based line number.",
        },
        character: {
          type: "number",
          description: "1-based character number.",
        },
        newName: {
          type: "string",
          description: "Replacement identifier name.",
        },
        apply: {
          type: "boolean",
          description: "When true, write the rename edits to disk. Otherwise return a preview only.",
        },
        maxResults: {
          type: "number",
          description: "Ignored for rename; accepted for call-shape consistency.",
        },
      },
      required: ["file", "line", "character", "newName"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseLspRenameArgs(args);
        const result = await runOpenAgentLspRename({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });

        return createSuccessResult(
          [
            `${result.applied ? "Applied" : "Planned"} rename for ${result.symbolName} -> ${parsedArgs.newName}`,
            `Source file: ${result.filePath}`,
            `Config: ${result.configPath ?? "inferred project"}`,
            `Files touched: ${result.fileEdits.length}`,
            ...result.fileEdits.flatMap((fileEdit) => [
              `- ${fileEdit.filePath}`,
              ...fileEdit.edits.map(
                (edit) =>
                  `  ${edit.start.line}:${edit.start.character}-${edit.end.line}:${edit.end.character} ${edit.originalText} -> ${edit.newText}`,
              ),
            ]),
          ].join("\n"),
          result.applied
            ? `OpenAgent applied an LSP rename across ${result.fileEdits.length} file(s).`
            : `OpenAgent previewed an LSP rename across ${result.fileEdits.length} file(s).`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const astSearchTool: Tool = {
    name: "openagent_ast_search",
    description:
      "Search code with ast-grep when the ast-grep CLI is installed.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "ast-grep pattern to match.",
        },
        language: {
          type: "string",
          description: "Optional ast-grep language override.",
        },
        globs: {
          type: "array",
          items: { type: "string" },
          description: "Optional include/exclude glob filters passed to ast-grep.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to scan. Defaults to the current workspace.",
        },
        json: {
          type: "boolean",
          description: "When true, ask ast-grep for JSON stream output.",
        },
      },
      required: ["pattern"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseAstSearchArgs(args, "openagent_ast_search");
        const result = runOpenAgentAstSearch({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });
        const output = result.stdout || result.stderr || "ast-grep returned no output.";

        if (result.status !== 0) {
          return createFailureResult(output, output);
        }

        return createSuccessResult(
          [`Command: ${result.command}`, "", output].join("\n"),
          "OpenAgent ran ast-grep search.",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const astReplaceTool: Tool = {
    name: "openagent_ast_replace",
    description:
      "Preview or apply an ast-grep rewrite when the ast-grep CLI is installed.",
    parameters: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description: "ast-grep pattern to match.",
        },
        rewrite: {
          type: "string",
          description: "Rewrite template to apply to each match.",
        },
        language: {
          type: "string",
          description: "Optional ast-grep language override.",
        },
        globs: {
          type: "array",
          items: { type: "string" },
          description: "Optional include/exclude glob filters passed to ast-grep.",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional paths to scan. Defaults to the current workspace.",
        },
        apply: {
          type: "boolean",
          description: "When true, apply the rewrite with --update-all. Otherwise preview only.",
        },
      },
      required: ["pattern", "rewrite"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseAstReplaceArgs(args);
        const result = runOpenAgentAstReplace({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });
        const output = result.stdout || result.stderr || "ast-grep returned no output.";

        if (result.status !== 0) {
          return createFailureResult(output, output);
        }

        return createSuccessResult(
          [
            `${result.applied ? "Applied" : "Previewed"} ast-grep rewrite.`,
            `Command: ${result.command}`,
            "",
            output,
          ].join("\n"),
          result.applied
            ? "OpenAgent applied an ast-grep rewrite."
            : "OpenAgent previewed an ast-grep rewrite.",
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const lookAtTool: Tool = {
    name: "openagent_look_at",
    description:
      "Inspect an image, PDF, text file, or binary artifact with local extraction helpers and metadata.",
    parameters: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "Target file path, relative to the workspace when not absolute.",
        },
        prompt: {
          type: "string",
          description: "Optional inspection question or focus area.",
        },
      },
      required: ["file"],
    },
    handler: async (args) => {
      try {
        const parsedArgs = parseLookAtArgs(args);
        const result = await runOpenAgentLookAt({
          cwd: resolveCwd(initialCwd),
          ...parsedArgs,
        });

        return createSuccessResult(
          [
            `look_at strategy: ${result.strategy}`,
            `file: ${result.filePath}`,
            `mime: ${result.mimeType}`,
            "",
            result.output,
          ].join("\n"),
          `OpenAgent inspected ${parsedArgs.file}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const backgroundRegisterTool: Tool = {
    name: "openagent_background_register",
    description:
      "Register a new background task being tracked by OpenAgent. Use this when dispatching work to a background agent.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Unique identifier for the background task.",
        },
        description: {
          type: "string",
          description: "Short description of what the background task is doing.",
        },
        owner: {
          type: "string",
          description: "Which agent or phase spawned this task.",
        },
      },
      required: ["id", "description"],
    },
    handler: async (args) => {
      if (!isRecord(args) || typeof args.id !== "string" || args.id.length === 0) {
        return createFailureResult(
          "openagent_background_register requires a non-empty string id.",
          "Missing id.",
        );
      }

      if (typeof args.description !== "string" || args.description.length === 0) {
        return createFailureResult(
          "openagent_background_register requires a non-empty string description.",
          "Missing description.",
        );
      }

      const owner =
        typeof args.owner === "string" && args.owner.length > 0
          ? args.owner
          : "openagent";

      try {
        const task = registerBackgroundTask({
          id: args.id,
          description: args.description,
          owner,
        });

        return createSuccessResult(
          `Registered background task "${task.id}" (owner: ${task.owner}, status: running).`,
          `OpenAgent registered background task ${task.id}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const backgroundUpdateTool: Tool = {
    name: "openagent_background_update",
    description:
      "Update the status, result, or error of a tracked background task.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The background task ID to update.",
        },
        status: {
          type: "string",
          enum: ["running", "completed", "failed", "cancelled"],
          description: "New status for the background task.",
        },
        result: {
          type: "string",
          description: "Summary of the result when the task completes.",
        },
        error: {
          type: "string",
          description: "Error message if the task failed.",
        },
      },
      required: ["id"],
    },
    handler: async (args) => {
      if (!isRecord(args) || typeof args.id !== "string" || args.id.length === 0) {
        return createFailureResult(
          "openagent_background_update requires a non-empty string id.",
          "Missing id.",
        );
      }

      const update: {
        status?: BackgroundTaskStatus;
        result?: string;
        error?: string;
      } = {};

      if (
        args.status === "running" ||
        args.status === "completed" ||
        args.status === "failed" ||
        args.status === "cancelled"
      ) {
        update.status = args.status;
      }

      if (typeof args.result === "string") {
        update.result = args.result;
      }

      if (typeof args.error === "string") {
        update.error = args.error;
      }

      try {
        const task = updateBackgroundTask(args.id, update);

        return createSuccessResult(
          `Updated background task "${task.id}" (status: ${task.status}).`,
          `OpenAgent updated background task ${task.id}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const backgroundListTool: Tool = {
    name: "openagent_background_list",
    description:
      "List all tracked background tasks with optional status filter.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["running", "completed", "failed", "cancelled"],
          description: "Filter tasks by status.",
        },
      },
    },
    handler: async (args) => {
      const filter: { status?: BackgroundTaskStatus } = {};
      if (
        isRecord(args) &&
        (args.status === "running" ||
          args.status === "completed" ||
          args.status === "failed" ||
          args.status === "cancelled")
      ) {
        filter.status = args.status;
      }

      const tasks = listBackgroundTasks(filter.status ? filter : undefined);
      if (tasks.length === 0) {
        const qualifier = filter.status ? ` with status "${filter.status}"` : "";
        return createSuccessResult(`No background tasks found${qualifier}.`);
      }

      const summary = formatBackgroundTasksSummary();
      return createSuccessResult(
        summary,
        `OpenAgent listed ${tasks.length} background task(s).`,
      );
    },
  };

  const backgroundCancelTool: Tool = {
    name: "openagent_background_cancel",
    description:
      "Cancel a running background task by ID.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The background task ID to cancel.",
        },
      },
      required: ["id"],
    },
    handler: async (args) => {
      if (!isRecord(args) || typeof args.id !== "string" || args.id.length === 0) {
        return createFailureResult(
          "openagent_background_cancel requires a non-empty string id.",
          "Missing id.",
        );
      }

      try {
        const task = cancelBackgroundTask(args.id);

        return createSuccessResult(
          `Cancelled background task "${task.id}".`,
          `OpenAgent cancelled background task ${task.id}.`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }
    },
  };

  const sessionListTool: Tool = {
    name: "openagent_session_list",
    description:
      "List recent OpenAgent session history entries from the workspace. Returns summaries of past sessions.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        count: {
          type: "number",
          description: "Number of recent sessions to return (default 10, max 100).",
        },
      },
    },
    handler: async (args) => {
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult(
          formatOpenAgentWorkspaceRequirement("Session history listing"),
          "Session workspace is unavailable.",
        );
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const history = await readSessionHistory(session, resolution.config);

      const count =
        isRecord(args) && typeof args.count === "number" && args.count > 0
          ? Math.min(Math.floor(args.count), 100)
          : 10;

      const recent = history.entries.slice(-count);

      if (recent.length === 0) {
        return createSuccessResult("No session history entries found.");
      }

      const formatted = recent
        .map((entry, index) => `--- Entry ${index + 1} ---\n${formatSessionHistoryEntry(entry)}`)
        .join("\n\n");

      return createSuccessResult(
        `Found ${recent.length} session history entries (of ${history.entries.length} total).\n\n${formatted}`,
      );
    },
  };

  const sessionSearchTool: Tool = {
    name: "openagent_session_search",
    description:
      "Search OpenAgent session history by keyword. Matches against session summaries and key files (case-insensitive).",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query to match against session summaries and key files.",
        },
      },
      required: ["query"],
    },
    handler: async (args) => {
      if (!isRecord(args) || typeof args.query !== "string" || args.query.trim().length === 0) {
        return createFailureResult(
          "openagent_session_search requires a non-empty string query field.",
          "Missing query.",
        );
      }

      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult(
          formatOpenAgentWorkspaceRequirement("Session history search"),
          "Session workspace is unavailable.",
        );
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const matches = await searchSessionHistory(session, resolution.config, args.query.trim());

      if (matches.length === 0) {
        return createSuccessResult(`No session history entries matched "${args.query}".`);
      }

      const formatted = matches
        .map((entry, index) => `--- Match ${index + 1} ---\n${formatSessionHistoryEntry(entry)}`)
        .join("\n\n");

      return createSuccessResult(
        `Found ${matches.length} matching session history entries.\n\n${formatted}`,
      );
    },
  };

  const sessionGetTool: Tool = {
    name: "openagent_session_get",
    description:
      "Get full details of a specific OpenAgent session by its session ID.",
    skipPermission: true,
    parameters: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "The session ID to look up.",
        },
      },
      required: ["sessionId"],
    },
    handler: async (args) => {
      if (!isRecord(args) || typeof args.sessionId !== "string" || args.sessionId.trim().length === 0) {
        return createFailureResult(
          "openagent_session_get requires a non-empty string sessionId field.",
          "Missing sessionId.",
        );
      }

      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        return createFailureResult(
          formatOpenAgentWorkspaceRequirement("Session history lookup"),
          "Session workspace is unavailable.",
        );
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const history = await readSessionHistory(session, resolution.config);
      const entry = history.entries.find((e) => e.sessionId === args.sessionId);

      if (!entry) {
        return createFailureResult(
          `No session history entry found with ID "${args.sessionId}".`,
          "Session not found.",
        );
      }

      return createSuccessResult(formatSessionHistoryEntry(entry));
    },
  };

  const delegateTool: Tool = {
    name: "openagent_delegate",
    description:
      "Delegate work to the appropriate category and model. Resolves a task category (explicit or inferred from objective), registers a background task, and routes to the category's suggested phase.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: listCategoryNames(),
          description:
            "Task category to route to. If omitted, inferred from objective keywords.",
        },
        objective: {
          type: "string",
          description: "The concrete goal for the delegated work.",
        },
        handoff: {
          type: "string",
          description: "Durable handoff content the target phase should receive.",
        },
      },
      required: ["objective", "handoff"],
    },
    handler: async (args) => {
      const parsedArgs = parseDelegateArgs(args);
      const session = getSession();
      if (!isOpenAgentWorkspaceAvailable(session)) {
        const message = formatOpenAgentWorkspaceRequirement("OpenAgent delegate");
        return createFailureResult(message, message);
      }

      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      const categories = applyCategoryOverrides(resolution.config.categories);
      const resolvedCategory = parsedArgs.category
        ? categories.find((c) => c.name === parsedArgs.category) ??
          inferCategoryFromObjective(parsedArgs.objective)
        : inferCategoryFromObjective(parsedArgs.objective);
      const handoffParts = [parsedArgs.handoff];
      if (resolvedCategory.promptAppend) {
        handoffParts.push(resolvedCategory.promptAppend);
      }
      if (resolvedCategory.allowedTools && resolvedCategory.allowedTools.length > 0) {
        handoffParts.push(
          `Preferred tools for this category: ${resolvedCategory.allowedTools.join(", ")}.`,
        );
      }
      if (resolvedCategory.deniedTools && resolvedCategory.deniedTools.length > 0) {
        handoffParts.push(
          `Avoid these tools for this category: ${resolvedCategory.deniedTools.join(", ")}.`,
        );
      }

      const taskId = `delegate-${resolvedCategory.name}-${Date.now()}`;
      let task;
      try {
        task = registerBackgroundTask({
          id: taskId,
          description: `[${resolvedCategory.name}] ${parsedArgs.objective.slice(0, 120)}`,
          owner: "openagent-delegate",
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return createFailureResult(message, message);
      }

      const result = await routeOpenAgentPhase({
        session,
        config: resolution.config,
        request: {
          phase: resolvedCategory.suggestedPhase,
          objective: parsedArgs.objective,
          handoff: handoffParts.join("\n\n"),
          requestedBy: "openagent-delegate",
          syncPlan: true,
        },
      });

      return createSuccessResult(
        [
          `Delegated to category "${resolvedCategory.name}" (${resolvedCategory.displayName}).`,
          `Preferred model: ${resolvedCategory.preferredModel}`,
          `Fallback chain: ${formatModelTargets(resolvedCategory.fallbackModels)}`,
          `Reasoning effort: ${resolvedCategory.reasoningEffort}`,
          `Routed to phase: ${result.phase}`,
          `Selected agent: ${result.agent}`,
          `Mode: ${result.mode}`,
          `Background task ID: ${task.id}`,
          `Handoff note: ${result.handoffWorkspacePath}`,
        ].join("\n"),
        `OpenAgent delegated work to ${resolvedCategory.name} category.`,
      );
    },
  };

  const categoriesListTool: Tool = {
    name: "openagent_categories_list",
    description:
      "List all available task categories with their model preferences, reasoning effort, and suggested phases.",
    skipPermission: true,
    handler: async () => {
      const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
      return createSuccessResult(
        formatCategorySummary(applyCategoryOverrides(resolution.config.categories)),
      );
    },
  };

  const allTools = [
    runtimeStatusTool,
    bootstrapTaskTool,
    planNoteTool,
    workspaceNoteTool,
    routePhaseTool,
    fleetTool,
    planReviewTool,
    doctorTool,
    memoryWriteTool,
    memoryReadTool,
    memoryListTool,
    safeEditTool,
    lspDiagnosticsTool,
    lspGotoDefinitionTool,
    lspFindReferencesTool,
    lspRenameTool,
    astSearchTool,
    astReplaceTool,
    lookAtTool,
    delegateTool,
    categoriesListTool,
    backgroundRegisterTool,
    backgroundUpdateTool,
    backgroundListTool,
    backgroundCancelTool,
    sessionListTool,
    sessionSearchTool,
    sessionGetTool,
    ...createTaskTools({ getSession, initialCwd }),
  ];

  const resolution = loadOpenAgentConfig(resolveCwd(initialCwd));
  const disabledToolSet = new Set(resolution.config.disabledTools);
  return allTools.filter((tool) => !disabledToolSet.has(tool.name));
}
