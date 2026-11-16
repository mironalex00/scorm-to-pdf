import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BatchDownloader } from "../../src/application/BatchDownloader.ts";
import type { ItemOutcome } from "../../src/application/ItemDownloader.ts";
import { FileNamer } from "../../src/application/FileNamer.ts";
import { NamePlanner } from "../../src/application/NamePlanner.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { MemoryLogger } from "../support/fakes.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";

const item = (id: string, name: string, section = 1): CourseItem => ({ id, kind: "resource", name, url: "u", sectionNumber: section });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function make(behaviour: (item: CourseItem, baseName: string) => Promise<ItemOutcome>, concurrency = 2) {
  const logger = new MemoryLogger();
  const batch = new BatchDownloader({
    logger,
    tracer: new NullTracer(),
    items: { download: (it: CourseItem, target: { destRoot: string; baseName: string }) => behaviour(it, target.baseName) },
    planner: new NamePlanner({ namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }) }),
    settings: { concurrency },
  });
  return { batch, logger };
}
const ok = (it: CourseItem, path: string): ItemOutcome => ({ item: it, status: "downloaded", path, bytes: 1 });

describe("BatchDownloader", () => {
  it("descarga todo, conserva el orden de entrada, aplica nombres deterministas y cuenta los resultados", async () => {
    const seen: string[] = [];
    const { batch, logger } = make(async (it, baseName) => {
      seen.push(baseName);
      return it.id === "c" ? { item: it, status: "skipped", path: "p" } : ok(it, `p/${baseName}`);
    });
    const report = await batch.run([item("a", "Tema"), item("b", "Tema"), item("c", "Otro")], "out");
    assert.deepEqual(report.outcomes.map((o) => o.item.id), ["a", "b", "c"]);
    assert.deepEqual(seen.sort(), ["Otro", "Tema", "Tema (2)"]);
    assert.deepEqual([report.downloaded, report.skipped, report.failed, report.aborted], [2, 1, 0, false]);
    assert.deepEqual(logger.updates.map((u) => [u.done, u.total]), [[1, 3], [2, 3], [3, 3]]);
    assert.deepEqual(logger.updates.map((u) => u.label).sort(), ["Otro", "Tema", "Tema"]);
  });

  it("respeta el paralelismo máximo", async () => {
    let inFlight = 0;
    let max = 0;
    const { batch } = make(async (it) => {
      inFlight += 1;
      max = Math.max(max, inFlight);
      await tick();
      inFlight -= 1;
      return ok(it, "p");
    }, 2);
    await batch.run(Array.from({ length: 6 }, (_, i) => item(String(i), `n${i}`)), "out");
    assert.equal(max, 2);
  });

  it("el fallo de un ítem no detiene los demás y queda registrado con su error", async () => {
    const boom = new DownloadError("sin red");
    const { batch } = make(async (it) => {
      if (it.id === "b") throw boom;
      return ok(it, "p");
    }, 1);
    const report = await batch.run([item("a", "A"), item("b", "B"), item("c", "C")], "out");
    assert.deepEqual([report.downloaded, report.failed, report.aborted], [2, 1, false]);
    const failure = report.outcomes[1]!;
    assert.equal(failure.status === "failed" && failure.error, boom);
    assert.equal(failure.status === "failed" && failure.authentication, false);
  });

  it("un error de sesión aborta el resto del lote y se marca como autenticación", async () => {
    const started: string[] = [];
    const { batch } = make(async (it) => {
      started.push(it.id);
      if (it.id === "b") throw new AuthenticationError("sesión");
      return ok(it, "p");
    }, 1);
    const report = await batch.run([item("a", "A"), item("b", "B"), item("c", "C")], "out");
    assert.deepEqual(started, ["a", "b"]);
    assert.equal(report.aborted, true);
    assert.deepEqual(report.outcomes.map((o) => o.status), ["downloaded", "failed"]);
    const failure = report.outcomes[1]!;
    assert.equal(failure.status === "failed" && failure.authentication, true);
  });

  it("un lote vacío devuelve un informe vacío", async () => {
    const { batch } = make(async (it) => ok(it, "p"));
    assert.deepEqual(await batch.run([], "out"), { outcomes: [], downloaded: 0, skipped: 0, failed: 0, aborted: false });
  });
});
