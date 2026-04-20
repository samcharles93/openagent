import { writeOpenAgentMemory } from "./memory.js";
import { isOpenAgentWorkspaceAvailable, writeOpenAgentWorkspaceNote, } from "./workspace.js";
function toBullets(lines) {
    return lines.map((line) => `- ${line}`).join("\n");
}
function toSection(title, lines) {
    if (lines.length === 0) {
        return [];
    }
    return [title, toBullets(lines), ""];
}
function sanitizeSlug(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");
}
function buildPromotionGuidance(source) {
    const sourceSpecific = source === "doctor"
        ? "If the same environment or config issue recurs, promote the setup guidance into `.openagent/rules/` or `AGENTS.md` instead of leaving it in isolated doctor reports."
        : source === "review-workflow"
            ? "After the merged review verdict lands, promote repeated findings into `.openagent/rules/`, `AGENTS.md`, repo memory, or follow-up tasks."
            : "If the same session-level lesson repeats, promote it from memory into `.openagent/rules/` or `AGENTS.md` so future runs inherit it automatically.";
    return [
        sourceSpecific,
        "Use `.openagent/rules/*.md` for stable repo-wide operating rules.",
        "Use `AGENTS.md` for runtime-facing workflow and architecture guidance that should appear early in loaded context.",
        "Use repo-scoped memory for recurring repo-specific notes that are useful but not yet stable enough to become rules.",
        "Turn unresolved improvement work into tasks or plan items instead of leaving it as prose only.",
    ];
}
function buildArtifactContent(args) {
    return [
        "# OpenAgent continuous improvement note",
        "",
        `Timestamp: ${args.timestamp}`,
        `Source: ${args.source}`,
        `Title: ${args.title}`,
        "",
        "## Summary",
        args.summary.trim(),
        "",
        ...toSection("## Evidence", args.evidence),
        ...toSection("## Recommendations", args.recommendations),
        "## Promotion guidance",
        toBullets(buildPromotionGuidance(args.source)),
    ].join("\n");
}
export async function recordContinuousImprovementArtifact(args) {
    const timestamp = new Date().toISOString();
    const evidence = args.evidence?.filter((item) => item.trim().length > 0) ?? [];
    const recommendations = args.recommendations?.filter((item) => item.trim().length > 0) ?? [];
    const content = buildArtifactContent({
        timestamp,
        source: args.source,
        title: args.title,
        summary: args.summary,
        evidence,
        recommendations,
    });
    const memoryPath = await writeOpenAgentMemory({
        cwd: args.cwd,
        topic: `continuous-improvement/${args.source}/${timestamp.replace(/[:.]/g, "-")}`,
        content,
        mode: "replace",
    });
    let workspaceRelativePath = null;
    if (args.session &&
        args.config &&
        isOpenAgentWorkspaceAvailable(args.session)) {
        const slugBase = sanitizeSlug(args.title) || args.source;
        const note = await writeOpenAgentWorkspaceNote({
            session: args.session,
            config: args.config,
            relativePath: `improvements/${args.source}/${timestamp.replace(/[:.]/g, "-")}-${slugBase}.md`,
            content,
            mode: "replace",
        });
        workspaceRelativePath = note.workspaceRelativePath;
    }
    return {
        memoryRelativePath: memoryPath.relativePath,
        workspaceRelativePath,
        content,
    };
}
