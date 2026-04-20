import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
const MAX_SKILLS = 20;
export function parseSkillFrontmatter(raw) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (!match) {
        return null;
    }
    const frontmatterBlock = match[1];
    const content = match[2].trim();
    let name;
    let description;
    const triggers = [];
    const lines = frontmatterBlock.split(/\r?\n/);
    let parsingTriggers = false;
    for (const line of lines) {
        if (/^name:\s*/.test(line)) {
            name = line.replace(/^name:\s*/, "").trim();
            parsingTriggers = false;
            continue;
        }
        if (/^description:\s*/.test(line)) {
            description = line.replace(/^description:\s*/, "").trim();
            parsingTriggers = false;
            continue;
        }
        if (/^triggers:\s*$/.test(line)) {
            parsingTriggers = true;
            continue;
        }
        if (parsingTriggers && /^\s+-\s+/.test(line)) {
            const value = line.replace(/^\s+-\s+/, "").trim();
            if (value.length > 0) {
                triggers.push(value);
            }
            continue;
        }
        if (/^\S/.test(line)) {
            parsingTriggers = false;
        }
    }
    if (!name || !description) {
        return null;
    }
    return { name, description, triggers, content };
}
function scanSkillDirectory(dir) {
    try {
        if (!existsSync(dir)) {
            return [];
        }
        const entries = readdirSync(dir, { withFileTypes: true });
        const paths = [];
        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }
            const skillFile = path.join(dir, entry.name, "SKILL.md");
            if (existsSync(skillFile)) {
                paths.push(skillFile);
            }
        }
        return paths;
    }
    catch {
        return [];
    }
}
export function discoverSkillFiles(cwd) {
    const projectDir = path.join(cwd, ".openagent", "skills");
    const userDir = path.join(os.homedir(), ".copilot", "skills");
    return [...scanSkillDirectory(projectDir), ...scanSkillDirectory(userDir)];
}
export async function loadSkills(cwd) {
    const files = discoverSkillFiles(cwd);
    const skills = [];
    for (const filePath of files) {
        if (skills.length >= MAX_SKILLS) {
            break;
        }
        try {
            const raw = await readFile(filePath, "utf-8");
            const parsed = parseSkillFrontmatter(raw);
            if (!parsed) {
                continue;
            }
            skills.push({
                name: parsed.name,
                description: parsed.description,
                triggers: parsed.triggers,
                content: parsed.content,
                source: filePath,
            });
        }
        catch {
            continue;
        }
    }
    return skills;
}
export function formatSkillsForPrompt(skills) {
    if (skills.length === 0) {
        return "";
    }
    const lines = ["Available OpenAgent skills:"];
    for (const skill of skills) {
        const triggerNote = skill.triggers.length > 0
            ? ` (triggers: ${skill.triggers.join(", ")})`
            : "";
        lines.push(`- ${skill.name}: ${skill.description}${triggerNote}`);
    }
    return lines.join("\n");
}
export function matchSkillByTrigger(skills, userPrompt) {
    const normalized = userPrompt.toLowerCase();
    const words = new Set(normalized.split(/\s+/));
    return skills.filter((skill) => skill.triggers.some((trigger) => words.has(trigger.toLowerCase()) ||
        normalized.includes(trigger.toLowerCase())));
}
