import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { createBundledCopilotSession } from "./copilot-setup.js";

export type OpenAgentLookAtResult = {
  filePath: string;
  mimeType: string;
  strategy: "assistant" | "pdf" | "image" | "text" | "binary";
  output: string;
};

function resolveTargetPath(cwd: string, rawPath: string): string {
  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  if (!existsSync(absolute)) {
    throw new Error(`look_at target "${rawPath}" does not exist.`);
  }
  return absolute;
}

function runCommand(name: string, args: string[]): string | null {
  const result = spawnSync(name, args, { encoding: "utf8" });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return null;
    }
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    return null;
  }
  const stdout = result.stdout.trim();
  return stdout.length > 0 ? stdout : null;
}

function detectMimeType(filePath: string): string {
  return runCommand("file", ["-b", "--mime-type", filePath]) ?? "application/octet-stream";
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}

function buildPdfFallback(filePath: string, prompt?: string): string {
  const info = runCommand("pdfinfo", [filePath]);
  const text = runCommand("pdftotext", ["-layout", filePath, "-"]);
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this PDF.",
    "",
    "## PDF metadata",
    info ?? "pdfinfo is unavailable.",
    "",
    "## Extracted text preview",
    text ? truncate(text, 6000) : "pdftotext is unavailable or the PDF text could not be extracted.",
  ].join("\n");
}

function buildImageFallback(filePath: string, prompt?: string): string {
  const mime = detectMimeType(filePath);
  const identify = runCommand("identify", [filePath]);
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this image.",
    "",
    `MIME type: ${mime}`,
    "## Image metadata",
    identify ?? "ImageMagick identify is unavailable.",
    "",
    "## Local fallback",
    "OpenAgent could not complete bundled model-based inspection, so this result is limited to local metadata.",
  ].join("\n");
}

async function buildTextFallback(filePath: string, prompt?: string): Promise<string> {
  const content = await readFile(filePath, "utf8");
  return [
    prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this text artifact.",
    "",
    "## Text preview",
    truncate(content, 6000),
  ].join("\n");
}

function buildBinaryFallback(mimeType: string, prompt?: string): string {
  return [
    prompt?.trim().length
      ? `Requested analysis: ${prompt.trim()}`
      : "Requested analysis: inspect this binary artifact.",
    "",
    `MIME type: ${mimeType}`,
    "OpenAgent could not inspect this file with the bundled Copilot runtime and has no local extractor for this artifact type.",
  ].join("\n");
}

async function buildFallbackOutput(args: {
  filePath: string;
  mimeType: string;
  prompt?: string;
}): Promise<OpenAgentLookAtResult> {
  if (args.mimeType === "application/pdf") {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "pdf",
      output: buildPdfFallback(args.filePath, args.prompt),
    };
  }

  if (args.mimeType.startsWith("image/")) {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "image",
      output: buildImageFallback(args.filePath, args.prompt),
    };
  }

  if (args.mimeType.startsWith("text/") || args.mimeType === "application/json") {
    return {
      filePath: args.filePath,
      mimeType: args.mimeType,
      strategy: "text",
      output: await buildTextFallback(args.filePath, args.prompt),
    };
  }

  return {
    filePath: args.filePath,
    mimeType: args.mimeType,
    strategy: "binary",
    output: buildBinaryFallback(args.mimeType, args.prompt),
  };
}

export function buildOpenAgentLookAtPrompt(args: {
  filePath: string;
  prompt?: string;
}): string {
  return [
    args.prompt?.trim().length
      ? `Inspect the attached file and answer this request: ${args.prompt.trim()}`
      : "Inspect the attached file. Extract the important visible or embedded text, describe the content concisely, and call out anything risky, surprising, or relevant to the current task.",
    "",
    `Attached file: ${path.basename(args.filePath)}`,
    "Prefer concrete extraction over vague description.",
  ].join("\n");
}

async function runBundledAssistantLookAt(args: {
  cwd: string;
  filePath: string;
  prompt?: string;
}): Promise<string> {
  let handle;
  try {
    handle = await createBundledCopilotSession({
      cwd: args.cwd,
      sessionConfig: {
        streaming: false,
        infiniteSessions: { enabled: false },
      },
    });
    const response = await handle.session.sendAndWait(
      {
        prompt: buildOpenAgentLookAtPrompt({
          filePath: args.filePath,
          prompt: args.prompt,
        }),
        attachments: [{ type: "file", path: args.filePath }],
      },
      90_000,
    );
    const content = response?.data.content?.trim();
    if (!content) {
      throw new Error("Bundled Copilot inspection returned no content.");
    }
    return content;
  } finally {
    if (handle) {
      await handle.dispose();
    }
  }
}

export async function runOpenAgentLookAt(args: {
  cwd: string;
  file: string;
  prompt?: string;
}): Promise<OpenAgentLookAtResult> {
  const filePath = resolveTargetPath(args.cwd, args.file);
  const mimeType = detectMimeType(filePath);

  try {
    const output = await runBundledAssistantLookAt({
      cwd: args.cwd,
      filePath,
      prompt: args.prompt,
    });
    return {
      filePath,
      mimeType,
      strategy: "assistant",
      output,
    };
  } catch (error) {
    const fallback = await buildFallbackOutput({
      filePath,
      mimeType,
      prompt: args.prompt,
    });
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...fallback,
      output: [
        `Primary bundled inspection failed: ${message}`,
        "",
        fallback.output,
      ].join("\n"),
    };
  }
}
