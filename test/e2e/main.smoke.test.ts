import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../src/version.ts";
import { LocalServer } from "../support/LocalServer.ts";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

function runMain(args: string[], env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [MAIN, ...args], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...env },
  });
}

describe("CLI process entry point", () => {
  it("prints the version and exits successfully", () => {
    const result = runMain(["--version"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `scorm-to-pdf ${VERSION}\n`);
  });

  it("returns the usage error exit status", () => {
    const result = runMain([]);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /interactive selector/);
  });

  it("cancels an active Moodle response on SIGTERM without leaving files", { timeout: 15_000, skip: process.platform === "win32" }, async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "scorm-interrupt-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const server = await LocalServer.start((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.write("<html>");
      markStarted();
    });
    const child = spawn(process.execPath, [MAIN, "courses", "--base-url", server.origin], {
      cwd: dir,
      env: { MOODLE_COOKIE: "fixture-session" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const exited = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await server.close();
    });
    const reachedServer = await Promise.race([started.then(() => true), exited.then(() => false)]);
    assert.equal(reachedServer, true, stderr);
    child.kill("SIGTERM");
    assert.equal(await exited, 143, stderr);
    assert.deepEqual(await readdir(dir), []);
  });
});
