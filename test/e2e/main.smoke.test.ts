import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../src/version.ts";
import { LocalServer } from "../support/LocalServer.ts";

const MAIN = fileURLToPath(new URL("../../src/main.ts", import.meta.url));

function childEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "", NODE_V8_COVERAGE: process.env.NODE_V8_COVERAGE, SCORM_LANG: "en", ...overrides };
}

function preload(source: string): string[] {
  return ["--import", `data:text/javascript,${encodeURIComponent(source)}`];
}

function runMain(args: string[], options: { nodeFlags?: string[]; input?: string; env?: NodeJS.ProcessEnv } = {}) {
  return spawnSync(process.execPath, [...(options.nodeFlags ?? []), MAIN, ...args], {
    encoding: "utf8",
    env: childEnv(options.env),
    input: options.input,
    timeout: 15_000,
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

  it("detects the system language for help and accepts an override for plugin errors", () => {
    const env = { SCORM_LANG: undefined, LANG: "es_MX.UTF-8" };
    const help = runMain(["ascii", "--help"], { env });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^Uso: scorm-to-pdf ascii <entrada>/);

    const error = runMain(["ascii", "image.png", "--out", "image.bmp", "--lang=ro"], { env });
    assert.equal(error.status, 1, error.stderr);
    assert.match(error.stderr, /Format de ieșire neacceptat: bmp/);
  });

  it("does not treat positionals after the option terminator as language overrides", () => {
    const help = runMain(["--help", "--", "--lang=es"]);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /^Usage: scorm-to-pdf /);
  });

  it("treats an unhandled rejection as fatal even in Node's warning mode", () => {
    const result = runMain(["--version"], {
      nodeFlags: ["--unhandled-rejections=warn", ...preload(`
        process.once("beforeExit", () => {
          void Promise.reject(new Error("fixture rejected before exit"));
        });
      `)],
    });
    assert.equal(result.stdout, `scorm-to-pdf ${VERSION}\n`);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Error: fixture rejected before exit/);
  });

  it("returns the signal status if interrupted while writing the version", () => {
    const result = runMain(["--version"], {
      nodeFlags: preload(`
        const write = process.stdout.write;
        process.stdout.write = function (chunk, ...args) {
          const written = write.call(this, chunk, ...args);
          if (chunk.length) process.emit("SIGINT");
          return written;
        };
      `),
    });
    assert.equal(result.stdout, `scorm-to-pdf ${VERSION}\n`);
    assert.equal(result.status, 130, result.stderr);
  });

  it("returns success when the downstream reader closes stdout", { timeout: 15_000 }, async (t) => {
    const child = spawn(process.execPath, [...preload(`
      await new Promise((resolve) => process.once("message", () => {
        process.disconnect();
        resolve();
      }));
    `), MAIN, "--version"], { env: childEnv(), stdio: ["ignore", "pipe", "pipe", "ipc"] });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    });
    const exited = once(child, "close");
    assert.ok(child.stdout);
    assert.ok(child.stderr);
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    const outputClosed = once(child.stdout, "close");
    child.stdout.destroy();
    await outputClosed;
    child.send("run");

    assert.deepEqual(await exited, [0, null], stderr);
    assert.equal(stderr, "");
  });

  it("reports unexpected stdout failures as fatal", () => {
    const result = runMain(["--version"], {
      nodeFlags: preload(`
        const write = process.stdout.write;
        process.stdout.write = function (chunk, ...args) {
          const written = write.call(this, chunk, ...args);
          if (chunk.length) this.destroy(Object.assign(new Error("fixture stdout failure"), { code: "EIO" }));
          return written;
        };
      `),
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /Error: fixture stdout failure/);
  });

  it("restores the terminal when Ctrl+C interrupts the cookie prompt", () => {
    const result = runMain(["tui"], {
      input: "\x03",
      nodeFlags: preload(`
        process.stdin.isTTY = true;
        process.stdout.isTTY = true;
        process.stdin.setRawMode = (enabled) => { process.stdout.write("raw:" + enabled + "\\n"); };
      `),
    });
    assert.equal(result.status, 130, result.stderr);
    assert.ok(result.stdout.includes("raw:true\n"));
    assert.ok(result.stdout.includes("\x1b[?1049h"));
    assert.ok(result.stdout.includes("raw:false\n"));
    assert.ok(result.stdout.includes("\x1b[?25h\x1b[?1049l"));
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
      env: childEnv({ MOODLE_COOKIE: "fixture-session" }),
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
