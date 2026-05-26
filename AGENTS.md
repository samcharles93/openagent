# AGENTS.md

## Overview

OpenAgent is a Copilot CLI extension harness for orchestration-first work. Source of truth is `src/`; `.github/extensions/openagent/` is compiled output. This file is loaded first by `src/context-loader.ts`, so keep it compact and source-backed.

## Core flow

`src/extension.mts` wires the session in this order:

1. Load config from `src/config.ts`
2. Create commands, custom agents, hooks, permission handler, system prompt, and tools
3. Join the Copilot session
4. Initialize the selected agent/model state
5. Log abort/error events

## Where to edit

- Entry point: `src/extension.mts`
- Agents: `src/agents.ts`
- Native Copilot agents: `.github/agents/*.agent.md`
- Routing/handoffs: `src/routing.ts`
- Commands: `src/commands.ts`
- Tools/tasks: `src/tools.ts`, `src/task-tools.ts`
- Config: `src/config.ts`
- Context loading: `src/context-loader.ts`
- Hooks/guardrails: `src/hooks.ts`
- Categories/model policy: `src/categories.ts`, `src/agent-models.ts`
- Workspace persistence: `src/workspace.ts`

## Personas and phases

Default routing in `src/routing.ts`:

- `orchestrator` -> `conductor`
- `planner` -> `architect`, `skeptic`
- `researcher` -> `sleuth`, `scout`
- `reviewer` -> `auditor`, `oracle`, `tester`

Implementation is dispatched via `openagent_fleet` + the `agent` tool — **not** via `openagent_route_phase`. The `implementer` phase has been removed; routing directly to it will error.

Modes: `planner` = `plan`; `orchestrator`, `researcher`, and `reviewer` = `interactive`

## Commands

Slash commands in `src/commands.ts`:

`oa-init-deep`, `oa-doctor`, `oa-status`, `oa-plan`, `oa-autopilot`, `oa-agent`, `oa-start`, `oa-plan-review`, `oa-route`, `oa-refactor`, `oa-handoff`, `oa-review`, `oa-start-work`

Use `oa-route` or `openagent_route_phase` when switching phases. For implementation, use `openagent_fleet` to register tasks and the `agent` tool to dispatch builders.

## Tools

OpenAgent exposes 25 tools.

- Planning/workspace: `openagent_runtime_status`, `openagent_bootstrap_task`, `openagent_plan_note`, `openagent_workspace_note`, `openagent_route_phase`, `openagent_plan_review`
- Fleet dispatch: `openagent_fleet` — register implementation waves and get ready-to-dispatch builder payloads
- Diagnostics/memory/edit safety: `openagent_doctor`, `openagent_memory_write`, `openagent_memory_read`, `openagent_memory_list`, `openagent_safe_edit`
- Orchestration/history: `openagent_background_*`, `openagent_session_*`, `openagent_delegate`, `openagent_categories_list`
- Task tracking: `openagent_task_create`, `openagent_task_list`, `openagent_task_get`, `openagent_task_update`

## Config and workspace

User config: `~/.copilot/openagent.jsonc`, `~/.copilot/openagent.json`

Project config: `.github/openagent.jsonc`, `.github/openagent.json`, `.openagent.jsonc`, `.openagent.json`

`src/config.ts` owns defaults, overrides, guardrails, and the workspace notes directory.

Durable notes, routing handoffs, and related artifacts live under `files/openagent/` in the session workspace.

## Runtime notes

- `src/context-loader.ts` loads `AGENTS.md` before other project docs
- Continuous-improvement guidance lives in `.openagent/rules/*.md`
- `src/hooks.ts` adds plan bias for complex prompts, loads project context, enforces shell/create guardrails, truncates large tool results, and records session summaries
- `src/categories.ts` defines six built-in delegation categories: `deep`, `quick`, `research`, `review`, `planning`, `writing`

## Conventions

- Edit `src/`, not `.github/extensions/openagent/`
- Keep claims source-backed; do not document aspirational behavior
- Keep published docs, package metadata, installer defaults, and examples free of local machine paths, private network addresses, secrets, and accidental personal data
- Keep SDK custom agents in `src/agents.ts` and native Copilot profiles in `.github/agents/*.agent.md` behaviorally aligned
- Prefer the existing plan, route, workspace, and task abstractions over parallel ad hoc flows
- Honor `tsconfig.json` (`ES2022`, `NodeNext`, `strict`)
- Keep `AGENTS.md` dense and front-loaded; the first ~4000 characters matter most at runtime

## Anti-patterns

- Do not hand-edit compiled extension output
- Do not bypass workspace-backed handoffs for multi-step work
- Do not use `openagent_route_phase` with `phase: "implementer"` — this is guarded and will error. Use `openagent_fleet` instead.
- Do not call `write_agent` on completed builders — they are one-shot and terminal
- Do not let `AGENTS.md` grow into long prose that hides the operational guidance
- Do not add tool or command behavior without wiring the actual registries

## Validation

- `bun run typecheck`
- `bun test`
