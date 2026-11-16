import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTraceSink } from "../../src/tracing/FileTraceSink.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "scorm-trace-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("FileTraceSink", () => {
  it("crea la carpeta de forma perezosa y añade una línea por evento", async () => {
    const target = join(dir, "run-1");
    const sink = new FileTraceSink({ dir: target });
    assert.equal(sink.location(), target);
    await assert.rejects(readdir(target));
    sink.write('{"a":1}');
    sink.write('{"a":2}');
    assert.equal(await readFile(join(target, "trace.jsonl"), "utf8"), '{"a":1}\n{"a":2}\n');
  });

  it("guarda las capturas numeradas con nombres de archivo seguros", async () => {
    const sink = new FileTraceSink({ dir });
    sink.snapshot("my/courses page", "uno");
    sink.snapshot("../evil", "dos");
    const files = (await readdir(join(dir, "snapshots"))).sort();
    assert.deepEqual(files, ["01-my_courses_page.txt", "02-.._evil.txt"]);
    assert.equal(await readFile(join(dir, "snapshots", "01-my_courses_page.txt"), "utf8"), "uno");
  });

  it("ignora los errores de escritura en lugar de propagarlos", async () => {
    await writeFile(join(dir, "archivo"), "x");
    const sink = new FileTraceSink({ dir: join(dir, "archivo", "dentro") });
    assert.doesNotThrow(() => sink.write("x"));
    assert.doesNotThrow(() => sink.snapshot("s", "c"));
  });
});
