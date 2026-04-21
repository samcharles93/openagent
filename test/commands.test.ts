import { describe, it } from "node:test";
import assert from "node:assert/strict";

const {
  parseInitDeepArgs,
  parseRouteCommandArgs,
  parseLoopCommandArgs,
  parseLookAtCommandArgs,
  parseStartCommandArgs,
} = await import("../src/commands.js");

describe("commands - parseInitDeepArgs", () => {
  it("parses no args as defaults", () => {
    const result = parseInitDeepArgs("");
    assert.deepEqual(result, { force: false, maxDepth: undefined });
  });

  it("parses --force", () => {
    const result = parseInitDeepArgs("--force");
    assert.deepEqual(result, { force: true, maxDepth: undefined });
  });

  it("parses --max-depth", () => {
    const result = parseInitDeepArgs("--max-depth=3");
    assert.deepEqual(result, { force: false, maxDepth: 3 });
  });

  it("parses combined", () => {
    const result = parseInitDeepArgs("--force --max-depth=5");
    assert.deepEqual(result, { force: true, maxDepth: 5 });
  });
});

describe("commands - parseRouteCommandArgs", () => {
  it("returns null for empty input", () => {
    assert.equal(parseRouteCommandArgs(""), null);
    assert.equal(parseRouteCommandArgs("   "), null);
  });

  it("parses phase and objective", () => {
    const result = parseRouteCommandArgs("planner write tests for auth");
    assert.deepEqual(result, {
      phase: "planner",
      objective: "write tests for auth",
      handoff: "write tests for auth",
    });
  });

  it("splits on pipe for handoff", () => {
    const result = parseRouteCommandArgs("implementer refactor auth module | handover notes at files/auth.md");
    assert.deepEqual(result, {
      phase: "implementer",
      objective: "refactor auth module",
      handoff: "handover notes at files/auth.md",
    });
  });

  it("returns null when phase missing", () => {
    assert.equal(parseRouteCommandArgs("  | something"), null);
    assert.equal(parseRouteCommandArgs(""), null);
  });
});

describe("commands - parseLoopCommandArgs", () => {
  it("returns null for empty input", () => {
    assert.equal(parseLoopCommandArgs(""), null);
    assert.equal(parseLoopCommandArgs("   "), null);
  });

  it("defaults maxIterations to 8", () => {
    const result = parseLoopCommandArgs("implement the feature");
    assert.deepEqual(result, {
      goal: "implement the feature",
      maxIterations: 8,
    });
  });

  it("parses --max-iterations", () => {
    const result = parseLoopCommandArgs("--max-iterations=15 run the tests");
    assert.deepEqual(result, {
      goal: "run the tests",
      maxIterations: 15,
    });
  });

  it("clamps maxIterations to 25", () => {
    const result = parseLoopCommandArgs("--max-iterations=99 my goal");
    assert.equal(result?.maxIterations, 25);
  });

  it("clamps minIterations to 1", () => {
    const result = parseLoopCommandArgs("--max-iterations=0 my goal");
    assert.equal(result?.maxIterations, 1);
  });

  it("returns null when goal is empty", () => {
    assert.equal(parseLoopCommandArgs("--max-iterations=5"), null);
  });
});

describe("commands - parseLookAtCommandArgs", () => {
  it("returns null for empty input", () => {
    assert.equal(parseLookAtCommandArgs(""), null);
    assert.equal(parseLookAtCommandArgs("   "), null);
  });

  it("parses file only", () => {
    const result = parseLookAtCommandArgs("reports/q4.pdf");
    assert.deepEqual(result, {
      file: "reports/q4.pdf",
      prompt: undefined,
    });
  });

  it("splits on pipe for prompt", () => {
    const result = parseLookAtCommandArgs("schema.png | what tables are defined");
    assert.deepEqual(result, {
      file: "schema.png",
      prompt: "what tables are defined",
    });
  });

  it("handles absolute paths", () => {
    const result = parseLookAtCommandArgs("/home/user/doc.pdf");
    assert.deepEqual(result, {
      file: "/home/user/doc.pdf",
      prompt: undefined,
    });
  });
});

describe("commands - parseStartCommandArgs", () => {
  it("returns empty object for no args", () => {
    assert.deepEqual(parseStartCommandArgs(""), {});
    assert.deepEqual(parseStartCommandArgs("   "), {});
  });

  it("parses request string", () => {
    const result = parseStartCommandArgs("build a login page");
    assert.equal(result.request, "build a login page");
    assert.equal(result.resumePath, undefined);
    assert.equal(result.resumeNote, undefined);
  });

  it("parses --resume with path", () => {
    const result = parseStartCommandArgs("--resume artifacts/handoff.yaml continue work");
    assert.equal(result.resumePath, "artifacts/handoff.yaml");
    assert.equal(result.resumeNote, "continue work");
  });

  it("parses --resume= shorthand", () => {
    const result = parseStartCommandArgs("--resume=artifacts/handoff.yaml");
    assert.equal(result.resumePath, "artifacts/handoff.yaml");
    assert.equal(result.resumeNote, undefined);
  });

  it("ignores extra parts after resume note", () => {
    const result = parseStartCommandArgs("--resume artifact.yaml the note here");
    assert.equal(result.resumePath, "artifact.yaml");
    assert.equal(result.resumeNote, "the note here");
  });
});