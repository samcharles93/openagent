import type { CopilotSession } from "@github/copilot-sdk";
import { joinSession } from "@github/copilot-sdk/extension";
import { initializeOpenAgentAgentState } from "./agent-selection.js";
import { createCustomAgents } from "./agents.js";
import { createCommands } from "./commands.js";
import {
  formatOpenAgentCompactionStatus,
  noteOpenAgentCompactionComplete,
  noteOpenAgentCompactionStart,
  OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD,
  OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD,
  recordOpenAgentUsage,
} from "./compaction.js";
import { loadOpenAgentConfig } from "./config.js";
import { createHooks } from "./hooks.js";
import {
  buildOpenAgentLoopPrompt,
  clearOpenAgentLoopState,
  OPENAGENT_LOOP_DONE_SENTINEL,
  readOpenAgentLoopState,
  writeOpenAgentLoopState,
} from "./loop-state.js";
import { createPermissionHandler } from "./permissions.js";
import { buildSystemPrompt } from "./prompt.js";
import {
  recordLoopCancel,
  recordLoopComplete,
  recordLoopIteration,
} from "./telemetry.js";
import { createTools } from "./tools.js";

const initialCwd = process.cwd();
const initialResolution = loadOpenAgentConfig(initialCwd);

let sessionRef: CopilotSession | undefined;

function getSession(): CopilotSession {
  if (!sessionRef) {
    throw new Error("OpenAgent session is not ready yet.");
  }

  return sessionRef;
}

const session = await joinSession({
  agent: initialResolution.config.autoSelectAgent
    ? initialResolution.config.defaultAgent
    : undefined,
  commands: createCommands({ getSession, initialCwd }),
  customAgents: createCustomAgents(initialResolution.config),
  hooks: createHooks({ initialCwd, getSession }),
  infiniteSessions: {
    enabled: true,
    backgroundCompactionThreshold: OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD,
    bufferExhaustionThreshold: OPENAGENT_BUFFER_EXHAUSTION_THRESHOLD,
  },
  onPermissionRequest: createPermissionHandler({ initialCwd }),
  systemMessage: {
    mode: "append",
    content: buildSystemPrompt(initialResolution.config),
  },
  tools: createTools({ getSession, initialCwd }),
});

sessionRef = session;

await initializeOpenAgentAgentState({
  session,
  config: initialResolution.config,
});

session.on("session.idle", async (event) => {
  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  if (event.data.aborted) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config,
    });
    recordLoopCancel();
    await session.log(
      "OpenAgent noticed that the previous agentic loop was aborted.",
      { level: "warning", ephemeral: true },
    );
    return;
  }

  const loopState = await readOpenAgentLoopState({
    session,
    config: resolution.config,
  });
  if (!loopState) {
    return;
  }

  const messages = await session.getMessages();
  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.type === "assistant.message");
  const lastContent =
    lastAssistantMessage && lastAssistantMessage.type === "assistant.message"
      ? lastAssistantMessage.data.content
      : "";

  if (lastContent.includes(OPENAGENT_LOOP_DONE_SENTINEL)) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config,
    });
    recordLoopComplete();
    await session.log("OpenAgent completed the active continuation loop.", {
      ephemeral: true,
    });
    return;
  }

  if (loopState.iterations + 1 >= loopState.maxIterations) {
    await clearOpenAgentLoopState({
      session,
      config: resolution.config,
    });
    await session.log(
      `OpenAgent stopped /oa-loop after reaching the ${loopState.maxIterations}-iteration cap.`,
      { level: "warning", ephemeral: true },
    );
    return;
  }

  const nextIterations = loopState.iterations + 1;
  recordLoopIteration();
  await writeOpenAgentLoopState({
    session,
    config: resolution.config,
    state: {
      ...loopState,
      iterations: nextIterations,
      updatedAt: new Date().toISOString(),
    },
  });
  await session.log(
    `OpenAgent continuing /oa-loop iteration ${nextIterations + 1} of ${loopState.maxIterations}.`,
    { ephemeral: true },
  );
  await session.send({
    prompt: buildOpenAgentLoopPrompt({
      goal: loopState.goal,
      iterations: nextIterations,
      maxIterations: loopState.maxIterations,
    }),
  });
});

session.on("session.usage_info", async (event) => {
  const usage = recordOpenAgentUsage({
    tokenLimit: event.data.tokenLimit,
    currentTokens: event.data.currentTokens,
    messagesLength: event.data.messagesLength,
    systemTokens: event.data.systemTokens,
    conversationTokens: event.data.conversationTokens,
    toolDefinitionsTokens: event.data.toolDefinitionsTokens,
  });

  if (!event.data.isInitial && usage.ratio >= OPENAGENT_PREEMPTIVE_COMPACTION_THRESHOLD) {
    await session.log(
      `OpenAgent observed ${(usage.ratio * 100).toFixed(1)}% context usage and will rely on session compaction checkpoints to stay ahead of overflow.`,
      { ephemeral: true },
    );
  }
});

session.on("session.compaction_start", async () => {
  noteOpenAgentCompactionStart();
  await session.log("OpenAgent started a preemptive compaction pass.", {
    ephemeral: true,
  });
});

session.on("session.compaction_complete", async (event) => {
  const resolution = loadOpenAgentConfig(process.cwd() || initialCwd);
  const result = await noteOpenAgentCompactionComplete({
    session,
    config: resolution.config,
    ...event.data,
  });
  await session.log(result.message, {
    level: event.data.success ? "info" : "warning",
    ephemeral: true,
  });
});

session.on("session.error", async (event) => {
  await session.log(`OpenAgent observed a session error: ${event.data.message}`, {
    level: "warning",
    ephemeral: true,
  });
});

await session.log(
  initialResolution.sources.length > 0
    ? `OpenAgent harness loaded with config from ${initialResolution.sources.join(", ")}.`
    : "OpenAgent harness loaded with built-in defaults.",
  { ephemeral: true },
);
await session.log(formatOpenAgentCompactionStatus(), { ephemeral: true });
