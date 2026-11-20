import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { after, before, test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openAsciiMedia, renderAsciiClip, run } from "../../../src/extensions/ascii/index.ts";
import { probe } from "../../../src/extensions/ascii/media.ts";

import { PortableMediaRuntime } from "../../../src/extensions/ascii/runtime.ts";
import type { MediaLease } from "../../../src/extensions/ascii/runtime.ts";
import { asciiAsset as asset, asciiCache, asciiIntegration as mediaTest, offline } from "../../support/ascii.ts";

const exec = promisify(execFile);
let lease: MediaLease;
const context = { runtime: { acquire: async () => ({ tools: lease.tools, close: async () => {} }) } };

before(async () => {
  if (mediaTest.skip === false) {
    lease = await new PortableMediaRuntime({ env: { SCORM_ASCII_CACHE: asciiCache }, http: offline }).acquire();
  }
});
after(() => lease?.close());

test("fits a media iterator to the requested rows and releases both leases", mediaTest, async () => {
  let leases = 0;
  const runtime = {
    async acquire() {
      leases += 1;
      return { tools: lease.tools, close: async () => { leases -= 1; } };
    },
  };
  const media = await openAsciiMedia(asset("wink_cat.gif"), { cols: 40, maxRows: 5 }, { runtime });
  assert.ok(media.rows <= 5);
  assert.equal(leases, 0);
  for await (const frame of media.frames()) {
    assert.equal(frame.rows, media.rows);
    assert.equal(leases, 1);
    break;
  }
  assert.equal(leases, 0);
});

test("waits for terminal backpressure and restores the screen after playback", mediaTest, async () => {
  let drains = 0;
  const chunks: string[] = [];
  const stream = Object.assign(new Writable({
    highWaterMark: 1,
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString());
      void setTimeout(2).then(() => callback());
    },
  }), { isTTY: true, columns: 20, rows: 10 });
  stream.on("drain", () => { drains += 1; });
  await run(asset("wink_cat.gif"), { cols: 20, fps: 60, loop: true, maxFrames: 2 }, { ...context, stdout: stream });
  assert.ok(drains >= 2);
  assert.equal(chunks.filter((chunk) => chunk.startsWith("\x1b[H")).length, 2);
  assert.equal(chunks.at(-1), "\x1b[0m\x1b[?25h\x1b[?1049l");
  stream.end();
});

test("converts the supplied PNG and GIF files into reusable text frames", mediaTest, async () => {
  for (const name of ["bear_hoop.png", "hammer_point.png", "startled_boy.png"]) {
    const clip = await renderAsciiClip(asset(name), { cols: 24, invert: true }, context);
    assert.equal(clip.frames.length, 1, name);
    assert.equal(clip.frames[0]!.length, clip.rows);
    assert.ok(clip.frames[0]!.every((line) => line.length === 24));
    assert.ok(clip.frames[0]!.join("").trim().length > 0, name);
  }
  for (const name of ["wink_cat.gif", "cry_cat.gif", "scared_cat.gif"]) {
    const clip = await renderAsciiClip(asset(name), { cols: 24, fps: 12, maxFrames: 12 }, context);
    assert.equal(clip.fps, 12);
    assert.ok(clip.frames.length > 1 && clip.frames.length <= 12, name);
    assert.ok(new Set(clip.frames.map((frame) => frame.join("\n"))).size > 1, name);
  }
});

