import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
const require = createRequire(import.meta.url);
function tryResolve(value) {
    try {
        const resolved = value();
        return existsSync(resolved) ? resolved : null;
    }
    catch {
        return null;
    }
}
export function resolveBundledAstGrepBinary() {
    const packageJsonPath = tryResolve(() => require.resolve("@ast-grep/cli/package.json"));
    if (!packageJsonPath) {
        return null;
    }
    const packageRoot = path.dirname(packageJsonPath);
    const directCandidates = process.platform === "win32"
        ? [
            path.join(packageRoot, "ast-grep.exe"),
            path.join(packageRoot, "sg.exe"),
            path.join(packageRoot, "ast-grep"),
            path.join(packageRoot, "sg"),
        ]
        : [path.join(packageRoot, "ast-grep"), path.join(packageRoot, "sg")];
    const directBinary = directCandidates.find((candidate) => existsSync(candidate)) ?? null;
    if (directBinary) {
        if (path.extname(directBinary).toLowerCase() === ".exe") {
            return directBinary;
        }
        try {
            const shimPreview = readFileSync(directBinary, "utf8");
            if (!shimPreview.includes("shim file was executed")) {
                return directBinary;
            }
        }
        catch {
            return directBinary;
        }
    }
    const parts = [process.platform, process.arch];
    if (process.platform === "linux") {
        const report = process.report?.getReport();
        const isMusl = !report?.header?.glibcVersionRuntime;
        if (isMusl) {
            parts.push("musl");
        }
        else if (process.arch === "arm") {
            parts.push("gnueabihf");
        }
        else {
            parts.push("gnu");
        }
    }
    else if (process.platform === "win32") {
        parts.push("msvc");
    }
    const platformPackage = tryResolve(() => require.resolve(`@ast-grep/cli-${parts.join("-")}/package.json`));
    if (!platformPackage) {
        return directBinary;
    }
    const platformRoot = path.dirname(platformPackage);
    const binaryName = process.platform === "win32" ? "ast-grep.exe" : "ast-grep";
    return path.join(platformRoot, binaryName);
}
export function resolveBundledCopilotCliPath() {
    const sdkEntry = tryResolve(() => require.resolve("@github/copilot-sdk"));
    if (!sdkEntry) {
        return null;
    }
    const sdkPackageRoot = path.resolve(path.dirname(sdkEntry), "..", "..");
    const copilotPackageRoot = path.resolve(sdkPackageRoot, "../copilot");
    const candidates = [
        path.join(copilotPackageRoot, "npm-loader.js"),
        path.join(copilotPackageRoot, "index.js"),
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}
