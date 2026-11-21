import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { TestContext } from "node:test";
import { CELL_HEIGHT, CELL_WIDTH } from "../../../src/plugins/ascii-fire/AsciiEngine.ts";
import { openAsciiMedia, renderAsciiClip, run } from "../../../src/plugins/ascii-fire/index.ts";
import { asciiAsset, asciiIntegration } from "../../support/ascii.ts";
import { CapturedStream } from "../../support/streams.ts";

const syntheticCodecs = { skip: process.platform === "win32" };
const screenEnter = "\x1b[?1049h\x1b[?25l";
const screenRestore = "\x1b[0m\x1b[?25h\x1b[?1049l";

async function workspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "ascii-export-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

/** Stand-ins publish valid metadata and a controlled sequence of uncompressed RGBA frames. */
async function codecFixture(t: TestContext, input: { width?: number; height?: number; frame?: Buffer; repeat?: number } = {}) {
  const { width = 24, height = 24, frame, repeat = 1 } = input;
  const cwd = await workspace(t);
  const tools = { ffmpeg: join(cwd, "ffmpeg"), ffprobe: join(cwd, "ffprobe") };
  const metadata = JSON.stringify({
    streams: [{ codec_type: "video", width, height, avg_frame_rate: "12/1" }], format: { format_name: "gif" },
  });
  await writeFile(tools.ffprobe, `#!/bin/sh\nprintf '%s\\n' '${metadata}'\n`, { mode: 0o700 });
  await writeFile(tools.ffmpeg, [
    "#!/bin/sh",
    'for last; do :; done',
    'if [ "$last" != "pipe:1" ]; then exec /bin/cat >/dev/null; fi',
    'frames="${0%/*}/rgba.raw"',
    '[ -f "$frames" ] || exit 0',
    "i=0",
    `while [ "$i" -lt ${repeat} ]; do /bin/cat "$frames" || exit 1; i=$((i + 1)); done`,
    "",
  ].join("\n"), { mode: 0o700 });
  if (frame) await writeFile(join(cwd, "rgba.raw"), frame);
  return { cwd, runtime: { acquire: async () => ({ tools, close: async () => {} }) } };
}

test("opens media at the default width and lets the iterator request a single frame", asciiIntegration, async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Use the verified local codec archives"); });
  const media = await openAsciiMedia(asciiAsset("wink_cat.gif"), { invert: true });
  const frames: string[] = [];
  for await (const frame of media.frames(true)) frames.push(media.engine.text(frame));
  assert.equal(media.cols, 80);
  assert.equal(frames.length, 1);
  const rows = frames[0]!.split("\n");
  assert.equal(rows.length, media.rows);
  assert.ok(rows.every((row) => row.length === media.cols));
  assert.match(frames[0]!, /\S/);
});

test("rejects invalid frame rate, frame count, and scale from library callers", syntheticCodecs, async (t) => {
  const context = await codecFixture(t);
  const input = asciiAsset("wink_cat.gif");
  for (const fps of [NaN, 0, 61]) {
    await assert.rejects(openAsciiMedia(input, { fps }, context), /greater than 0 and no higher than 60/);
  }
  await assert.rejects(openAsciiMedia(input, { maxRows: 0 }, context), /row limit must be a positive integer/);
  await assert.rejects(renderAsciiClip(input, { maxFrames: 0 }, context), /requires an integer from 1 to 10000/);
  await assert.rejects(run(input, { scale: 9 }, context), /integer from 1 to 8/);
  await assert.rejects(run(input, { out: "output" }, context), /Unsupported output format: \(no extension\)/);
});

test("writes a private export from a remote media source resolved by the codec", syntheticCodecs, async (t) => {
  const context = await codecFixture(t, { frame: Buffer.alloc(2 * CELL_WIDTH * CELL_HEIGHT * 4, 255) });
  const output = join(context.cwd, "export.TXT");
  await run("https://media.example.test/fixture.gif", { out: "export.TXT", cols: 2, chars: "@" }, context);
  assert.equal(await readFile(output, "utf8"), "@@\n");
  assert.equal((await stat(output)).mode & 0o777, 0o600);
  assert.ok(!(await readdir(context.cwd)).some((name) => name.startsWith(".ascii-")));
});

