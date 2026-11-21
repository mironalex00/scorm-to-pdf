import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliApplication } from "../../src/CliApplication.ts";
import { VERSION } from "../../src/version.ts";
import type { HttpClient } from "../../src/application/ports.ts";
import { FakeMoodle } from "../support/FakeMoodle.ts";
import type { LocalServer } from "../support/LocalServer.ts";
import { CapturedStream } from "../support/streams.ts";

const COOKIE = "abc123";
let moodle: LocalServer;
let outDir: string;
let traceRoot: string;

before(async () => {
  moodle = await FakeMoodle.start({
    scormId: 10067,
    revision: 3,
    title: "AFSD · Curs 5. Funcții și descompunerea problemelor",
    slideCount: 3,
    validCookie: COOKIE,
  });
});
after(() => moodle.close());
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "scorm-e2e-"));
  traceRoot = await mkdtemp(join(tmpdir(), "scorm-e2e-trace-"));
});
afterEach(() => Promise.all([rm(outDir, { recursive: true, force: true }), rm(traceRoot, { recursive: true, force: true })]));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(argv: string[], env: Record<string, string | undefined> = {}, http?: HttpClient): Promise<RunResult> {
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, SCORM_LANG: "en", ...env }, stdout, stderr, http, cwd: traceRoot });
  const code = await app.run(argv);
  return { code, stdout: stdout.output, stderr: stderr.output };
}

const baseArgs = () => ["10067", "--base-url", moodle.origin, "--out-dir", outDir];

describe("SCORM conversion by ID", () => {
  it("discovers the revision and saves the PDF with a title-based filename", async () => {
    const { code, stdout, stderr } = await run(baseArgs());
    const expected = join(outDir, "AFSD-Curs-5.pdf");

    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(outDir), ["AFSD-Curs-5.pdf"]);
    const pdf = (await readFile(expected)).toString("latin1");
    assert.ok(pdf.startsWith("%PDF-1.4"));
    assert.match(pdf, /\/Count 3 >>/);

    const lines = stdout.trimEnd().split("\n");
    assert.equal(lines.at(-1), expected);
    assert.match(stdout, /revision 3/);
    assert.match(stdout, /Done: 3 pages/);
  });

  it("accepts a full pluginfile.php URL", async () => {
    const url = `${moodle.origin}/pluginfile.php/10067/mod_scorm/content/3/index.html`;
    const { code } = await run([url, "-o", join(outDir, "desde-url.pdf"), "-q"]);
    assert.equal(code, 0);
    assert.deepEqual(await readdir(outDir), ["desde-url.pdf"]);
  });

  it("prints only the PDF path in quiet mode", async () => {
    const { code, stdout } = await run([...baseArgs(), "-q"]);
    assert.equal(code, 0);
    assert.equal(stdout, `${join(outDir, "AFSD-Curs-5.pdf")}\n`);
  });

  it("reads the base URL from MOODLE_BASE_URL", async () => {
    const { code } = await run(["10067", "--out-dir", outDir, "-q"], { MOODLE_BASE_URL: moodle.origin });
    assert.equal(code, 0);
  });
});

describe("CLI help and version", () => {
  it("prints help without a Moodle cookie", async () => {
    const { code, stdout } = await run(["--help"], { MOODLE_COOKIE: undefined });
    assert.equal(code, 0);
    assert.match(stdout, /^Usage: scorm-to-pdf \[command\] \[options\]/);
  });

  it("prints the program name and version", async () => {
    const { code, stdout } = await run(["--version"]);
    assert.deepEqual([code, stdout], [0, `scorm-to-pdf ${VERSION}\n`]);
  });
});

describe("CLI errors and exit codes", () => {
  it("prints a usage hint when the selector has no terminal", async () => {
    const { code, stderr } = await run([]);
    assert.equal(code, 2);
    assert.match(stderr, /^ERROR: The interactive selector requires a terminal/);
    assert.match(stderr, /--help/);
  });

  it("suggests a spelling for unknown options", async () => {
    const { code, stderr } = await run(["10067", "--ot"]);
    assert.equal(code, 2);
    assert.match(stderr, /Did you mean --out\?/);
  });

  it("names MOODLE_COOKIE when it is missing", async () => {
    const { code, stderr } = await run(baseArgs(), { MOODLE_COOKIE: undefined });
    assert.equal(code, 2);
    assert.match(stderr, /MOODLE_COOKIE/);
  });

  it("reports an invalid session without leaking the cookie or creating a PDF", async () => {
    const { code, stderr } = await run(baseArgs(), { MOODLE_COOKIE: "MoodleSession=caducada" });
    assert.equal(code, 3);
    assert.match(stderr, /Cookies sent \(names only\): MoodleSession/);
    assert.match(stderr, /Developer Tools/);
    assert.ok(!stderr.includes("caducada"));
    assert.deepEqual(await readdir(outDir), []);
  });

  it("reports the tried revisions when a SCORM ID is missing", async () => {
    const { code, stderr } = await run(["99999", "--base-url", moodle.origin, "--out-dir", outDir]);
    assert.equal(code, 1);
    assert.match(stderr, /Could not find index\.html for SCORM 99999/);
  });

  it("reports unexpected errors and includes a stack when DEBUG is enabled", async () => {
    const failing: HttpClient = { get: () => Promise.reject(new TypeError("boom")) };
    const plain = await run(baseArgs(), {}, failing);
    assert.equal(plain.code, 1);
    assert.match(plain.stderr, /^Unexpected error: boom\nRun again with --trace/);

    const debug = await run(baseArgs(), { DEBUG: "1" }, failing);
    assert.match(debug.stderr, /TypeError: boom\n\s+at /);
    assert.deepEqual(await readdir(traceRoot), []);
  });

  it("reports thrown values that are not Error objects", async () => {
    const failing: HttpClient = { get: () => Promise.reject("plain text") };
    const { code, stderr } = await run(baseArgs(), { DEBUG: "1" }, failing);
    assert.equal(code, 1);
    assert.match(stderr, /Unexpected error: plain text/);
  });

  it("reports when the requested trace cannot be saved", async () => {
    const existingFile = join(traceRoot, "occupied");
    await writeFile(existingFile, "keep this file");
    const result = await run(["diagnose", "--base-url", moodle.origin, "--trace-dir", existingFile]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /Could not write the trace/);
    assert.doesNotMatch(result.stdout, /Full trace saved to/);
    assert.equal(await readFile(existingFile, "utf8"), "keep this file");
  });
});
