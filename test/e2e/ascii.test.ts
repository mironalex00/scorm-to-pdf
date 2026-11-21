import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { CliApplication } from "../../src/CliApplication.ts";
import { CliInterruptions } from "../../src/cli/CliInterruptions.ts";
import { asciiAsset, asciiCache, asciiIntegration, asciiProject, asciiSupported, offline } from "../support/ascii.ts";
import { CapturedStream } from "../support/streams.ts";

const exec = promisify(execFile);
const main = join(asciiProject, "src/main.ts");
const standalone = join(asciiProject, "src/plugins/ascii-fire/main.ts");
const legacy = join(asciiProject, "src/extensions/ascii/main.ts");

test("routes ASCII help and usage errors through the main CLI", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const env = {
    ...process.env, PATH: "", MOODLE_COOKIE: "", MOODLE_BASE_URL: "invalid-url", SCORM_PLATFORM: "unknown", SCORM_LANG: "en",
  };
  const [active, direct, compatible] = await Promise.all([
    exec(process.execPath, [main, "ascii", "--help"], { cwd, env }),
    exec(process.execPath, [standalone, "--help"], { cwd, env }),
    exec(process.execPath, [legacy, "--help"], { cwd, env }),
  ]);
  assert.equal(direct.stdout, active.stdout);
  assert.equal(compatible.stdout, active.stdout);
  assert.equal(active.stderr + direct.stderr + compatible.stderr, "");
  assert.match(active.stdout, /ascii <input>.*--prepare/s);
  await assert.rejects(exec(process.execPath, [main, "ascii", "-w", "abc", "media.png"], { cwd, env }),
    (error: unknown) => {
      const failure = error as { code: number; stderr: string };
      return failure.code === 2 && failure.stderr.includes("--cols must be an integer");
    });
  assert.deepEqual(await readdir(cwd), []);
});

test("exits successfully when the consumer closes its output pipe", async () => {
  const child = spawn(process.execPath, [main, "ascii", "--help"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  assert.deepEqual(await once(child, "close"), [0, null]);
  assert.equal(stderr, "");
});

test("prepares from the verified cache and suppresses confirmation in quiet mode", asciiIntegration, async () => {
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({ env: { SCORM_ASCII_CACHE: asciiCache, SCORM_LANG: "en" }, stdout, stderr, http: offline });

  assert.equal(await app.run(["ascii", "--prepare", "--quiet"]), 0, stderr.output);
  assert.equal(stdout.output, "");
  assert.equal(await app.run(["ascii", "--prepare"]), 0, stderr.output);
  assert.equal(stdout.output, "ASCII converter ready for offline use.\n");
  assert.equal(stderr.output, "");
});

test("runs the portable codecs from another directory with an empty PATH and removes the executables", asciiIntegration, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const temporary = join(cwd, "tmp");
  await mkdir(temporary);
  const env = {
    ...process.env, PATH: "", TMPDIR: temporary, SCORM_ASCII_CACHE: asciiCache, SCORM_TRACE: "0",
    MOODLE_COOKIE: "", MOODLE_BASE_URL: "invalid-url", SCORM_PLATFORM: "unknown",
    FFMPEG: "/bad/ffmpeg", FFPROBE: "/bad/ffprobe",
  };
  const png = asciiAsset("bear_hoop.png");
  const gif = asciiAsset("wink_cat.gif");
  const optionLike = "--lang=fr.png";
  await copyFile(png, join(cwd, optionLike));
  const [still, animation] = await Promise.all([
    exec(process.execPath, [main, "ascii", "-w", "20", "--invert", "--", optionLike], { cwd, env }),
    exec(process.execPath, [legacy, gif, "--out", "gif.json", "--cols", "20", "--max-frames", "4"], { cwd, env }),
  ]);
  assert.match(still.stdout, /^[ -~\n]+$/);
  assert.equal(still.stderr + animation.stderr, "");
  const clip = JSON.parse(await readFile(join(cwd, "gif.json"), "utf8")) as { frames: string[][] };
  assert.equal(clip.frames.length, 4);
  assert.ok(new Set(clip.frames.map((frame) => frame.join("\n"))).size > 1);
  assert.deepEqual(await readdir(temporary), []);
});

test("removes temporary files and preserves the previous output on SIGTERM", {
  ...asciiIntegration, timeout: 15_000,
}, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const temporary = join(cwd, "tmp");
  const output = join(cwd, "out.mp4");
  await mkdir(temporary);
  await writeFile(output, "anterior");
  const child = spawn(process.execPath, [
    main, "ascii", asciiAsset("wink_cat.gif"), "--cols", "180", "--fps", "30", "--scale", "1", "-o", output,
  ], {
    cwd,
    env: { ...process.env, PATH: "", TMPDIR: temporary, SCORM_ASCII_CACHE: asciiCache, SCORM_TRACE: "0" },
    stdio: "ignore",
  });
  const ended = once(child, "close");
  const deadline = Date.now() + 10_000;
  try {
    while (!(await readdir(cwd)).some((name) => name.startsWith(".ascii-"))) {
      assert.ok(child.exitCode === null && Date.now() < deadline, "The temporary output was not created");
      await setTimeout(15);
    }
    assert.ok((await readdir(temporary)).some((name) => name.startsWith("scorm-ascii-")));
    child.kill("SIGTERM");
    assert.deepEqual(await ended, [143, null]);
    assert.equal(await readFile(output, "utf8"), "anterior");
    assert.deepEqual(await readdir(temporary), []);
    assert.deepEqual((await readdir(cwd)).sort(), ["out.mp4", "tmp"]);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await ended;
  }
});

test("rejects an unverified codec archive without writing a cache or an automatic trace", { skip: !asciiSupported }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({
    env: { MOODLE_BASE_URL: "invalid-url", SCORM_LANG: "en" }, cwd, stdout, stderr, http: {
      async get() {
        return { status: 200, body: Buffer.from("invalid ZIP"), location: undefined, contentType: "", contentDisposition: undefined };
      },
    },
  });
  const code = await app.run(["ascii", "--prepare"]);
  assert.equal(code, 1);
  assert.match(stderr.output, /tool archive for ffmpeg.*verified build/);
  assert.deepEqual(await readdir(cwd), []);

  assert.equal(await app.run(["ascii", "--prepare", "--trace-dir", join(cwd, "trace")]), 1);
  assert.deepEqual(await readdir(cwd), ["trace"]);
});

test("aborts the codec download and returns 130 when interrupted", { skip: !asciiSupported }, async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-cli-test-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const interruptions = new CliInterruptions();
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  const stderr = new CapturedStream();
  const app = new CliApplication({
    env: {}, cwd, stdout: new CapturedStream(), stderr, interruptions, http: {
      async get(request) {
        notifyStarted();
        return new Promise<never>((_resolve, reject) => {
          request.signal!.addEventListener("abort", () => reject(request.signal!.reason), { once: true });
        });
      },
    },
  });
  const finished = app.run(["ascii", "--prepare"]);
  const startedFirst = await Promise.race([started.then(() => true), finished.then(() => false)]);
  assert.equal(startedFirst, true, stderr.output);
  assert.equal(interruptions.request(130), true);
  assert.equal(await finished, 130);
  assert.equal(interruptions.request(130), false);
  assert.deepEqual(await readdir(cwd), []);
});