test("reports an invalid output path when a parent directory is a regular file", async (t) => {
  const cwd = await workspace(t);
  const notADirectory = join(cwd, "file");
  await writeFile(notADirectory, "previous content");
  await assert.rejects(run(asciiAsset("wink_cat.gif"), { out: join(notADirectory, "art.txt") }, { cwd }), { code: "ENOTDIR" });
  assert.equal(await readFile(notADirectory, "utf8"), "previous content");
});

test("reports streams with no frames and preserves prior files and terminal state", syntheticCodecs, async (t) => {
  const context = await codecFixture(t);
  const input = asciiAsset("wink_cat.gif");
  const noFrames = /The input produced no frames/;
  const pipe = new CapturedStream();
  await assert.rejects(run(input, { cols: 4 }, { ...context, stdout: pipe }), noFrames);
  assert.equal(pipe.output, "");

  for (const out of ["art.json", "art.mp4"]) {
    const path = join(context.cwd, out);
    await writeFile(path, "previous");
    await assert.rejects(run(input, { out, cols: 4 }, context), noFrames);
    assert.equal(await readFile(path, "utf8"), "previous");
  }
  assert.ok(!(await readdir(context.cwd)).some((name) => name.startsWith(".ascii-")));

  const terminal = new CapturedStream(true, 10);
  await assert.rejects(run(input, { cols: 4 }, { ...context, stdout: terminal }), noFrames);
  assert.equal(terminal.output, screenEnter + screenRestore);
});

test("fits playback to terminal rows and ends after the decoder finishes", syntheticCodecs, async (t) => {
  const cols = 80;
  const rows = 2;
  const frame = Buffer.alloc(cols * CELL_WIDTH * rows * CELL_HEIGHT * 4, 255);
  const context = await codecFixture(t, { width: 80, height: 4, frame });
  const terminal = new CapturedStream(true);
  await run(asciiAsset("wink_cat.gif"), { chars: "@", fps: 2 }, { ...context, stdout: terminal });
  const expected = "@".repeat(cols);
  assert.equal(terminal.output, `${screenEnter}\x1b[H${expected}\n${expected}\x1b[J${screenRestore}`);
});

test("fits a short terminal and counts the frame limit across repeated playback", syntheticCodecs, async (t) => {
  const frame = Buffer.alloc(4 * CELL_WIDTH * 2 * CELL_HEIGHT * 4, 255);
  const context = await codecFixture(t, { frame });
  const terminal = Object.assign(new CapturedStream(true, 16), { rows: 3 });
  await run(asciiAsset("wink_cat.gif"), { chars: "@", fps: 30, loop: true, maxFrames: 2 }, { ...context, stdout: terminal });
  const fittedFrame = "\x1b[H@@@@\n@@@@\x1b[J";
  assert.equal(terminal.output, screenEnter + fittedFrame.repeat(2) + screenRestore);
});

test("limits buffered HTML exports and removes the unfinished output", { ...syntheticCodecs, timeout: 30_000 }, async (t) => {
  const cols = 500;
  const width = cols * CELL_WIDTH;
  const height = 150 * CELL_HEIGHT;
  const line = Buffer.alloc(width * 4, 255);
  for (let x = 0; x < width; x += CELL_WIDTH) {
    if (x % (2 * CELL_WIDTH) === 0) continue;
    for (let offset = x * 4; offset < (x + CELL_WIDTH) * 4; offset += 4) line.fill(97, offset, offset + 3);
  }
  const frame = Buffer.alloc(width * height * 4);
  for (let row = 0; row < height; row++) line.copy(frame, row * line.length);
  const context = await codecFixture(t, { width: 1000, height: 600, frame, repeat: 10 });
  const output = join(context.cwd, "art.html");
  await writeFile(output, "previous");
  await assert.rejects(run(asciiAsset("wink_cat.gif"), { out: output, cols, bg: true, chars: "<" }, context), /animation is too large/);
  assert.equal(await readFile(output, "utf8"), "previous");
  assert.ok(!(await readdir(context.cwd)).some((name) => name.startsWith(".ascii-")));
});
