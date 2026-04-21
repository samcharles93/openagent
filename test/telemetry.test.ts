import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordToolCall,
  recordToolFailure,
  recordToolDenied,
  recordLoopStart,
  recordLoopIteration,
  recordLoopCancel,
  recordLoopComplete,
  recordUsageInfo,
  recordCompactionStart,
  recordCompactionComplete,
  getOpenAgentTelemetrySnapshot,
  formatOpenAgentTelemetry,
} from "../src/telemetry.js";

describe("telemetry", () => {
  it("records tool calls and categorizes them", () => {
    const before = getOpenAgentTelemetrySnapshot();
    const baseToolCalls = before.toolCalls;

    recordToolCall("openagent_safe_edit");
    recordToolCall("openagent_lsp_diagnostics");
    recordToolCall("openagent_ast_search");
    recordToolCall("openagent_look_at");
    recordToolCall("some_other_tool");

    const after = getOpenAgentTelemetrySnapshot();
    assert.equal(after.toolCalls, baseToolCalls + 5);
    assert.ok(after.editToolCalls >= 1);
    assert.ok(after.readToolCalls >= 2);
    assert.ok(after.lspCalls >= 1);
    assert.ok(after.astCalls >= 1);
    assert.ok(after.lookAtCalls >= 1);
  });

  it("records tool failures and denials", () => {
    const before = getOpenAgentTelemetrySnapshot();
    recordToolFailure();
    recordToolDenied();
    const after = getOpenAgentTelemetrySnapshot();
    assert.equal(after.toolFailures, before.toolFailures + 1);
    assert.equal(after.toolDenials, before.toolDenials + 1);
  });

  it("records loop lifecycle events", () => {
    const before = getOpenAgentTelemetrySnapshot();
    recordLoopStart();
    recordLoopIteration();
    recordLoopIteration();
    recordLoopComplete();
    recordLoopStart();
    recordLoopCancel();
    const after = getOpenAgentTelemetrySnapshot();
    assert.equal(after.loopStarts, before.loopStarts + 2);
    assert.equal(after.loopIterations, before.loopIterations + 2);
    assert.equal(after.loopCompletions, before.loopCompletions + 1);
    assert.equal(after.loopCancels, before.loopCancels + 1);
  });

  it("records usage info", () => {
    recordUsageInfo(50000, 200000);
    const snap = getOpenAgentTelemetrySnapshot();
    assert.equal(snap.lastUsageTokens, 50000);
    assert.equal(snap.tokenLimit, 200000);
    assert.equal(snap.lastUsageRatio, 0.25);
  });

  it("records compaction events", () => {
    const before = getOpenAgentTelemetrySnapshot();
    recordCompactionStart();
    recordCompactionComplete(true);
    recordCompactionStart();
    recordCompactionComplete(false);
    const after = getOpenAgentTelemetrySnapshot();
    assert.equal(after.compactionsStarted, before.compactionsStarted + 2);
    assert.equal(after.compactionsCompleted, before.compactionsCompleted + 1);
    assert.equal(after.compactionFailures, before.compactionFailures + 1);
  });

  it("formats telemetry as readable string", () => {
    const output = formatOpenAgentTelemetry();
    assert.ok(output.includes("OpenAgent telemetry"));
    assert.ok(output.includes("session started:"));
    assert.ok(output.includes("tools:"));
    assert.ok(output.includes("usage:"));
  });
});
