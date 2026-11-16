import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "../../src/application/CatalogService.ts";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import type { CourseContents } from "../../src/domain/catalog.ts";

const contents: CourseContents = {
  sections: [{ number: 3, title: "S3" }, { number: 0, title: "G" }, { number: 1, title: "S1" }],
  items: [
    { id: "a", kind: "resource", name: "A", url: "u", sectionNumber: 1 },
    { id: "b", kind: "scorm", name: "B", url: "u", sectionNumber: 3 },
    { id: "c", kind: "resource", name: "C", url: "u", sectionNumber: 1 },
  ],
};

function make() {
  const platform = new FakePlatform();
  platform.courses = [
    { id: "1", name: "Curs 10" }, { id: "2", name: "Álgebra" }, { id: "3", name: "Curs 2" }, { id: "4", name: "biologie" },
  ];
  platform.contents = { "1": contents };
  const store = new CompressedStore<unknown>({ redactor: new Redactor() });
  return { platform, store, catalog: new CatalogService({ platform, store, locale: "es", tracer: new NullTracer() }) };
}

describe("CatalogService", () => {
  it("ordena los cursos alfabéticamente sin distinguir acentos ni mayúsculas y con números naturales", async () => {
    const { catalog } = make();
    assert.deepEqual((await catalog.courses()).map((c) => c.name), ["Álgebra", "biologie", "Curs 2", "Curs 10"]);
  });

  it("consulta la plataforma una sola vez y guarda el catálogo comprimido", async () => {
    const { catalog, platform, store } = make();
    await catalog.courses();
    await catalog.courses();
    assert.equal(platform.calls.listCourses, 1);
    assert.ok(store.bytes() > 0 && store.has("courses"));
    assert.deepEqual([...store.raw("courses")!.subarray(0, 2)], [0x1f, 0x8b]);
  });

  it("carga el contenido de un curso bajo demanda y lo cachea por curso", async () => {
    const { catalog, platform } = make();
    const course = { id: "1", name: "Curs 10" };
    assert.deepEqual(await catalog.contents(course), contents);
    await catalog.contents(course);
    assert.deepEqual(platform.calls.loadContents, ["1"]);
  });

  it("ofrece las secciones de menor a mayor y los ítems de cada una en el orden de la página", () => {
    const { catalog } = make();
    assert.deepEqual(catalog.sectionsOf(contents).map((s) => s.number), [0, 1, 3]);
    assert.deepEqual(catalog.itemsIn(contents, 1).map((i) => i.id), ["a", "c"]);
    assert.deepEqual(catalog.itemsIn(contents, 0), []);
  });

  it("busca cursos por id exacto o por texto sin distinguir mayúsculas ni acentos", async () => {
    const { catalog } = make();
    assert.deepEqual((await catalog.find("2")).map((c) => c.name), ["Álgebra"]);
    assert.deepEqual((await catalog.find("ALGEBRA")).map((c) => c.id), ["2"]);
    assert.deepEqual((await catalog.find("curs")).map((c) => c.id), ["3", "1"]);
    assert.deepEqual(await catalog.find("nada"), []);
  });

  it("clear() libera todo lo almacenado", async () => {
    const { catalog, store } = make();
    await catalog.courses();
    catalog.clear();
    assert.equal(store.bytes(), 0);
  });
});
