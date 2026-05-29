# OpenAgent Core Architecture

You are operating inside the OpenAgent codebase.  Follow these structural invariants
when adding features, fixing bugs, or refactoring.

---

## 1. Build & Runtime

- **Source:** `src/` (TypeScript `.mts` and `.ts`, ES2022, NodeNext module resolution).
- **Compiled bundle:** `dist/extension.mjs` — produced by `bun build`, targeting Node ESM.
- **Dependencies:** `@github/copilot-sdk` v1.0.0-beta.7, `@ast-grep/cli`, `jsonc-parser`.
- **Tests:** `bun test` (Bun native test runner).  Typecheck with `bun run typecheck`.
- Do NOT add native C-extensions or runtime deps that break inside the Copilot extension sandbox.

## 2. Extension Entry Point

- `src/extension.mts` — wires the full lifecycle: config load, command/agent/hook/tool registration,
  session join, agent/model init, abort/error logging.
- SDK custom agents defined in `src/agents.ts`.  Native Copilot agent profiles live in
  `.github/agents/*.agent.md` and are installed to `~/.copilot/agents/` by `scripts/setup-copilot-agents.mjs`.

## 3. Agent Definitions

- **SDK agents** (`src/agents.ts`): `conductor`, `architect`, `skeptic`, `scout`, `builder`,
  `auditor`, `oracle`, `tester`, `sleuth`.  Each has a `prompt` string, `displayName`,
  `description`, and optional tool restrictions in `src/agent-models.ts`.
- **Native agents** (`.github/agents/*.agent.md`): `openagent-orchestrator`, `openagent-planner`,
  `openagent-critic`, `openagent-explorer`, `openagent-researcher`, `openagent-implementer`,
  `openagent-reviewer`, `openagent-oracle`, `openagent-qa`.  YAML frontmatter defines name,
  tools, handoffs.  These are the `copilot --agent <name>` entry points.
- Keep SDK and native agent behaviors aligned between `src/agents.ts` and the `.agent.md` files.

## 4. Routing & Phases

- Five phases: `orchestrator`, `planner`, `researcher`, `implementer`, `reviewer` (`src/routing.ts`).
- Phase → default agent mapping:
  - orchestrator → conductor
  - planner → architect / skeptic
  - researcher → sleuth / scout
  - implementer → builder (via fleet dispatch, never direct route)
  - reviewer → auditor / oracle / tester
- DO NOT route directly to `implementer` phase — use `openagent_fleet` + `agent` tool for
  parallel wave dispatch.

## 5. Fleet Dispatch

- `src/fleet.ts` — `openagent_fleet` registers implementation waves.
- Builders within a wave run in **parallel** and must have non-overlapping file scopes.
- Builders are **one-shot and terminal** — never call `write_agent` on a completed builder.

## 6. Tool Registration

- All 25 tools registered in `src/tools.ts` and `src/task-tools.ts`.
- Every tool must return descriptive error strings instead of throwing unhandled exceptions
  that crash the agent loop.
- Tool schemas are strict and type-checked.

## 7. Config & Workspace

- Config: `src/config.ts` — user config at `~/.copilot/openagent.jsonc`, project config at
  `.github/openagent.jsonc` or `.openagent.jsonc`.
- Workspace: `src/workspace.ts` — durable notes under `files/openagent/` in the session workspace.
- Route state: persisted in `files/openagent/routing/routing-state.json`.

## 8. Hooks & Guardrails

- `src/hooks.ts` (607 lines) — `onPreToolUse` blocks destructive shell patterns,
  prevents create-overwrite, enforces agent tool-denial, injects project context.
- `onPostToolUse` truncates large tool results and records failures.
- Model fallback: `src/model-fallback.ts` + `src/agent-models.ts` manage per-agent fallback chains.

## 9. Skills & Context

- `src/skill-loader.ts` — discovers and loads skill markdown files.
- `src/context-loader.ts` — loads `AGENTS.md` before other project docs.
- `.openagent/rules/` — continuous-improvement.md, memory-policy.md, ast-grep-templates.md,
  and this file are loaded as context for agents working on OpenAgent itself.

## 10. Safe Edit & Safety

- `src/safe-edit.ts` — hash-verified line-targeted edits with pre-edit backup snapshots.
- Backups stored in `<workspace>/.openagent-backups/`.
- Rollback available via `rollbackOpenAgentSafeEdit` / `listOpenAgentSafeEditBackups`.
