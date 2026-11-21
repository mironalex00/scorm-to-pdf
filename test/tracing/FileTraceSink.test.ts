import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTraceSink } from "../../src/tracing/FileTraceSink.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorm-trace-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("FileTraceSink", () => {
  it("creates the trace directory when first used and appends one line per event", async () => {
    const target = join(dir, "run-1");
    const sink = new FileTraceSink({ dir: target });
    assert.equal(sink.location(), undefined);
    await assert.rejects(readdir(target));
    sink.write('{"a":1}');
    sink.write('{"a":2}');
    assert.equal(await readFile(join(target, "trace.jsonl"), "utf8"), '{"a":1}\n{"a":2}\n');
    assert.equal(sink.location(), target);
  });

  it("writes numbered snapshots with safe filenames", async () => {
    const sink = new FileTraceSink({ dir });
    sink.snapshot("my/courses page", "uno");
    sink.snapshot("../evil", "dos");
    const files = (await readdir(join(dir, "snapshots"))).sort();
    assert.deepEqual(files, ["01-my_courses_page.txt", "02-.._evil.txt"]);
    assert.equal(await readFile(join(dir, "snapshots", "01-my_courses_page.txt"), "utf8"), "uno");
  });

  it("keeps earlier snapshots when a run directory is reused", async () => {
    assert.equal(new FileTraceSink({ dir }).snapshot("course", "First snapshot"), true);
    assert.equal(new FileTraceSink({ dir }).snapshot("course", "Second snapshot"), true);

    assert.equal(await readFile(join(dir, "snapshots", "01-course.txt"), "utf8"), "First snapshot");
    assert.equal(await readFile(join(dir, "snapshots", "02-course.txt"), "utf8"), "Second snapshot");
  });

  it("reports a snapshot failure when its filename exceeds the filesystem limit", async () => {
    const sink = new FileTraceSink({ dir });

    assert.equal(sink.snapshot("x".repeat(300), "Course details"), false);
    assert.deepEqual(await readdir(join(dir, "snapshots")), []);
  });

  it("suppresses write errors", async () => {
    await writeFile(join(dir, "archivo"), "x");
    const sink = new FileTraceSink({ dir: join(dir, "archivo", "dentro") });
    assert.doesNotThrow(() => sink.write("x"));
    assert.doesNotThrow(() => sink.snapshot("s", "c"));
    assert.equal(sink.location(), undefined);
  });

  it("creates trace files and directories without group or public permissions", { skip: process.platform === "win32" }, async () => {
    const target = join(dir, "private-run");
    const snapshots = join(target, "snapshots");
    const sink = new FileTraceSink({ dir: target });
    sink.write('{"event":"start"}');
    sink.snapshot("course", "Course details");

    const paths = [target, snapshots, join(target, "trace.jsonl"), join(snapshots, "01-course.txt")];
    for (const path of paths) assert.equal((await stat(path)).mode & 0o077, 0, path);
  });

  it("preserves a preexisting group-readable trace file", { skip: process.platform === "win32" }, async () => {
    const trace = join(dir, "trace.jsonl");
    await writeFile(trace, "previous trace\n");
    await chmod(trace, 0o640);

    const sink = new FileTraceSink({ dir });
    sink.write('{"event":"start"}');
    assert.equal(await readFile(trace, "utf8"), "previous trace\n");
    assert.equal(sink.location(), undefined);
  });

  it("requires a direct directory for diagnostic output", async () => {
    const target = join(dir, "original");
    const alias = join(dir, "alias");
    await mkdir(target);
    await symlink(target, alias, "junction");

    const sink = new FileTraceSink({ dir: alias });
    sink.write('{"event":"start"}');
    assert.equal(sink.snapshot("course", "Course details"), false);
    assert.equal(sink.location(), undefined);
    assert.deepEqual(await readdir(target), []);
  });
});
