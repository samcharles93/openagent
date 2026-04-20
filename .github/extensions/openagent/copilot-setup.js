import { CopilotClient, approveAll, } from "@github/copilot-sdk";
import { resolveBundledCopilotCliPath } from "./bundled-deps.js";
export function getBundledCopilotCliPathOrThrow() {
    const cliPath = resolveBundledCopilotCliPath();
    if (!cliPath) {
        throw new Error("Bundled Copilot CLI runtime is unavailable.");
    }
    return cliPath;
}
export function createBundledCopilotClient() {
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
export async function createBundledCopilotSession(args) {
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
            await session.disconnect().catch(() => { });
            await client.stop().catch(() => []);
        },
    };
}