test("reads JPG, JPEG, and WebP and writes text, ANSI, HTML, JSON, images, and video", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-formats-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const target = (filename: string) => join(work, filename);
  for (const ext of ["jpg", "jpeg"]) {
    const image = target("image." + ext);
    await exec(lease.tools.ffmpeg, ["-v", "error", "-i", asset("bear_hoop.png"), "-frames:v", "1", "-threads", "1", image]);
    const clip = await renderAsciiClip(image, { cols: 20, invert: true }, context);
    assert.equal(clip.frames.length, 1, ext);
    assert.match(clip.frames[0]!.join(""), /\S/, ext);
  }

  const webp = fileURLToPath(new URL("../../fixtures/ascii.webp", import.meta.url));
  const webpClip = await renderAsciiClip(webp, { cols: 20, invert: true }, context);
  assert.equal(webpClip.frames.length, 1);
  assert.match(webpClip.frames[0]!.join(""), /\S/);

  for (const ext of ["txt", "ansi", "html", "json", "png", "gif", "mp4", "webm", "mov", "mkv", "avi"]) {
    const output = target("art." + ext);
    await run(asset("wink_cat.gif"), { out: output, cols: 20, fps: 10, bg: true, maxFrames: 5 }, context);
    const result = await readFile(output);
    assert.ok(result.length > 0, ext);
    if (ext === "txt") assert.match(result.toString(), /^[ -~\n]+$/);
    if (ext === "ansi") assert.match(result.toString(), /\x1b\[38;2;/);
    if (ext === "html") assert.match(result.toString(), /<!doctype html>.*setInterval/s);
    if (ext === "json") assert.equal(JSON.parse(result.toString()).frames.length, 5);
    if (ext === "png") assert.deepEqual([...result.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    if (["gif", "mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
      const clip = await renderAsciiClip(output, { cols: 20, fps: 10 }, context);
      assert.ok(clip.frames.length >= 4 && clip.frames.length <= 5, ext);
    }
  }
});

test("keeps the original video length when audio is shorter and omits audio with --mute", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-audio-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const input = join(work, "in.mp4");
  await exec(lease.tools.ffmpeg, [
    "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=12:duration=1.25",
    "-f", "lavfi", "-i", "sine=duration=0.2", "-c:v", "libx264", "-c:a", "aac", "-threads", "1", input,
  ]);
  const clip = await renderAsciiClip(input, { cols: 20, fps: 12 }, context);
  assert.ok(clip.frames.length > 1);
  for (const [name, mute] of [["with.mp4", false], ["without.webm", true]] as const) {
    const out = join(work, name);
    await run(input, { out, cols: 20, fps: 12, mute }, context);
    assert.equal((await probe(lease.tools, out)).hasAudio, !mute, name);
    assert.equal((await renderAsciiClip(out, { cols: 20, fps: 12 }, context)).frames.length, clip.frames.length, name);
  }
});

test("preserves the duration of a single-frame GIF when changing the frame rate", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-gif-duration-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const input = join(work, "one.gif");
  await exec(lease.tools.ffmpeg, [
    "-v", "error", "-f", "lavfi", "-i", "color=white:s=48x32:r=1:d=1",
    "-frames:v", "1", "-final_delay", "100", input,
  ]);
  const clip = await renderAsciiClip(input, { cols: 20, fps: 12 }, context);
  assert.equal(clip.frames.length, 12);
});

test("rejects invalid input and preserves an existing output file", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-invalid-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const invalid = join(work, "invalid.png");
  const dest = join(work, "out.txt");
  await writeFile(invalid, "not a PNG");
  await writeFile(dest, "previous");
  await assert.rejects(run(invalid, { out: dest }, context));
  assert.equal(await readFile(dest, "utf8"), "previous");
  await assert.rejects(run(asset("bear_hoop.png"), { out: asset("bear_hoop.png") }, context), /different files/);
  await assert.rejects(run(asset("bear_hoop.png"), { out: join(work, "out.zip") }, context), /Unsupported output format/);
  await assert.rejects(openAsciiMedia(asset("bear_hoop.png"), { signal: AbortSignal.abort() }, context), { name: "AbortError" });
});

test("passes only the network environment needed by the codec", { skip: process.platform === "win32" }, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-env-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const codec = join(work, "probe.sh");
  const proxy = "http://proxy.example.test:8080";
  const remote = "https://media.example.test/fixture.mp4";
  const metadata = JSON.stringify({ streams: [{ codec_type: "video", width: 1, height: 1 }] });
  await writeFile(codec, [
    "#!/bin/sh",
    '[ "${MOODLE_COOKIE+x}" != x ] && [ "${SCORM_CODEC_TEST_SENTINEL+x}" != x ] || exit 15',
    'case "$*" in',
    `  *${remote}*) [ "$https_proxy" = "${proxy}" ] || exit 16 ;;`,
    '  *) [ "${https_proxy+x}" != x ] || exit 17 ;;',
    "esac",
    `printf '%s\\n' '${metadata}'`,
    "",
  ].join("\n"), { mode: 0o700 });

  const settings = { MOODLE_COOKIE: "synthetic-cookie", SCORM_CODEC_TEST_SENTINEL: "synthetic-value", https_proxy: proxy };
  const previous = Object.keys(settings).map((key) => [key, process.env[key]] as const);
  const tools = { ffmpeg: codec, ffprobe: codec };
  try {
    Object.assign(process.env, settings);
    for (const input of [join(work, "fixture.png"), remote]) {
      const info = await probe(tools, input);
      assert.equal(info.width, 1);
      assert.equal(info.height, 1);
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
