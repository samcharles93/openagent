import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resolveCommand, createSpawnOptions } = require("../scripts/install-openagent.cjs");

describe("install-openagent", () => {
  describe("resolveCommand", () => {
    it("rewrites npm to npm.cmd on Windows", () => {
      assert.equal(resolveCommand("npm", "win32"), "npm.cmd");
    });

    it("does not rewrite non-npm commands on Windows", () => {
      assert.equal(resolveCommand("git", "win32"), "git");
    });

    it("does not rewrite npm on non-Windows platforms", () => {
      assert.equal(resolveCommand("npm", "linux"), "npm");
    });
  });

  describe("createSpawnOptions", () => {
    it("enables shell on Windows", () => {
      const options = createSpawnOptions({ stdio: "ignore" }, "win32");
      assert.equal(options.shell, true);
      assert.equal(options.stdio, "ignore");
    });

    it("disables shell on non-Windows platforms", () => {
      const options = createSpawnOptions({ stdio: "inherit" }, "linux");
      assert.equal(options.shell, false);
      assert.equal(options.stdio, "inherit");
    });
  });
});
