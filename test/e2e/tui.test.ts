import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout } from "node:timers/promises";
import { CliApplication } from "../../src/CliApplication.ts";
import { asciiAnimations } from "../../src/plugins/ascii-fire/generatedAnimations.ts";
import { RawTerminal } from "../../src/tui/RawTerminal.ts";
import type { KeyPress } from "../../src/tui/Terminal.ts";
import { FakeMoodle } from "../support/FakeMoodle.ts";
import type { FakeMoodleOptions } from "../support/FakeMoodle.ts";
import type { LocalServer } from "../support/LocalServer.ts";
import { ScriptedTerminal, chars, key } from "../support/ScriptedTerminal.ts";
import { CapturedStream } from "../support/streams.ts";

const COOKIE = "cookie-secret-98765";
const base: FakeMoodleOptions = { scormId: 10067, revision: 3, title: "AFSD · Curs 5. X", slideCount: 2, validCookie: COOKIE };

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "scorm-tui-"));
});
afterEach(() => rm(work, { recursive: true, force: true }));

const servers: LocalServer[] = [];
async function server(options: Partial<FakeMoodleOptions> = {}): Promise<LocalServer> {
  const started = await FakeMoodle.start({ ...base, ...options });
  servers.push(started);
  return started;
}
after(() => Promise.all(servers.map((s) => s.close())));

async function run(moodle: LocalServer, keys: KeyPress[], env: Record<string, string | undefined> = {}, argv: string[] = []) {
  const terminal = new ScriptedTerminal(keys);
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, SCORM_LANG: "en", ...env }, stdout, stderr, cwd: work, terminal });
  const code = await app.run([...argv, "--base-url", moodle.origin]);
  return { code, terminal, stdout: stdout.output, stderr: stderr.output };
}
const pdfs = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).map(String).filter((n) => n.endsWith(".pdf")).sort();

// The first course in alphabetical order has sections 0, 1, and 3.
const chooseFirstCourseAndMarkAll = [key("enter"), ...chars("A"), key("enter")];

