import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferOpenAgentPhase,
  isOpenAgentPhase,
  listOpenAgentPhases,
  OPENAGENT_PHASES,
} from "../.github/extensions/openagent/routing.js";

describe("routing", () => {
  describe("OPENAGENT_PHASES", () => {
    it("has exactly 5 phases", () => {
      assert.equal(OPENAGENT_PHASES.length, 5);
    });

    it("contains the expected phases", () => {
      assert.deepEqual([...OPENAGENT_PHASES], [
        "orchestrator",
        "planner",
        "researcher",
        "implementer",
        "reviewer",
      ]);
    });
  });

  describe("isOpenAgentPhase", () => {
    it("recognizes valid phases", () => {
      assert.ok(isOpenAgentPhase("orchestrator"));
      assert.ok(isOpenAgentPhase("planner"));
      assert.ok(isOpenAgentPhase("researcher"));
      assert.ok(isOpenAgentPhase("implementer"));
      assert.ok(isOpenAgentPhase("reviewer"));
    });

    it("rejects invalid phases", () => {
      assert.ok(!isOpenAgentPhase("unknown"));
      assert.ok(!isOpenAgentPhase(""));
      assert.ok(!isOpenAgentPhase("ORCHESTRATOR"));
    });
  });

  describe("listOpenAgentPhases", () => {
    it("returns comma-separated list", () => {
      const result = listOpenAgentPhases();
      assert.ok(result.includes("orchestrator"));
      assert.ok(result.includes("reviewer"));
      assert.ok(result.includes(", "));
    });
  });

  describe("inferOpenAgentPhase", () => {
    it("infers orchestrator for orchestrator agent", () => {
      assert.equal(inferOpenAgentPhase("openagent-orchestrator"), "orchestrator");
    });

    it("infers planner for planner and critic agents", () => {
      assert.equal(inferOpenAgentPhase("openagent-planner"), "planner");
      assert.equal(inferOpenAgentPhase("openagent-critic"), "planner");
    });

    it("infers researcher for researcher and explorer agents", () => {
      assert.equal(inferOpenAgentPhase("openagent-researcher"), "researcher");
      assert.equal(inferOpenAgentPhase("openagent-explorer"), "researcher");
    });

    it("infers implementer for implementer agent", () => {
      assert.equal(inferOpenAgentPhase("openagent-implementer"), "implementer");
    });

    it("infers reviewer for reviewer, oracle, and qa agents", () => {
      assert.equal(inferOpenAgentPhase("openagent-reviewer"), "reviewer");
      assert.equal(inferOpenAgentPhase("openagent-oracle"), "reviewer");
      assert.equal(inferOpenAgentPhase("openagent-qa"), "reviewer");
    });

    it("defaults to orchestrator for null/unknown agents", () => {
      assert.equal(inferOpenAgentPhase(null), "orchestrator");
      assert.equal(inferOpenAgentPhase(undefined), "orchestrator");
      assert.equal(inferOpenAgentPhase("random-agent"), "orchestrator");
    });
  });
});
