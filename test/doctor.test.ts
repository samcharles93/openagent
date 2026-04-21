import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getBinaryLookupCommand,
  parseBinaryLookupOutput,
} from "../.github/extensions/openagent/doctor.js";

describe("doctor", () => {
  describe("getBinaryLookupCommand", () => {
    it("uses where.exe on Windows", () => {
      assert.equal(getBinaryLookupCommand("win32"), "where.exe");
    });

    it("uses which on non-Windows platforms", () => {
      assert.equal(getBinaryLookupCommand("linux"), "which");
    });
  });

  describe("parseBinaryLookupOutput", () => {
    it("returns the first resolved path when multiple matches are present", () => {
      assert.equal(
        parseBinaryLookupOutput("C:\\Program Files\\node\\node.exe\r\nC:\\Other\\node.exe\r\n"),
        "C:\\Program Files\\node\\node.exe",
      );
    });

    it("returns null for empty lookup output", () => {
      assert.equal(parseBinaryLookupOutput("\r\n  \r\n"), null);
    });
  });
});
