import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileNamer } from "../../src/application/FileNamer.ts";
import { NamePlanner } from "../../src/application/NamePlanner.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";

const namer = new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 });
const planner = new NamePlanner({ namer });

it("assigns distinct folders to equivalent section titles and falls back to the section number", () => {
  assert.deepEqual([...planner.sectionFolders([
    { number: 1, title: "Curs / I" },
    { number: 2, title: "curs : I" },
    { number: 3, title: "" },
  ])], [[1, "Curs _ I"], [2, "curs _ I (2)"], [3, "3"]]);
});
const item = (id: string, name: string, sectionNumber: number): CourseItem => ({ id, kind: "resource", name, url: "u", sectionNumber });

describe("NamePlanner", () => {
  it("assigns a sanitized base name to each item", () => {
    const plan = planner.plan([item("1", "Curs/1", 1), item("2", "Ejercicios", 1)]);
    assert.deepEqual([...plan], [["1", "Curs_1"], ["2", "Ejercicios"]]);
  });

  it("numbers titles that differ only in case in input order within each section", () => {
    const plan = planner.plan([item("a", "Tema", 1), item("b", "tema", 1), item("c", "TEMA", 1)]);
    assert.deepEqual([plan.get("a"), plan.get("b"), plan.get("c")], ["Tema", "tema (2)", "TEMA (3)"]);
  });

  it("allows the same item title in different sections", () => {
    const plan = planner.plan([item("a", "Tema", 1), item("b", "Tema", 2)]);
    assert.deepEqual([plan.get("a"), plan.get("b")], ["Tema", "Tema"]);
  });

  it("keeps flat filenames distinct when titles include a file extension", () => {
    const items = [item("a", "Notes", 1), item("b", "notes.PDF", 1), item("c", "Notes (2)", 1)];
    const plan = planner.plan(items, false);
    const outputNames = items.map(({ id }) =>
      namer.fileName({ baseName: plan.get(id)!, sourceFileName: "handout.pdf", contentType: "application/pdf" }));
    assert.equal(outputNames[0], "Notes.pdf");
    assert.equal(new Set(outputNames.map((name) => name.toLowerCase())).size, items.length);
    assert.equal(planner.plan(items).get("b"), "notes.PDF");
  });

  it("reserves shorter titles when an earlier title includes a file extension", () => {
    const plan = planner.plan([item("a", "Notes.pdf", 1), item("b", "notes", 1)], false);
    assert.deepEqual([...plan], [["a", "Notes.pdf"], ["b", "notes (2)"]]);
  });

  it("preserves a natural title that already has a numeric suffix", () => {
    const items = [item("a", "Notes (2)", 1), item("b", "Notes", 1), item("c", "notes", 1), item("d", "Notes", 1)];
    assert.deepEqual([...planner.plan(items).values()], ["Notes (2)", "Notes", "notes (3)", "Notes (4)"]);
  });
});
