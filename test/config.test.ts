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
      assert.ok(isOpenAgentAgentName("conductor"));
      assert.ok(isOpenAgentAgentName("architect"));
      assert.ok(isOpenAgentAgentName("skeptic"));
      assert.ok(isOpenAgentAgentName("sleuth"));
      assert.ok(isOpenAgentAgentName("scout"));
      assert.ok(isOpenAgentAgentName("builder"));
      assert.ok(isOpenAgentAgentName("auditor"));
      assert.ok(isOpenAgentAgentName("oracle"));
      assert.ok(isOpenAgentAgentName("tester"));
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

    it("does not start with openagent- prefix", () => {
      for (const name of OPENAGENT_AGENT_NAMES) {
        assert.ok(!name.startsWith("openagent-"), `${name} should not start with openagent-`);
      }
    });
  });

  describe("formatModelTarget", () => {
    it("formats model without reasoning effort", () => {
      assert.equal(formatModelTarget({ model: "gpt-5.5" }), "gpt-5.5");
    });

    it("formats model with reasoning effort", () => {
      assert.equal(
        formatModelTarget({ model: "claude-opus-4.6", reasoningEffort: "high" }),
        "claude-opus-4.6 (high)",
      );
    });
  });

  describe("formatModelTargets", () => {
    it("formats empty array as none", () => {
      assert.equal(formatModelTargets([]), "none");
    });

    it("formats multiple targets with arrow separator", () => {
      const result = formatModelTargets([
        { model: "gpt-5.5" },
        { model: "claude-sonnet-4.6", reasoningEffort: "medium" },
      ]);
      assert.equal(result, "gpt-5.5 -> claude-sonnet-4.6 (medium)");
    });
  });

  describe("loadOpenAgentConfig", () => {
    it("returns default config for nonexistent directory", () => {
      const resolution = loadOpenAgentConfig("/tmp/nonexistent-openagent-test-path");
      assert.equal(resolution.config.defaultAgent, "conductor");
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
