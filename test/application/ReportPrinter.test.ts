import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchReport } from "../../src/application/BatchDownloader.ts";
import type { ItemOutcome } from "../../src/application/ItemDownloader.ts";
import { ReportPrinter } from "../../src/application/ReportPrinter.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";
import { es } from "../../src/i18n/es.ts";
import { MemoryLogger } from "../support/fakes.ts";

const item = (name: string): CourseItem => ({ id: name, kind: "resource", name, url: "u", sectionNumber: 1 });

function report(outcomes: ItemOutcome[], aborted = false): BatchReport {
  const count = (status: string) => outcomes.filter((o) => o.status === status).length;
  return { outcomes, downloaded: count("downloaded"), skipped: count("skipped"), failed: count("failed"), aborted };
}

function print(batch: BatchReport) {
  const logger = new MemoryLogger();
  const code = new ReportPrinter({ logger, messages: es }).print(batch);
  return { code, logger };
}

describe("ReportPrinter", () => {
  it("imprime las rutas descargadas como resultado, avisa de lo omitido y resume; código 0", () => {
    const { code, logger } = print(report([
      { item: item("a"), status: "downloaded", path: "out/1/a.pdf", bytes: 1 },
      { item: item("b"), status: "skipped", path: "out/1/b.pdf" },
    ]));
    assert.equal(code, 0);
    assert.deepEqual(logger.results, ["out/1/a.pdf"]);
    assert.deepEqual(logger.infos, ["Omitido (ya existe): out/1/b.pdf", "Descargados: 1 · Omitidos: 1 · Fallidos: 0"]);
    assert.deepEqual(logger.warnings, []);
  });

  it("un fallo normal se avisa con su detalle y da código 1", () => {
    const { code, logger } = print(report([{ item: item("c"), status: "failed", error: new DownloadError("sin red"), authentication: false }]));
    assert.equal(code, 1);
    assert.deepEqual(logger.warnings, ["Fallo en «c»: sin red"]);
  });

  it("un fallo de sesión da código 3 y el lote abortado lo comunica", () => {
    const { code, logger } = print(
      report([{ item: item("d"), status: "failed", error: new AuthenticationError("sesión"), authentication: true }], true),
    );
    assert.equal(code, 3);
    assert.match(logger.warnings.join("\n"), /La sesión caducó/);
  });

  it("un lote vacío es un éxito", () => {
    assert.equal(print(report([])).code, 0);
  });
});