describe("Interactive selector", () => {
  it("downloads all marked items from one course into section folders", async () => {
    const moodle = await server();
    const { code, terminal, stdout, stderr } = await run(moodle, [...chooseFirstCourseAndMarkAll, key("enter"), key("enter")]);

    assert.equal(code, 0, stderr);
    assert.deepEqual(await pdfs(work), ["content/Algoritmi fundamentali/General/Programa/Programa.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Curs 5. Funcții/Curs 5. Funcții.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Exerciții & teme/Exerciții & teme.pdf", "content/Algoritmi fundamentali/Săptămâna 3/Complementar/Complementar.pdf"]);
    assert.equal((await readFile(join(work, "content/Algoritmi fundamentali/Săptămâna 1/Curs 5. Funcții/Curs 5. Funcții.pdf"))).subarray(0, 4).toString("latin1"), "%PDF");
    assert.match(stdout, /^Download complete\. New files: 4, already present: 0/);
    assert.equal(stderr, "");
    assert.deepEqual([terminal.opened, terminal.closed, terminal.remainingKeys], [1, 1, 0]);
    assert.match(terminal.allFrames(), /Algoritmi fundamentali[\s\S]*Structuri de date/);
    assert.deepEqual((await readdir(work)).filter((n) => n.startsWith("scorm-trace-")), [], "successful runs leave no trace by default");
  });

  it("uses the destination entered by the user", async () => {
    const custom = join(work, "mi", "material");
    const keys = [...chooseFirstCourseAndMarkAll, key("enter"), key("down"), key("enter"), ...chars(custom), key("enter")];
    const { code } = await run(await server(), keys);
    assert.equal(code, 0);
    assert.deepEqual(await pdfs(custom), ["content/Algoritmi fundamentali/General/Programa/Programa.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Curs 5. Funcții/Curs 5. Funcții.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Exerciții & teme/Exerciții & teme.pdf", "content/Algoritmi fundamentali/Săptămâna 3/Complementar/Complementar.pdf"]);
  });

  it("shows and downloads material from a subsection in the course body", async () => {
    const { code, terminal, stderr } = await run(await server(), [
      key("down"), key("enter"), key("space"), key("enter"), key("enter"), key("enter"),
    ]);
    assert.equal(code, 0, stderr);
    assert.match(terminal.allFrames(), /Section 2 - Tema[\s\S]*Tema 1 {2}\(resource\)/);
    assert.deepEqual(await pdfs(work), ["content/Structuri de date/Tema/Tema 1/Tema 1.pdf"]);
  });

  it("marks courses with selected items and reviews all marked materials together", async () => {
    const moodle = await server();
    const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode: (_mode: boolean) => undefined });
    const stdout = new CapturedStream(true, 80);
    const stderr = new CapturedStream();
    const terminal = new RawTerminal({ input, output: stdout });
    const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, SCORM_LANG: "en" }, stdout, stderr, cwd: work, terminal });
    const finished = app.run(["--base-url", moodle.origin]);

    async function screen(text: string, offset = 0) {
      const deadline = Date.now() + 3000;
      while (!stdout.output.includes(text, offset) && Date.now() < deadline) await setTimeout(5);
      assert.ok(stdout.output.includes(text, offset), `The terminal did not show "${text}"`);
    }
    async function type(bytes: string, expected: string) {
      const offset = stdout.output.length;
      input.write(bytes);
      await screen(expected, offset);
    }

    try {
      await screen("Your courses");
      await type("\r", "[ ] Programa");
      await type(" ", "[x] Programa");
      await type("\x1b", "[x] Algoritmi fundamentali");
      await type("\x1b[B\r", "[ ] Tema 1");
      await type(" ", "[x] Tema 1");
      await type("\r", "Confirm download (2 selected)");
      await type("\r", "Where should the files be saved?");
      await type("\r", "Mulțumesc!");
      assert.equal(await finished, 0, stderr.output);
    } finally {
      input.destroy();
    }

    assert.deepEqual(await pdfs(work), [
      "content/Algoritmi fundamentali/General/Programa/Programa.pdf",
      "content/Structuri de date/Tema/Tema 1/Tema 1.pdf",
    ]);
    assert.match(stdout.output, /Downloading 2\/2: Tema 1/);
    assert.equal(stdout.output.match(/Mulțumesc!/g)?.length, 9);
    const farewell = stdout.output.slice(stdout.output.indexOf("Mulțumesc!"));
    for (const frame of asciiAnimations.farewell.frames) assert.ok(farewell.includes(frame[13]!));
    assert.match(farewell, /\x1b\[\?1049lDownload complete\. New files: 2/);
  });

  it("selects and downloads a single section with lowercase a", async () => {
    // Lowercase a toggles only the first section.
    const { code } = await run(await server(), [key("enter"), ...chars("a"), key("enter"), key("enter"), key("enter")]);
    assert.equal(code, 0);
    assert.deepEqual(await pdfs(work), ["content/Algoritmi fundamentali/General/Programa/Programa.pdf"]);
  });

  it("restores the terminal and leaves no files on Ctrl+C", async () => {
    const { code, terminal, stderr } = await run(await server(), [key("enter"), key("ctrl-c")]);
    assert.equal(code, 130);
    assert.equal(stderr, "Cancelled.\n");
    assert.equal(terminal.closed, 1);
    assert.deepEqual(await readdir(work), []);
  });

  it("shows the error screen, finishes other downloads, and leaves no trace by default", async () => {
    const moodle = await server({ failItems: ["531"] });
    const { code, terminal, stderr } = await run(moodle, [...chooseFirstCourseAndMarkAll, key("enter"), key("enter"), key("space")]);
    assert.equal(code, 1);
    for (const frame of asciiAnimations.downloadFailure.frames) assert.ok(terminal.allFrames().includes(frame[15]!));
    assert.match(terminal.allFrames(), /Some downloads failed[\s\S]*Failed to download "Complementar"/);
    assert.match(stderr, /Failed to download "Complementar"[\s\S]*Downloaded: 3 \| Skipped: 0 \| Failed: 1[\s\S]*Run again with --trace/);
    assert.deepEqual(await readdir(work), ["content"]);
    assert.deepEqual(await pdfs(work), ["content/Algoritmi fundamentali/General/Programa/Programa.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Curs 5. Funcții/Curs 5. Funcții.pdf", "content/Algoritmi fundamentali/Săptămâna 1/Exerciții & teme/Exerciții & teme.pdf"]);
  });

  it("restores the terminal and returns exit status 3 for an invalid session", async () => {
    const { code, terminal, stderr } = await run(await server(), [], { MOODLE_COOKIE: "caducada-000000" });
    assert.equal(code, 3);
    assert.match(stderr, /Moodle rejected the session/);
    assert.match(terminal.allFrames(), /Could not continue/);
    for (const frame of asciiAnimations.unexpectedFailure.frames) assert.ok(terminal.allFrames().includes(frame[14]!));
    assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
  });

  it("writes the requested trace and reports its location", async () => {
    const traceDir = join(work, "traza");
    const { code, stderr } = await run(await server(), [key("escape")], {}, ["--trace", "--trace-dir", traceDir]);
    assert.equal(code, 130);
    assert.match(stderr, /Trace saved to/);
    assert.match(await readFile(join(traceDir, "trace.jsonl"), "utf8"), /"name":"run.start"[\s\S]*"command":"tui"/);
  });
});

describe("Interactive cookie prompt", () => {
  it("prompts for a missing Moodle cookie with masked input", async () => {
    const { code, terminal } = await run(await server(), [...chars(COOKIE), key("enter"), key("escape")], { MOODLE_COOKIE: undefined });
    assert.equal(code, 130);
    const frames = terminal.allFrames();
    assert.ok(!frames.includes(COOKIE));
    assert.match(frames, /Moodle session cookie required[\s\S]*Algoritmi fundamentali/);
    assert.equal(terminal.opened, 2, "once for the cookie and once for the selector");
  });

  it("returns a usage error when the cookie prompt is dismissed", async () => {
    const { code, stderr } = await run(await server(), [key("escape")], { MOODLE_COOKIE: "  " });
    assert.equal(code, 2);
    assert.match(stderr, /Set MOODLE_COOKIE/);
  });
});

describe("Noninteractive terminals", () => {
  it("requires a TTY to open the selector", async () => {
    const terminal = new ScriptedTerminal([]);
    terminal.interactive = false;
    const stderr = new CapturedStream();
    const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, SCORM_LANG: "en" }, stdout: new CapturedStream(), stderr, cwd: work, terminal });
    assert.equal(await app.run([]), 2);
    assert.match(stderr.output, /The interactive selector requires a terminal/);
    assert.equal(terminal.opened, 0);
  });
});
