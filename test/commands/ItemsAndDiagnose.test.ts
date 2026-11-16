import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "../../src/application/CatalogService.ts";
import { CourseResolver } from "../../src/application/CourseResolver.ts";
import { DiagnoseCommand } from "../../src/commands/DiagnoseCommand.ts";
import { ItemsCommand } from "../../src/commands/ItemsCommand.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseContents, CourseItem } from "../../src/domain/catalog.ts";
import { es } from "../../src/i18n/es.ts";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import { MemoryLogger } from "../support/fakes.ts";

const item = (id: string, kind: "resource" | "scorm", name: string, sectionNumber = 1): CourseItem => ({ id, kind, name, url: "u", sectionNumber });

function make() {
  const platform = new FakePlatform();
  platform.courses = [{ id: "1", name: "Alfa" }, { id: "2", name: "Beta" }];
  const catalog = new CatalogService({ platform, store: new CompressedStore({ redactor: new Redactor() }), locale: "es", tracer: new NullTracer() });
  const logger = new MemoryLogger();
  return { platform, catalog, logger };
}

describe("ItemsCommand", () => {
  it("muestra una semana sin título ni contenido con su marcador de vacía", async () => {
    const { platform, catalog, logger } = make();
    platform.contents["1"] = { sections: [{ number: 2, title: "" }], items: [] };
    const command = new ItemsCommand({ catalog, resolver: new CourseResolver({ catalog, messages: es }), logger, messages: es, query: "alfa", json: false });
    assert.equal(await command.run(), 0);
    assert.deepEqual(logger.results, ["Semana 2", "  (sin contenido descargable)"]);
  });
});

describe("DiagnoseCommand", () => {
  function diagnose(parts: ReturnType<typeof make>) {
    return new DiagnoseCommand({ platform: parts.platform, catalog: parts.catalog, logger: parts.logger, messages: es, tracer: new NullTracer() });
  }

  it("sin cursos el paso de contenido falla, los demás no tienen qué probar y sale con 1", async () => {
    const parts = make();
    parts.platform.courses = [];
    assert.equal(await diagnose(parts).run(), 1);
    const out = parts.logger.results.join("\n");
    assert.match(out, /✓ Lista de cursos: 0 cursos/);
    assert.match(out, /✗ Contenido de un curso: no hay ninguno que probar/);
    assert.match(out, /✓ Resolver un recurso: no hay ninguno que probar/);
    assert.match(out, /✓ Resolver un SCORM: no hay ninguno que probar/);
    assert.match(out, /Traza completa en: $/m);
  });

  it("con cursos pero sin recursos ni SCORM todo pasa y no hay nada que resolver", async () => {
    const parts = make();
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [] }, "2": { sections: [], items: [] } };
    assert.equal(await diagnose(parts).run(), 0);
    assert.deepEqual(parts.platform.calls.fetchItem, []);
  });

  it("un recurso que se resuelve a diapositivas se informa con 0 bytes de archivo", async () => {
    const parts = make();
    const resource = item("7", "resource", "Visor");
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [resource] }, "2": { sections: [], items: [] } };
    parts.platform.fetched["7"] = { kind: "slides", entryUrl: new URL("https://x/"), html: "" };
    assert.equal(await diagnose(parts).run(), 0);
    assert.match(parts.logger.results.join("\n"), /«Visor» \(0 bytes\)/);
  });

  it("un fallo que no es de sesión se marca, los pasos siguientes se ejecutan y sale con 1", async () => {
    const parts = make();
    parts.platform.contents = { "1": new DownloadError("página rota"), "2": new DownloadError("página rota") };
    assert.equal(await diagnose(parts).run(), 1);
    const out = parts.logger.results.join("\n");
    assert.match(out, /✗ Contenido de un curso: página rota/);
    assert.match(out, /✓ Resolver un recurso: no hay ninguno que probar/);
  });

  it("un fallo al buscar muestras en otros cursos queda en la traza y no interrumpe el diagnóstico", async () => {
    const parts = make();
    const scorm = item("9", "scorm", "Curso");
    const contents: CourseContents = { sections: [{ number: 1, title: "S" }], items: [scorm] };
    parts.platform.contents = { "1": contents, "2": new DownloadError("no se pudo leer") };
    parts.platform.fetched["9"] = { kind: "slides", entryUrl: new URL("https://x/"), html: "" };
    assert.equal(await diagnose(parts).run(), 0);
    assert.match(parts.logger.results.join("\n"), /✓ Resolver un SCORM: «Curso»/);
  });

  it("una sesión caducada en un paso omite los siguientes y sale con 3", async () => {
    const parts = make();
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [item("7", "resource", "R")] }, "2": { sections: [], items: [] } };
    parts.platform.fetched["7"] = new AuthenticationError("sesión");
    assert.equal(await diagnose(parts).run(), 3);
    assert.ok(!parts.logger.results.join("\n").includes("Resolver un SCORM"));
  });
});
