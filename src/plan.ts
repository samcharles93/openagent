import type { CopilotSession } from "@github/copilot-sdk";

export type SessionPlanWriteMode = "append" | "replace";

export type SessionPlanUpdateResult = {
  path: string | null;
  mode: SessionPlanWriteMode;
  previousContent: string;
  nextContent: string;
};

export async function updateSessionPlan(args: {
  session: CopilotSession;
  content: string;
  mode?: SessionPlanWriteMode;
}): Promise<SessionPlanUpdateResult> {
  const { session, content } = args;
  const requestedMode = args.mode === "replace" ? "replace" : "append";
  const currentPlan = await session.rpc.plan.read();
  const previousContent = currentPlan.content ?? "";
  const mode =
    requestedMode === "replace" || previousContent.trim().length === 0
      ? "replace"
      : "append";
  const nextContent =
    mode === "replace" ? content : `${previousContent.trimEnd()}\n\n${content}`;

  await session.rpc.plan.update({ content: nextContent });

  return {
    path: currentPlan.path ?? null,
    mode,
    previousContent,
    nextContent,
  };
}
