import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { openAsciiMedia, renderAsciiClip, run } from "../../../src/extensions/ascii/index.ts";
import { probe } from "../../../src/extensions/ascii/media.ts";

const ffmpeg = process.env.FFMPEG || "ffmpeg";
const ffprobe = process.env.FFPROBE || "ffprobe";
const available = [ffmpeg, ffprobe].every((tool) => spawnSync(tool, ["-version"], { timeout: 3000, stdio: "ignore" }).status === 0);
const asset = (name: string) => fileURLToPath(new URL("../../../src/extensions/ascii/content/" + name, import.meta.url));
const exec = promisify(execFile);
const mediaTest = { skip: available ? false : "Requiere FFmpeg y FFprobe" };

test("convierte los PNG y GIF suministrados y devuelve una rejilla de texto reutilizable", mediaTest, async () => {
  for (const name of ["bear_hoop.png", "hammer_point.png", "startled_boy.png"]) {
    const clip = await renderAsciiClip(asset(name), { cols: 24, invert: true });
    assert.equal(clip.frames.length, 1, name);
    assert.equal(clip.frames[0]!.length, clip.rows);
    assert.ok(clip.frames[0]!.every((line) => line.length === 24));
    assert.ok(clip.frames[0]!.join("").trim().length > 0, name);
  }
  for (const name of ["wink_cat.gif", "cry_cat.gif", "scared_cat.gif"]) {
    const clip = await renderAsciiClip(asset(name), { cols: 24, fps: 12, maxFrames: 12 });
    assert.equal(clip.fps, 12);
    assert.ok(clip.frames.length > 1 && clip.frames.length <= 12, name);
    assert.ok(new Set(clip.frames.map((frame) => frame.join("\n"))).size > 1, name);
  }
});

test("lee JPG, JPEG y WebP y exporta texto, ANSI, HTML, JSON, PNG, GIF y vídeo", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-formats-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const target = (filename: string) => join(work, filename);
  for (const ext of ["jpg", "jpeg"]) {
    const image = target("image." + ext);
    await exec(ffmpeg, ["-v", "error", "-i", asset("bear_hoop.png"), "-frames:v", "1", "-threads", "1", image]);
    const clip = await renderAsciiClip(image, { cols: 20, invert: true });
    assert.equal(clip.frames.length, 1, ext);
    assert.match(clip.frames[0]!.join(""), /\S/, ext);
  }

  const webp = fileURLToPath(new URL("../../fixtures/ascii.webp", import.meta.url));
  const webpClip = await renderAsciiClip(webp, { cols: 20, invert: true });
  assert.equal(webpClip.frames.length, 1);
  assert.match(webpClip.frames[0]!.join(""), /\S/);

  for (const ext of ["txt", "ansi", "html", "json", "png", "gif", "mp4", "webm", "mov", "mkv", "avi"]) {
    const output = target("art." + ext);
    await run(asset("wink_cat.gif"), { out: output, cols: 20, fps: 10, bg: true, maxFrames: 5 });
    const result = await readFile(output);
    assert.ok(result.length > 0, ext);
    if (ext === "txt") assert.match(result.toString(), /^[ -~\n]+$/);
    if (ext === "ansi") assert.match(result.toString(), /\x1b\[38;2;/);
    if (ext === "html") assert.match(result.toString(), /<!doctype html>.*setInterval/s);
    if (ext === "json") assert.equal(JSON.parse(result.toString()).frames.length, 5);
    if (ext === "png") assert.deepEqual([...result.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    if (["gif", "mp4", "webm", "mov", "mkv", "avi"].includes(ext)) {
      const clip = await renderAsciiClip(output, { cols: 20, fps: 10 });
      assert.ok(clip.frames.length >= 4 && clip.frames.length <= 5, ext);
    }
  }
});

test("conserva el audio disponible y --mute lo omite", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-audio-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const input = join(work, "in.mp4");
  await exec(ffmpeg, [
    "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=96x64:rate=12:duration=0.6",
    "-f", "lavfi", "-i", "sine=duration=0.6", "-c:v", "libx264", "-c:a", "aac", "-threads", "1", input,
  ]);
  const clip = await renderAsciiClip(input, { cols: 20, fps: 12 });
  assert.ok(clip.frames.length > 1);
  for (const [name, mute] of [["with.mp4", false], ["without.webm", true]] as const) {
    const out = join(work, name);
    await run(input, { out, cols: 20, fps: 12, mute });
    assert.equal((await probe(out)).hasAudio, !mute, name);
  }
});

test("rechaza una entrada inválida y conserva el destino existente", mediaTest, async (t) => {
  const work = await mkdtemp(join(tmpdir(), "ascii-invalid-"));
  t.after(() => rm(work, { recursive: true, force: true }));
  const invalid = join(work, "invalid.png");
  const dest = join(work, "out.txt");
  await writeFile(invalid, "not a PNG");
  await writeFile(dest, "previous");
  await assert.rejects(run(invalid, { out: dest }));
  assert.equal(await readFile(dest, "utf8"), "previous");
  await assert.rejects(run(asset("bear_hoop.png"), { out: asset("bear_hoop.png") }), /mismo archivo/);
  await assert.rejects(run(asset("bear_hoop.png"), { out: join(work, "out.zip") }), /Formato de salida/);
  await assert.rejects(openAsciiMedia(asset("bear_hoop.png"), { signal: AbortSignal.abort() }), { name: "AbortError" });
});
