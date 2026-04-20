import {
  CopilotClient,
  approveAll,
  type CopilotSession,
  type SessionConfig,
} from "@github/copilot-sdk";
import { resolveBundledCopilotCliPath } from "./bundled-deps.js";

export type BundledCopilotSessionHandle = {
  client: CopilotClient;
  session: CopilotSession;
  dispose: () => Promise<void>;
};

export function getBundledCopilotCliPathOrThrow(): string {
  const cliPath = resolveBundledCopilotCliPath();
  if (!cliPath) {
    throw new Error("Bundled Copilot CLI runtime is unavailable.");
  }
  return cliPath;
}

export function createBundledCopilotClient(): CopilotClient {
  return new CopilotClient({
    cliPath: getBundledCopilotCliPathOrThrow(),
    useLoggedInUser: true,
    logLevel: "error",
    env: {
      ...process.env,
      COPILOT_AUTO_UPDATE: "false",
      SESSION_ID: undefined,
    },
  });
}

export async function createBundledCopilotSession(args: {
  cwd: string;
  sessionConfig?: Omit<SessionConfig, "onPermissionRequest" | "workingDirectory">;
}): Promise<BundledCopilotSessionHandle> {
  const client = createBundledCopilotClient();
  const session = await client.createSession({
    ...args.sessionConfig,
    onPermissionRequest: approveAll,
    workingDirectory: args.cwd,
  });

  return {
    client,
    session,
    dispose: async () => {
      await session.disconnect().catch(() => {});
      await client.stop().catch(() => []);
    },
  };
}
