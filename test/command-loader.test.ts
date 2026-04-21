import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getDefaultUserCommandDirectories } from "../src/command-loader.js";

describe("command-loader", () => {
  it("uses APPDATA and preserves the legacy ~/.config path on Windows", () => {
    const directories = getDefaultUserCommandDirectories({
      platform: "win32",
      env: { APPDATA: "C:\\Users\\alice\\AppData\\Roaming" },
      homedir: "C:\\Users\\alice",
    });

    assert.equal(directories.length, 2);
    assert.match(directories[0] ?? "", /AppData[\\/]Roaming[\\/]openagent[\\/]commands$/);
    assert.match(directories[1] ?? "", /\.config[\\/]openagent[\\/]commands$/);
  });

  it("uses the XDG-style config directory on Linux", () => {
    const directories = getDefaultUserCommandDirectories({
      platform: "linux",
      homedir: "/home/alice",
    });

    assert.equal(directories.length, 1);
    assert.match(directories[0] ?? "", /\.config[\\/]openagent[\\/]commands$/);
  });

  it("adds Application Support plus XDG compatibility on macOS", () => {
    const directories = getDefaultUserCommandDirectories({
      platform: "darwin",
      homedir: "/Users/alice",
    });

    assert.equal(directories.length, 2);
    assert.match(
      directories[0] ?? "",
      /Library[\\/]Application Support[\\/]openagent[\\/]commands$/,
    );
    assert.match(directories[1] ?? "", /\.config[\\/]openagent[\\/]commands$/);
  });
});
