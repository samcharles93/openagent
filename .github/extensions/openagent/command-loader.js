import { existsSync, readdirSync, readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const MAX_CUSTOM_COMMANDS = 50;
export function parseCommandFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        return null;
    }
    const frontmatterBlock = match[1];
    const content = match[2].trim();
    let name;
    let description;
    for (const line of frontmatterBlock.split(/\r?\n/)) {
        if (/^name:\s*/.test(line)) {
            name = line.replace(/^name:\s*/, "").trim();
            continue;
        }
        if (/^description:\s*/.test(line)) {
            description = line.replace(/^description:\s*/, "").trim();
        }
    }
    if (!name || !description || content.length === 0) {
        return null;
    }
    return { name, description, content };
}
function scanCommandDirectory(dir) {
    try {
        if (!existsSync(dir)) {
            return [];
        }
        return readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
            .map((entry) => path.join(dir, entry.name));
    }
    catch {
        return [];
    }
}
export function discoverCommandFiles(cwd) {
    const projectDir = path.join(cwd, ".openagent", "commands");
    const userDir = path.join(os.homedir(), ".config", "openagent", "commands");
    return [...scanCommandDirectory(projectDir), ...scanCommandDirectory(userDir)];
}
export function loadCustomCommands(cwd) {
    const commands = [];
    const seenNames = new Set();
    for (const filePath of discoverCommandFiles(cwd)) {
        if (commands.length >= MAX_CUSTOM_COMMANDS) {
            break;
        }
        try {
            const raw = readFileSync(filePath, "utf8");
            const parsed = parseCommandFrontmatter(raw);
            if (!parsed || seenNames.has(parsed.name)) {
                continue;
            }
            seenNames.add(parsed.name);
            commands.push({
                name: parsed.name,
                description: parsed.description,
                content: parsed.content,
                source: filePath,
            });
        }
        catch {
            continue;
        }
    }
    return commands;
}
export function renderCustomCommandPrompt(command, args) {
    const trimmedArgs = args.trim();
    if (command.content.includes("{{args}}")) {
        return command.content.replaceAll("{{args}}", trimmedArgs);
    }
    if (trimmedArgs.length === 0) {
        return command.content;
    }
    return [
        command.content,
        "",
        "## Command arguments",
        trimmedArgs,
    ].join("\n");
}
