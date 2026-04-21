import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOpenAgentAgentName,
  formatModelTarget,
  formatModelTargets,
  loadOpenAgentConfig,
  OPENAGENT_AGENT_NAMES,
} from "../src/config.js";

describe("config", () => {
  describe("isOpenAgentAgentName", () => {
    it("recognizes valid agent names", () => {
      assert.ok(isOpenAgentAgentName("openagent-orchestrator"));
      assert.ok(isOpenAgentAgentName("openagent-planner"));
      assert.ok(isOpenAgentAgentName("openagent-critic"));
      assert.ok(isOpenAgentAgentName("openagent-researcher"));
      assert.ok(isOpenAgentAgentName("openagent-explorer"));
      assert.ok(isOpenAgentAgentName("openagent-implementer"));
      assert.ok(isOpenAgentAgentName("openagent-reviewer"));
      assert.ok(isOpenAgentAgentName("openagent-oracle"));
      assert.ok(isOpenAgentAgentName("openagent-qa"));
    });

    it("rejects invalid agent names", () => {
      assert.ok(!isOpenAgentAgentName("unknown-agent"));
      assert.ok(!isOpenAgentAgentName(""));
      assert.ok(!isOpenAgentAgentName("orchestrator"));
    });
  });

  describe("OPENAGENT_AGENT_NAMES", () => {
    it("has exactly 9 agents", () => {
      assert.equal(OPENAGENT_AGENT_NAMES.length, 9);
    });

    it("all start with openagent- prefix", () => {
      for (const name of OPENAGENT_AGENT_NAMES) {
        assert.ok(name.startsWith("openagent-"), `${name} should start with openagent-`);
      }
    });
  });

  describe("formatModelTarget", () => {
    it("formats model without reasoning effort", () => {
      assert.equal(formatModelTarget({ model: "gpt-4.1" }), "gpt-4.1");
    });

    it("formats model with reasoning effort", () => {
      assert.equal(
        formatModelTarget({ model: "claude-opus-4", reasoningEffort: "high" }),
        "claude-opus-4 (high)",
      );
    });
  });

  describe("formatModelTargets", () => {
    it("formats empty array as none", () => {
      assert.equal(formatModelTargets([]), "none");
    });

    it("formats multiple targets with arrow separator", () => {
      const result = formatModelTargets([
        { model: "gpt-4.1" },
        { model: "claude-sonnet-4", reasoningEffort: "medium" },
      ]);
      assert.equal(result, "gpt-4.1 -> claude-sonnet-4 (medium)");
    });
  });

  describe("loadOpenAgentConfig", () => {
    it("returns default config for nonexistent directory", () => {
      const resolution = loadOpenAgentConfig("/tmp/nonexistent-openagent-test-path");
      assert.equal(resolution.config.defaultAgent, "openagent-orchestrator");
      assert.equal(resolution.config.autoSelectAgent, true);
      assert.ok(Array.isArray(resolution.config.systemDirectives));
      assert.ok(resolution.config.systemDirectives.length > 0);
      assert.deepEqual(resolution.sources, []);
    });

    it("returns valid guardrails config", () => {
      const { config } = loadOpenAgentConfig("/tmp/nonexistent-openagent-test-path");
      assert.ok(config.guardrails.dangerousShellPatterns.length > 0);
      assert.ok(config.guardrails.truncateToolResultsOver > 0);
    });

    it("returns valid workspace config", () => {
      const { config } = loadOpenAgentConfig("/tmp/nonexistent-openagent-test-path");
      assert.equal(config.workspace.notesDirectory, "openagent");
    });
  });
});
