import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferOpenAgentPhase,
  isOpenAgentPhase,
  listOpenAgentPhases,
  OPENAGENT_PHASES,
} from "../src/routing.js";

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
    it("infers orchestrator for conductor agent", () => {
      assert.equal(inferOpenAgentPhase("conductor"), "orchestrator");
    });

    it("infers planner for architect and skeptic agents", () => {
      assert.equal(inferOpenAgentPhase("architect"), "planner");
      assert.equal(inferOpenAgentPhase("skeptic"), "planner");
    });

    it("infers researcher for sleuth and scout agents", () => {
      assert.equal(inferOpenAgentPhase("sleuth"), "researcher");
      assert.equal(inferOpenAgentPhase("scout"), "researcher");
    });

    it("infers implementer for builder agent", () => {
      assert.equal(inferOpenAgentPhase("builder"), "implementer");
    });

    it("infers reviewer for auditor, oracle, and tester agents", () => {
      assert.equal(inferOpenAgentPhase("auditor"), "reviewer");
      assert.equal(inferOpenAgentPhase("oracle"), "reviewer");
      assert.equal(inferOpenAgentPhase("tester"), "reviewer");
    });

    it("defaults to orchestrator for null/unknown agents", () => {
      assert.equal(inferOpenAgentPhase(null), "orchestrator");
      assert.equal(inferOpenAgentPhase(undefined), "orchestrator");
      assert.equal(inferOpenAgentPhase("random-agent"), "orchestrator");
    });
  });
});
