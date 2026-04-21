import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { createBundledCopilotSession } from "./copilot-setup.js";
const EXTENSION_MIME_TYPES = new Map([
    [".bmp", "image/bmp"],
    [".cjs", "text/plain"],
    [".cmd", "text/plain"],
    [".css", "text/css"],
    [".csv", "text/csv"],
    [".cts", "text/plain"],
    [".gif", "image/gif"],
    [".htm", "text/html"],
    [".html", "text/html"],
    [".ico", "image/x-icon"],
    [".ini", "text/plain"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/plain"],
    [".json", "application/json"],
    [".jsx", "text/plain"],
    [".md", "text/markdown"],
    [".mjs", "text/plain"],
    [".mts", "text/plain"],
    [".pdf", "application/pdf"],
    [".png", "image/png"],
    [".ps1", "text/plain"],
    [".psd1", "text/plain"],
    [".psm1", "text/plain"],
    [".scss", "text/plain"],
    [".sh", "text/plain"],
    [".svg", "image/svg+xml"],
    [".tif", "image/tiff"],
    [".tiff", "image/tiff"],
    [".toml", "text/plain"],
    [".ts", "text/plain"],
    [".tsv", "text/tab-separated-values"],
    [".tsx", "text/plain"],
    [".txt", "text/plain"],
    [".webp", "image/webp"],
    [".xml", "text/xml"],
    [".yaml", "text/yaml"],
    [".yml", "text/yaml"],
]);
const BASENAME_MIME_TYPES = new Map([
    [".editorconfig", "text/plain"],
    [".env", "text/plain"],
    [".gitattributes", "text/plain"],
    [".gitignore", "text/plain"],
    ["changelog", "text/plain"],
    ["dockerfile", "text/plain"],
    ["license", "text/plain"],
    ["makefile", "text/plain"],
    ["notice", "text/plain"],
    ["readme", "text/plain"],
]);
function resolveTargetPath(cwd, rawPath) {
    const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
    if (!existsSync(absolute)) {
        throw new Error(`look_at target "${rawPath}" does not exist.`);
    }
    return absolute;
}
function runCommand(name, args) {
    const result = spawnSync(name, args, { encoding: "utf8" });
    if (result.error) {
        const code = result.error.code;
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
export function inferMimeTypeFromPath(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    const extensionMimeType = EXTENSION_MIME_TYPES.get(extension);
    if (extensionMimeType) {
        return extensionMimeType;
    }
    return BASENAME_MIME_TYPES.get(path.basename(filePath).toLowerCase()) ?? null;
}
function detectMimeType(filePath) {
    return (inferMimeTypeFromPath(filePath) ??
        runCommand("file", ["-b", "--mime-type", filePath]) ??
        "application/octet-stream");
}
function truncate(value, maxChars) {
    return value.length <= maxChars ? value : `${value.slice(0, maxChars - 3).trimEnd()}...`;
}
function buildPdfFallback(filePath, prompt) {
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
function buildImageFallback(filePath, prompt) {
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
async function buildTextFallback(filePath, prompt) {
    const content = await readFile(filePath, "utf8");
    return [
        prompt ? `Requested analysis: ${prompt}` : "Requested analysis: inspect this text artifact.",
        "",
        "## Text preview",
        truncate(content, 6000),
    ].join("\n");
}
function buildBinaryFallback(mimeType, prompt) {
    return [
        prompt?.trim().length
            ? `Requested analysis: ${prompt.trim()}`
            : "Requested analysis: inspect this binary artifact.",
        "",
        `MIME type: ${mimeType}`,
        "OpenAgent could not inspect this file with the bundled Copilot runtime and has no local extractor for this artifact type.",
    ].join("\n");
}
async function buildFallbackOutput(args) {
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
export function buildOpenAgentLookAtPrompt(args) {
    return [
        args.prompt?.trim().length
            ? `Inspect the attached file and answer this request: ${args.prompt.trim()}`
            : "Inspect the attached file. Extract the important visible or embedded text, describe the content concisely, and call out anything risky, surprising, or relevant to the current task.",
        "",
        `Attached file: ${path.basename(args.filePath)}`,
        "Prefer concrete extraction over vague description.",
    ].join("\n");
}
async function runBundledAssistantLookAt(args) {
    let handle;
    try {
        handle = await createBundledCopilotSession({
            cwd: args.cwd,
            sessionConfig: {
                streaming: false,
                infiniteSessions: { enabled: false },
            },
        });
        const response = await handle.session.sendAndWait({
            prompt: buildOpenAgentLookAtPrompt({
                filePath: args.filePath,
                prompt: args.prompt,
            }),
            attachments: [{ type: "file", path: args.filePath }],
        }, 90_000);
        const content = response?.data.content?.trim();
        if (!content) {
            throw new Error("Bundled Copilot inspection returned no content.");
        }
        return content;
    }
    finally {
        if (handle) {
            await handle.dispose();
        }
    }
}
export async function runOpenAgentLookAt(args) {
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
    }
    catch (error) {
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
