import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inferMimeTypeFromPath } from "../.github/extensions/openagent/look-at.js";

describe("look-at", () => {
  it("detects PDFs from the file extension", () => {
    assert.equal(inferMimeTypeFromPath("report.pdf"), "application/pdf");
  });

  it("detects images from the file extension", () => {
    assert.equal(inferMimeTypeFromPath("diagram.PNG"), "image/png");
  });

  it("detects PowerShell and code files as text", () => {
    assert.equal(inferMimeTypeFromPath("script.ps1"), "text/plain");
    assert.equal(inferMimeTypeFromPath("src/extension.mts"), "text/plain");
  });

  it("detects basename-only text files", () => {
    assert.equal(inferMimeTypeFromPath(".env"), "text/plain");
    assert.equal(inferMimeTypeFromPath("Dockerfile"), "text/plain");
  });

  it("returns null for unknown file types", () => {
    assert.equal(inferMimeTypeFromPath("archive.bin"), null);
  });
});
