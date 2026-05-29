import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyCategoryOverrides,
  getCategoryByName,
  inferCategoryFromObjective,
  listCategoryNames,
  formatCategorySummary,
} from "../src/categories.js";

describe("categories", () => {
  it("lists all 6 built-in categories", () => {
    const names = listCategoryNames();
    assert.equal(names.length, 6);
    assert.deepEqual(names, ["deep", "quick", "research", "review", "planning", "writing"]);
  });

  it("retrieves a category by name", () => {
    const deep = getCategoryByName("deep");
    assert.ok(deep);
    assert.equal(deep.name, "deep");
    assert.equal(deep.reasoningEffort, "high");
    assert.equal(deep.suggestedPhase, "orchestrator");
  });

  it("returns null for unknown category", () => {
    assert.equal(getCategoryByName("nonexistent"), null);
  });

  it("infers research category from objective keywords", () => {
    assert.equal(inferCategoryFromObjective("investigate the auth flow").name, "research");
    assert.equal(inferCategoryFromObjective("explore how routing works").name, "research");
  });

  it("infers review category from objective keywords", () => {
    assert.equal(inferCategoryFromObjective("review the PR changes").name, "review");
    assert.equal(inferCategoryFromObjective("audit security posture").name, "review");
  });

  it("infers planning category from objective keywords", () => {
    assert.equal(inferCategoryFromObjective("plan the new API design").name, "planning");
    assert.equal(inferCategoryFromObjective("architect the database layer").name, "planning");
  });

  it("infers quick category from objective keywords", () => {
    assert.equal(inferCategoryFromObjective("fix the typo in readme").name, "quick");
    assert.equal(inferCategoryFromObjective("rename the variable").name, "quick");
  });

  it("infers writing category from objective keywords", () => {
    assert.equal(inferCategoryFromObjective("document the API endpoints").name, "writing");
    assert.equal(inferCategoryFromObjective("write up a changelog entry").name, "writing");
  });

  it("falls back to deep for unrecognized objectives", () => {
    assert.equal(inferCategoryFromObjective("implement a new payment gateway").name, "deep");
  });

  it("applies category overrides correctly", () => {
    const overridden = applyCategoryOverrides({
      quick: {
        preferredModel: "custom-model",
        reasoningEffort: "high",
      },
    });
    const quick = overridden.find((c) => c.name === "quick");
    assert.ok(quick);
    assert.equal(quick.preferredModel, "custom-model");
    assert.equal(quick.reasoningEffort, "high");

    const deep = overridden.find((c) => c.name === "deep");
    assert.ok(deep);
    assert.equal(deep.preferredModel, "claude-opus-4.6");
  });

  it("formats category summary as readable string", () => {
    const output = formatCategorySummary();
    assert.ok(output.includes("Task categories:"));
    assert.ok(output.includes("deep"));
    assert.ok(output.includes("quick"));
    assert.ok(output.includes("writing"));
  });
});
