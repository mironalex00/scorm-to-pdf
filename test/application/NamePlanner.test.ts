import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileNamer } from "../../src/application/FileNamer.ts";
import { NamePlanner } from "../../src/application/NamePlanner.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";

const planner = new NamePlanner({ namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }) });
const item = (id: string, name: string, sectionNumber: number): CourseItem => ({ id, kind: "resource", name, url: "u", sectionNumber });

describe("NamePlanner", () => {
  it("da a cada ítem su nombre base saneado", () => {
    const plan = planner.plan([item("1", "Curs/1", 1), item("2", "Ejercicios", 1)]);
    assert.deepEqual([...plan], [["1", "Curs_1"], ["2", "Ejercicios"]]);
  });

  it("numera los duplicados de una misma sección en el orden de entrada, sin distinguir mayúsculas", () => {
    const plan = planner.plan([item("a", "Tema", 1), item("b", "tema", 1), item("c", "TEMA", 1)]);
    assert.deepEqual([plan.get("a"), plan.get("b"), plan.get("c")], ["Tema", "tema (2)", "TEMA (3)"]);
  });

  it("el mismo nombre en secciones distintas no es un duplicado", () => {
    const plan = planner.plan([item("a", "Tema", 1), item("b", "Tema", 2)]);
    assert.deepEqual([plan.get("a"), plan.get("b")], ["Tema", "Tema"]);
  });

  it("el resultado es el mismo sin importar cuándo termine cada descarga (depende solo del orden de entrada)", () => {
    const items = [item("a", "Tema", 1), item("b", "Tema", 1)];
    assert.deepEqual([...planner.plan(items)], [...planner.plan(items)]);
  });
});
