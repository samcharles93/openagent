import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession, SessionConfig, ToolResultObject } from "@github/copilot-sdk";
import { loadAncestorAgentContext } from "./agents-md";
import { isToolDeniedForAgent, switchSessionModelTarget } from "./agent-models";
import type { OpenAgentAgentName } from "./config";
import { formatModelTarget, loadOpenAgentConfig } from "./config";
import { recordContinuousImprovementArtifact } from "./continuous-improvement";
import { formatProjectContext, loadProjectContext } from "./context-loader";
import { advanceFallback, syncFallbackState } from "./model-fallback";
import {
  buildPromptContext,
  expandUltraworkPrompt,
  isUltraworkPrompt,
  looksComplexPrompt,
} from "./prompt";
import { recordSessionEnd } from "./session-history";
import { loadSkills, matchSkillByTrigger } from "./skill-loader";
import {
  recordToolCall,
  recordToolDenied,
  recordToolFailure,
} from "./telemetry";
import { isOpenAgentWorkspaceAvailable, writeOpenAgentWorkspaceNote } from "./workspace";

type SessionHooks = NonNullable<SessionConfig["hooks"]>;
type SessionStartHookInput = Parameters<
  NonNullable<SessionHooks["onSessionStart"]>
>[0];
type UserPromptSubmittedHookInput = Parameters<
  NonNullable<SessionHooks["onUserPromptSubmitted"]>
>[0];
type PreToolUseHookInput = Parameters<
  NonNullable<SessionHooks["onPreToolUse"]>
>[0];
type PostToolUseHookInput = Parameters<
  NonNullable<SessionHooks["onPostToolUse"]>
>[0];
type SessionEndHookInput = Parameters<
  NonNullable<SessionHooks["onSessionEnd"]>
>[0];
type ErrorOccurredHookInput = Parameters<
  NonNullable<SessionHooks["onErrorOccurred"]>
>[0];

const SHELL_TOOL_NAMES = new Set(["bash", "powershell", "shell"]);
const EDIT_LIKE_TOOL_NAMES = new Set([
  "edit",
  "create",
  "write",
  "apply_patch",
  "openagent_safe_edit",
  "openagent_ast_replace",
  "openagent_lsp_rename",
]);
const WRITE_TOOL_NAMES = new Set(["create", "write"]);
const EDIT_TOOL_NAMES = new Set([
  "edit",
  "apply_patch",
  "openagent_safe_edit",
  "openagent_ast_replace",
  "openagent_lsp_rename",
]);
const READ_CONTEXT_TOOL_NAMES = new Set(["read", "view"]);

let currentAgentName: OpenAgentAgentName | null = null;
const editedFilesThisSession = new Set<string>();
const phasesVisitedThisSession = new Set<string>();

export function setCurrentAgentName(agentName: OpenAgentAgentName): void {
  currentAgentName = agentName;
}

