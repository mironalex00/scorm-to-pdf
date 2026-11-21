import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { setTimeout } from "node:timers/promises";
import { decodeFrames, encodeFrames, mediaInput, probe } from "../../../src/plugins/ascii-fire/media.ts";

const video = { width: 1, height: 1, fps: 12 };
const decode = { ...video, still: false, gif: false, downscale: false, matte: 10 };
const encode = { ...video, format: "png" } as const;
const frame = Buffer.from([10, 20, 30]);

function shellWord(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

async function codec(t: TestContext, program: string) {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const path = join(cwd, "codec");
  const script = join(cwd, "codec.cjs");
  const pidFile = join(cwd, "pid");
  await writeFile(script, [
    `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
    program,
  ].join("\n"));
  await writeFile(path, `#!/bin/sh\nexec ${shellWord(process.execPath)} ${shellWord(script)} "$@"\n`, { mode: 0o700 });
  return { cwd, pidFile, tools: { ffmpeg: path, ffprobe: path } };
}

async function childPid(pidFile: string): Promise<number> {
  const pid = Number(await readFile(pidFile, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 0, "The fixture must write a valid process ID");
  return pid;
}

async function waitForCodecExit(pidFile: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      process.kill(await childPid(pidFile), 0);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ESRCH") return;
      if (code !== "ENOENT") throw error;
    }
    await setTimeout(10);
  }
  assert.fail("The fixture codec did not exit");
}

test("resolves relative media inputs, preserves URLs and rejects blank input", () => {
  const cwd = join(tmpdir(), "media");
  const url = "https://media.example.test/art%20gallery.mp4?size=large";
  assert.equal(mediaInput("./collection/movie.mp4", cwd), join(cwd, "collection", "movie.mp4"));
  assert.equal(mediaInput(url, cwd), url);
  assert.throws(() => mediaInput(" \t", cwd), /Specify an input file/);
});

test("reads both rotation formats and uses the first usable frame rate", async (t) => {
  const { cwd, tools } = await codec(t, `
    const { basename } = require("node:path");
    const name = basename(process.argv.at(-1));
    const rotation = name === "matrix.mov"
      ? { side_data_list: [{}, { rotation: -90 }], tags: { rotate: "0" }, r_frame_rate: "30/2" }
      : { tags: { rotate: "90" } };
    process.stdout.write(JSON.stringify({
      streams: [
        { codec_type: "audio" },
        { codec_type: "video", width: 480, height: 270, avg_frame_rate: "0/0", ...rotation },
      ],
      format: { format_name: "mov" },
    }));
  `);
  const expected = { width: 270, height: 480, still: false, hasAudio: true, gif: false };
  assert.deepEqual(await probe(tools, join(cwd, "matrix.mov")), { ...expected, fps: 15 });
  assert.deepEqual(await probe(tools, join(cwd, "tag.mov")), { ...expected, fps: 12 });
});

test("rejects metadata without video and dimensions exceeding the pixel limit", async (t) => {
  const { cwd, tools } = await codec(t, `
    const streams = process.argv.at(-1).endsWith("wide.mov")
      ? [{ codec_type: "video", width: 10_000, height: 6_000 }]
      : undefined;
    process.stdout.write(JSON.stringify({ streams }));
  `);
  for (const filename of ["no-streams.mov", "wide.mov"]) {
    await assert.rejects(probe(tools, join(cwd, filename)), /No image or video with valid dimensions/);
  }
});

test("stops a probe that emits more metadata than the reader allows", async (t) => {
  const { cwd, pidFile, tools } = await codec(t, `
    process.stdout.write(Buffer.alloc(128 * 1024 + 1, 32));
    setTimeout(() => {}, 5000);
  `);
  await assert.rejects(probe(tools, join(cwd, "movie.mp4")), /too much metadata/);
  const pid = await childPid(pidFile);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("reaps a running codec when a probe deadline expires", { timeout: 5_000 }, async (t) => {
  const { cwd, pidFile, tools } = await codec(t, "setTimeout(() => {}, 5000);");
  await assert.rejects(probe(tools, join(cwd, "movie.mp4"), AbortSignal.timeout(1_500)), { name: "TimeoutError" });
  const pid = await childPid(pidFile);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});

test("reports a codec launch failure with its original cause", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-process-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const missing = join(cwd, "missing-codec");
  await assert.rejects(probe({ ffmpeg: missing, ffprobe: missing }, join(cwd, "movie.mp4")), (error: unknown) =>
    error instanceof Error && /Could not launch ffprobe/.test(error.message) &&
    (error.cause as NodeJS.ErrnoException)?.code === "ENOENT");
});

test("reports a probe's status and diagnostic without exposing the input path", async (t) => {
  const { cwd, tools } = await codec(t, `
    process.stderr.write(process.argv.at(-1) + ": format could not be read");
    process.exitCode = 9;
  `);
  const input = join(cwd, "private filename.mov");
  await assert.rejects(probe(tools, input), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /ffprobe exited with 9/);
    assert.match(error.message, /\[input\]: format could not be read/);
    assert.ok(!error.message.includes(input));
    return true;
  });
});

test("reports signal termination when a probe exits without a numeric status", async (t) => {
  const { cwd, tools } = await codec(t, `process.kill(process.pid, "SIGTERM");`);
  await assert.rejects(probe(tools, join(cwd, "movie.mp4")), /ffprobe exited with SIGTERM/);
});

test("returns a complete blended frame and rejects a partial last frame", async (t) => {
  const { cwd, tools } = await codec(t, "process.stdout.write(Buffer.of(110, 160, 210, 128, 1, 2));");
  const frames = decodeFrames(tools, join(cwd, "movie.mp4"), { ...decode, signal: new AbortController().signal });
  try {
    assert.deepEqual(await frames.next(), { value: Buffer.of(60, 85, 110), done: false });
    await assert.rejects(frames.next(), /FFmpeg returned an incomplete frame/);
  } finally {
    await frames.return(undefined);
  }
});

test("cancellation after a decoded frame reaps the codec", async (t) => {
  const { cwd, pidFile, tools } = await codec(t, `
    process.stdout.write(Buffer.of(10, 20, 30, 255));
    setTimeout(() => {}, 5000);
  `);
  const controller = new AbortController();
  const frames = decodeFrames(tools, join(cwd, "movie.mp4"), { ...decode, signal: controller.signal });
  try {
    assert.deepEqual(await frames.next(), { value: frame, done: false });
    controller.abort();
    await assert.rejects(frames.next(), { name: "AbortError" });
    const pid = await childPid(pidFile);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  } finally {
    await frames.return(undefined);
  }
});

test("rejects pre-cancelled codec operations with the caller's reason", async () => {
  const tools = { ffmpeg: "unused-codec", ffprobe: "unused-codec" };
  const reason = new Error("Media operation cancelled");
  const signal = AbortSignal.abort(reason);
  const isReason = (error: unknown) => error === reason;
  await assert.rejects(probe(tools, "input.png", signal), isReason);
  await assert.rejects(decodeFrames(tools, "input.png", { ...decode, signal }).next(), isReason);
  await assert.rejects(encodeFrames(tools, "out.png", { ...encode, signal }, Readable.from([frame])), isReason);
});

test("reports an encoder failure after all frame bytes were accepted", async (t) => {
  const { cwd, tools } = await codec(t, `
    process.stdin.resume();
    process.stdin.once("end", () => {
      process.stderr.write("output could not be encoded");
      process.exitCode = 7;
    });
  `);
  await assert.rejects(encodeFrames(tools, join(cwd, "out.png"), encode, Readable.from([frame])),
    /ffmpeg exited with 7.*output could not be encoded/s);
});

test("keeps the codec diagnostic when its input pipe closes before a frame arrives", async (t) => {
  const { cwd, pidFile, tools } = await codec(t, `
    process.stderr.write("output could not be opened");
    process.exitCode = 6;
  `);
  async function* lateFrame() {
    await waitForCodecExit(pidFile);
    yield frame;
  }
  await assert.rejects(encodeFrames(tools, join(cwd, "out.png"), encode, lateFrame()),
    /ffmpeg exited with 6.*output could not be opened/s);
});

test("cleans up a running encoder that closes its pipe during a frame write", async (t) => {
  const { cwd, pidFile, tools } = await codec(t, `
    process.stderr.write("encoder stopped accepting frames", () => {
      require("node:fs").closeSync(0);
    });
    setTimeout(() => {}, 5000);
  `);
  const options = { ...encode, width: 640, height: 480 };
  const pixels = Buffer.alloc(options.width * options.height * 3);
  await assert.rejects(encodeFrames(tools, join(cwd, "out.png"), options, Readable.from([pixels])),
    /encoder stopped accepting frames/);
  const pid = await childPid(pidFile);
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
});
