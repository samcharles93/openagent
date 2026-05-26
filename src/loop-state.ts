import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { CopilotSession } from "@github/copilot-sdk";
import type { OpenAgentConfig } from "./config";
import { getOpenAgentWorkspacePaths, requireOpenAgentWorkspacePath } from "./workspace";

export const OPENAGENT_LOOP_DONE_SENTINEL = "<promise>DONE</promise>";

export type OpenAgentLoopState = {
  goal: string;
  iterations: number;
  maxIterations: number;
  active: boolean;
  startedAt: string;
  updatedAt: string;
};

function getLoopStateFile(session: CopilotSession, config: OpenAgentConfig): string {
  requireOpenAgentWorkspacePath(session, "OpenAgent loop");
  const paths = getOpenAgentWorkspacePaths({ session, config });
  return path.join(paths.notesRoot, "loops", "state.json");
}

export function buildOpenAgentLoopPrompt(args: {
  goal: string;
  iterations: number;
  maxIterations: number;
}): string {
  return [
    `Continue working on this goal until it is actually complete: ${args.goal}`,
    "",
    `This is continuation iteration ${args.iterations + 1} of ${args.maxIterations}.`,
    "When you believe the goal is complete, verify your work: read every changed file, run the project's build and test commands, and confirm the output matches expectations.",
    `Only after verification passes, include the exact sentinel ${OPENAGENT_LOOP_DONE_SENTINEL} in your final response. The orchestrator will perform a final review before accepting completion.`,
    "If the goal is not complete yet, keep making progress and leave the session in a state where the next continuation can pick up cleanly.",
    "Use the current session plan, routing state, and workspace notes as the durable source of truth.",
  ].join("\n");
}

export async function readOpenAgentLoopState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<OpenAgentLoopState | null> {
  const filePath = getLoopStateFile(args.session, args.config);
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as OpenAgentLoopState;
    return parsed.active ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeOpenAgentLoopState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
  state: OpenAgentLoopState;
}): Promise<void> {
  const filePath = getLoopStateFile(args.session, args.config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(args.state, null, 2), "utf8");
}

export async function clearOpenAgentLoopState(args: {
  session: CopilotSession;
  config: OpenAgentConfig;
}): Promise<void> {
  const filePath = getLoopStateFile(args.session, args.config);
  if (!existsSync(filePath)) {
    return;
  }

  await rm(filePath, { force: true });
}
