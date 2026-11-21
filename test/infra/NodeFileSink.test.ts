import { afterEach, beforeEach, describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSink } from "../../src/infra/NodeFileSink.ts";
import { OutputError } from "../../src/domain/errors.ts";

let dir: string;
const sink = new NodeFileSink({ messages: en });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorm-sink-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("NodeFileSink", () => {
  it("creates missing directories and returns the absolute output path", async () => {
    const target = join(dir, "a", "b", "salida.pdf");
    const written = await sink.write(target, Uint8Array.of(1, 2, 3), new AbortController().signal);
    assert.equal(written, target);
    assert.deepEqual([...(await readFile(target))], [1, 2, 3]);
  });

  it("distinguishes an existing file from a missing path", async () => {
    await sink.write(join(dir, "hay.pdf"), Uint8Array.of(1));
    assert.deepEqual([await sink.exists(join(dir, "hay.pdf")), await sink.exists(join(dir, "no-hay.pdf"))], [true, false]);
  });

  it("surfaces invalid paths instead of reporting a missing file", async () => {
    await assert.rejects(sink.exists(join(dir, "invalid\0.pdf")), { code: "ERR_INVALID_ARG_VALUE" });
  });

  it("resolves relative paths against the working directory", async () => {
    const previous = process.cwd();
    process.chdir(dir);
    try {
      const written = await sink.write("rel.pdf", Uint8Array.of(9));
      assert.ok(written.endsWith("rel.pdf"));
      assert.ok(written.startsWith("/") || /^[A-Za-z]:/.test(written));
    } finally {
      process.chdir(previous);
    }
  });

  it("replaces an existing file and removes the staging directory", async () => {
    const target = join(dir, "x.pdf");
    await writeFile(target, "viejo");
    await sink.write(target, Uint8Array.of(7));
    assert.deepEqual([...(await readFile(target))], [7]);
    assert.deepEqual(await readdir(dir), ["x.pdf"]);
  });

  it("publishes only one complete file when two writers target the same path", async () => {
    const target = join(dir, "shared.pdf");
    const payloads = [Buffer.alloc(64 * 1024, 1), Buffer.alloc(64 * 1024, 2)];
    const written = await Promise.all(payloads.map((payload) => sink.writeIfAbsent(target, payload)));
    assert.equal(written.filter((path) => path === target).length, 1);
    assert.equal(written.filter((path) => path === undefined).length, 1);
    assert.deepEqual(await readFile(target), payloads[written.indexOf(target)]);
    assert.deepEqual(await readdir(dir), ["shared.pdf"]);
  });

  it("writes a 255-byte filename without leaving staging files", async () => {
    const filename = `${"a".repeat(251)}.pdf`;
    const target = join(dir, filename);
    assert.equal(await sink.write(target, Uint8Array.of(5)), target);
    assert.deepEqual([...(await readFile(target))], [5]);
    assert.deepEqual(await readdir(dir), [filename]);
  });

  it("publishes files with owner-only permissions", { skip: process.platform === "win32" }, async () => {
    const target = join(dir, "private.pdf");
    await sink.writeIfAbsent(target, Uint8Array.of(1));
    const mode = (await stat(target)).mode & 0o777;
    assert.equal(mode, 0o600 & ~process.umask());
  });

  it("reports an output error when the parent cannot be created", async () => {
    await writeFile(join(dir, "archivo"), "x");
    await assert.rejects(sink.write(join(dir, "archivo", "hijo.pdf"), Uint8Array.of(1)), OutputError);
  });

  it("reports an output error and removes staging files when the target is a directory", async () => {
    const target = join(dir, "salida.pdf");
    await mkdir(target);
    assert.equal(await sink.exists(target), false);
    await assert.rejects(sink.write(target, Uint8Array.of(1)), OutputError);
    await assert.rejects(sink.writeIfAbsent(target, Uint8Array.of(1)), OutputError);
    assert.deepEqual(await readdir(dir), ["salida.pdf"]);
  });

  it("preserves the cancellation reason and leaves the output directory empty", async () => {
    const reason = new Error("Cancelled by caller");
    const target = join(dir, "course", "slides.pdf");
    await assert.rejects(sink.write(target, Uint8Array.of(1), AbortSignal.abort(reason)), (error) => error === reason);
    assert.deepEqual(await readdir(dir), []);
  });
});
