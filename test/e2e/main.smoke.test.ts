import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { VERSION } from "../../src/version.ts";

const MAIN = new URL("../../src/main.ts", import.meta.url).pathname;

function runMain(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [MAIN, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

describe("main.ts · arranque como proceso real", () => {
  it("--version sale con código 0 e imprime la versión", () => {
    const result = runMain(["--version"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `scorm-to-pdf ${VERSION}\n`);
  });

  it("propaga el código de salida de un error de uso", () => {
    const result = runMain([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /selector interactivo/);
  });
});