export function getCurrentAgentName(): OpenAgentAgentName | null {
  return currentAgentName;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function extractShellCommand(toolArgs: unknown): string | null {
  if (!isRecord(toolArgs)) {
    return null;
  }

  const candidateKeys = ["command", "cmd", "script"];
  for (const key of candidateKeys) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function truncatePlainText(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}...`;
}

function extractFilePath(toolArgs: unknown): string | null {
  if (!isRecord(toolArgs)) {
    return null;
  }

  const candidateKeys = ["path", "file_path", "file"];
  for (const key of candidateKeys) {
    const value = toolArgs[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function truncateToolResult(
  toolResult: ToolResultObject,
  maxChars: number,
): ToolResultObject | undefined {
  if (toolResult.textResultForLlm.length <= maxChars) {
    return undefined;
  }

  const hiddenChars = toolResult.textResultForLlm.length - maxChars;
  return {
    ...toolResult,
    textResultForLlm:
      `${toolResult.textResultForLlm.slice(0, maxChars)}\n\n` +
      `[OpenAgent truncated ${hiddenChars} trailing characters to keep the context focused.]`,
  };
}

type RecoveryKind =
  | "context-window"
  | "tool-results"
  | "thinking-mismatch"
  | "empty-message"
  | "json-parse"
  | "generic";

function safeGetSession(getSession?: () => CopilotSession): CopilotSession | null {
  if (!getSession) {
    return null;
  }

  try {
    return getSession();
  } catch {
    return null;
  }
}

function classifyRecoveryError(error: string): {
  kind: RecoveryKind;
  description: string;
  shouldPersistNote: boolean;
} {
  const normalized = error.toLowerCase();

  if (
    normalized.includes("context window") ||
    normalized.includes("maximum context") ||
    normalized.includes("token limit") ||
    normalized.includes("too long")
  ) {
    return {
      kind: "context-window",
      description: "a context-window limit",
      shouldPersistNote: true,
    };
  }

  if (
    normalized.includes("tool result") ||
    normalized.includes("missing tool") ||
    normalized.includes("tool call id") ||
    normalized.includes("tool-part")
  ) {
    return {
      kind: "tool-results",
      description: "a missing or malformed tool-result state",
      shouldPersistNote: false,
    };
  }

  if (normalized.includes("thinking block") || normalized.includes("reasoning block")) {
    return {
      kind: "thinking-mismatch",
      description: "a thinking-block mismatch",
      shouldPersistNote: false,
    };
  }

  if (
    normalized.includes("empty message") ||
    normalized.includes("message content is empty") ||
    normalized.includes("no message content")
  ) {
    return {
      kind: "empty-message",
      description: "an empty-message response",
      shouldPersistNote: false,
    };
  }

  if (normalized.includes("json") && normalized.includes("parse")) {
    return {
      kind: "json-parse",
      description: "a JSON parse failure",
      shouldPersistNote: false,
    };
  }

  return {
    kind: "generic",
    description: "a recoverable runtime failure",
    shouldPersistNote: false,
  };
}

export function createHooks(args: {
  initialCwd: string;
  getSession?: () => CopilotSession;
}): SessionHooks {
  const { initialCwd, getSession } = args;
  const sessionStartTime = new Date().toISOString();

  return {
    onSessionStart: async (input: SessionStartHookInput) => {
      const cwd = input.workingDirectory || initialCwd;
      const resolution = loadOpenAgentConfig(cwd);
      const promptContext = buildPromptContext(resolution, {
        forcePlan: Boolean(input.initialPrompt),
      });

      const projectContext = await loadProjectContext(cwd);
      const additionalContext =
        projectContext.files.length > 0
          ? `${promptContext}\n\n${formatProjectContext(projectContext.files)}`
          : promptContext;

      return { additionalContext };
    },
    onUserPromptSubmitted: async (input: UserPromptSubmittedHookInput) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      const session = safeGetSession(getSession);
      if (session && currentAgentName) {
        try {
          const currentModel = await session.rpc.model.getCurrent();
          syncFallbackState(currentAgentName, currentModel.modelId ?? null);
        } catch {
          syncFallbackState(currentAgentName, null);
        }
      }

      if (isUltraworkPrompt(input.prompt, resolution.config)) {
        return {
          modifiedPrompt: expandUltraworkPrompt(),
          additionalContext: buildPromptContext(resolution, { forcePlan: true }),
        };
      }

      if (looksComplexPrompt(input.prompt, resolution.config)) {
        return {
          additionalContext: buildPromptContext(resolution, { forcePlan: true }),
        };
      }

      // Check for skill trigger matches
      const cwd = input.workingDirectory || initialCwd;
      const skills = await loadSkills(cwd);
      if (skills.length > 0) {
        const matched = matchSkillByTrigger(skills, input.prompt);
        if (matched.length > 0) {
          const skillDescriptions = matched
            .map((s) => `${s.name}: ${s.description}`)
            .join("; ");
          return {
            additionalContext: `Matched OpenAgent skills for this request: ${skillDescriptions}. Use the skill content for guidance.`,
          };
        }
      }

      return undefined;
    },
    onPreToolUse: async (input: PreToolUseHookInput) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      recordToolCall(input.toolName);

      if (EDIT_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath) {
          editedFilesThisSession.add(filePath);
        }
      }

      if (input.toolName === "openagent_route_phase") {
        const phase =
          isRecord(input.toolArgs) && typeof input.toolArgs.phase === "string"
            ? input.toolArgs.phase
            : null;
        if (phase) {
          phasesVisitedThisSession.add(phase);
        }
      }

      if (SHELL_TOOL_NAMES.has(input.toolName)) {
        const command = extractShellCommand(input.toolArgs);
        if (
          command &&
          resolution.config.guardrails.dangerousShellPatterns.some((pattern) =>
            new RegExp(pattern, "i").test(command),
          )
        ) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "OpenAgent blocked a destructive shell command based on its guardrail policy.",
          };
        }
      }

      if (WRITE_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath && existsSync(filePath)) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              "OpenAgent blocked creating a file that already exists. Use edit instead of create for existing files.",
          };
        }
      }

      if (currentAgentName) {
        const agentName = currentAgentName;
        if (isToolDeniedForAgent(input.toolName, agentName, resolution.config.agentOverrides)) {
          recordToolDenied();
          return {
            permissionDecision: "deny",
            permissionDecisionReason:
              `OpenAgent blocked tool "${input.toolName}" because the ${agentName} agent is not permitted to use it.`,
          };
        }
      }

      if (READ_CONTEXT_TOOL_NAMES.has(input.toolName)) {
        const filePath = extractFilePath(input.toolArgs);
        if (filePath) {
          const ancestorAgentFiles = await loadAncestorAgentContext({
            cwd: input.workingDirectory || initialCwd,
            targetPath: filePath,
          });

          if (ancestorAgentFiles.length > 0) {
            return {
              additionalContext: formatProjectContext(ancestorAgentFiles),
            };
          }
        }
      }

      return undefined;
    },
    onPostToolUse: async (input: PostToolUseHookInput) => {
      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      if (input.toolResult.resultType === "failure") {
        recordToolFailure();
      }
      const modifiedResult = truncateToolResult(
        input.toolResult,
        resolution.config.guardrails.truncateToolResultsOver,
      );

      const contextParts: string[] = [];

      if (EDIT_LIKE_TOOL_NAMES.has(input.toolName)) {
        contextParts.push(
          "OpenAgent reminder: after meaningful edits, reconcile the plan and consider what validation would prove the change.",
        );
      }

      if (
        EDIT_TOOL_NAMES.has(input.toolName) &&
        input.toolResult.resultType === "failure"
      ) {
        contextParts.push(
          "OpenAgent detected an edit failure. Common fixes: (1) re-read the file to get fresh content, (2) use a smaller/more targeted old_str, (3) check that the file hasn't been modified by another tool since you last read it.",
        );
      }

      const additionalContext =
        contextParts.length > 0 ? contextParts.join("\n") : undefined;

      if (!modifiedResult && !additionalContext) {
        return undefined;
      }

      return {
        modifiedResult,
        additionalContext,
      };
    },
    onSessionEnd: async (input: SessionEndHookInput) => {
      const parts = [`OpenAgent session ended with reason "${input.reason}".`];

      if (input.finalMessage) {
        parts.push(
          `Final response preview: ${truncatePlainText(input.finalMessage, 240)}`,
        );
      }

      const summary = parts.join(" ");

      try {
        const session = safeGetSession(getSession);
        const inputRecord = input as unknown as Record<string, unknown>;
        const workspacePath =
          typeof inputRecord.sessionWorkspacePath === "string"
            ? inputRecord.sessionWorkspacePath
            : typeof inputRecord.workspacePath === "string"
              ? inputRecord.workspacePath
              : null;
        const cwd =
          typeof inputRecord.workingDirectory === "string" ? inputRecord.workingDirectory : initialCwd;
        const resolution = loadOpenAgentConfig(cwd);

        if (workspacePath && workspacePath.length > 0) {
          await recordSessionEnd(workspacePath, resolution.config, {
            sessionId: `session-${Date.now()}`,
            startedAt: sessionStartTime,
            reason: typeof input.reason === "string" ? input.reason : "unknown",
            summary,
            agentName: currentAgentName,
            phasesVisited: [...phasesVisitedThisSession],
            keyFiles: [...editedFilesThisSession],
          });
        }

        const lastSessionContent = [
          `# Last Session`,
          ``,
          `**Ended:** ${new Date().toISOString()}`,
          `**Agent:** ${currentAgentName ?? "none"}`,
          `**Reason:** ${typeof input.reason === "string" ? input.reason : "unknown"}`,
          phasesVisitedThisSession.size > 0
            ? `**Phases:** ${[...phasesVisitedThisSession].join(", ")}`
            : `**Phases:** none`,
          ``,
          `## Summary`,
          ``,
          summary,
          ``,
          `## Files Touched`,
          ``,
          editedFilesThisSession.size > 0
            ? [...editedFilesThisSession].map((f) => `- ${f}`).join("\n")
            : "_No files edited._",
        ].join("\n");

        const openagentDir = path.join(cwd, ".openagent");
        await mkdir(openagentDir, { recursive: true });
        await writeFile(
          path.join(openagentDir, "last-session.md"),
          lastSessionContent,
          "utf8",
        );

        const gitignorePath = path.join(openagentDir, ".gitignore");
        if (!existsSync(gitignorePath)) {
          await writeFile(gitignorePath, "last-session.md\n", "utf8");
        }

        await recordContinuousImprovementArtifact({
          cwd,
          source: "session-end",
          title: "Session follow-up candidate",
          summary,
          evidence: [
            `Session reason: ${typeof input.reason === "string" ? input.reason : "unknown"}`,
            currentAgentName
              ? `Agent at session end: ${currentAgentName}`
              : "Agent at session end: none",
            input.finalMessage
              ? `Final message preview: ${truncatePlainText(input.finalMessage, 240)}`
              : "Final message preview unavailable",
          ],
          recommendations: [
            "Promote repeated lessons into `.openagent/rules/*.md` or `AGENTS.md` instead of relying on isolated session outputs.",
            "Store recurring but not-yet-stable repo guidance in repo-scoped memory.",
          ],
          session: session ?? undefined,
          config: resolution.config,
        });
      } catch {
        // Session history recording is best-effort
      }

      return {
        sessionSummary: summary,
      };
    },
    onErrorOccurred: async (input: ErrorOccurredHookInput) => {
      if (!input.recoverable) {
        return {
          errorHandling: "abort",
          userNotification:
            "OpenAgent stopped because the Copilot host marked the error as unrecoverable.",
        };
      }

      const resolution = loadOpenAgentConfig(input.workingDirectory || initialCwd);
      const recovery = classifyRecoveryError(input.error);
      const session = safeGetSession(getSession);
      const agentName = getCurrentAgentName();
      if (agentName) {
        let currentModelId: string | null = null;
        if (session) {
          try {
            const currentModel = await session.rpc.model.getCurrent();
            currentModelId = currentModel.modelId ?? null;
          } catch {
            currentModelId = null;
          }
        }

        const result = advanceFallback(agentName, {
          currentModelId,
          userOverrides: resolution.config.agentOverrides,
        });

        if (result !== null && session) {
          const switched = await switchSessionModelTarget(session, result.target);
          if (switched) {
            syncFallbackState(agentName, result.target.model);
            return {
              errorHandling: "retry",
              retryCount: 1,
              userNotification:
                `OpenAgent switched to fallback model ${formatModelTarget(result.target)} ` +
                `after ${recovery.description}.`,
            };
          }
        }

        if (result !== null) {
          return {
            errorHandling: "retry",
            retryCount: 1,
            userNotification:
              `OpenAgent prepared fallback target ${formatModelTarget(result.target)} ` +
              `after ${recovery.description}.`,
          };
        }
      }

      if (
        session &&
        recovery.shouldPersistNote &&
        isOpenAgentWorkspaceAvailable(session)
      ) {
        try {
          const note = await writeOpenAgentWorkspaceNote({
            session,
            config: resolution.config,
            relativePath: `recovery/${new Date().toISOString().replace(/[:.]/g, "-")}.md`,
            content: [
              "# OpenAgent recovery note",
              "",
              `Timestamp: ${new Date().toISOString()}`,
              `Error context: ${input.errorContext}`,
              `Recovery kind: ${recovery.kind}`,
              "",
              "## Error",
              input.error,
            ].join("\n"),
            mode: "replace",
          });

          return {
            errorHandling: "retry",
            retryCount: 1,
            userNotification:
              `OpenAgent is retrying after ${recovery.description}. ` +
              `Recovery note saved to ${note.workspaceRelativePath}.`,
          };
        } catch {
          // Fall back to plain retry below.
        }
      }

      return {
        errorHandling: "retry",
        retryCount: 1,
        userNotification: `OpenAgent is retrying after ${recovery.description}.`,
      };
    },
  };
}
