import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OutputNamer } from "../../src/application/OutputNamer.ts";

const namer = new OutputNamer({ maxStemLength: 20 });

describe("OutputNamer", () => {
  it("usa lo que precede al primer '. ' del título: «AFSD · Curs 5. Funcții…» → AFSD-Curs-5.pdf", () => {
    const name = namer.name({ title: "AFSD · Curs 5. Funcții și descompunerea problemelor", scormId: 10067 });
    assert.equal(name, "AFSD-Curs-5.pdf");
  });

  it("usa el título completo cuando no hay '. '", () => {
    assert.equal(namer.name({ title: "Curs 5", scormId: 1 }), "Curs-5.pdf");
    assert.equal(namer.name({ title: "AFSD · Curs 5.", scormId: 1 }), "AFSD-Curs-5.pdf");
  });

  it("quita diacríticos para que el nombre sea portable", () => {
    assert.equal(namer.name({ title: "Algoritmi și structuri", scormId: 1 }), "Algoritmi-si-structu.pdf");
  });

  it("neutraliza intentos de recorrer directorios o inyectar separadores", () => {
    assert.equal(namer.name({ title: "../../etc/passwd", scormId: 1 }), "etc-passwd.pdf");
    assert.equal(namer.name({ title: "a\\b:c*d?\u0000e", scormId: 1 }), "a-b-c-d-e.pdf");
  });

  it("recorta a la longitud máxima sin dejar un guion final", () => {
    const name = namer.name({ title: "abcdefghijklmnopqrs tuvwxyz", scormId: 1 });
    assert.equal(name, "abcdefghijklmnopqrs.pdf");
    assert.equal(namer.name({ title: "abcdefghijklmnopqrs-tuvwxyz", scormId: 1 }), "abcdefghijklmnopqrs.pdf");
  });

  it("si lo que precede al primer '. ' queda vacío, usa el título completo", () => {
    assert.equal(namer.name({ title: ". Intro", scormId: 1 }), "Intro.pdf");
  });

  const fallbacks: Array<[string, string | undefined]> = [
    ["sin título", undefined],
    ["título vacío", ""],
    ["título solo con símbolos", "·· ** ··"],
  ];
  for (const [name, title] of fallbacks) {
    it(`recurre a scorm-<id>.pdf con ${name}`, () => {
      assert.equal(namer.name({ title, scormId: 10067 }), "scorm-10067.pdf");
    });
  }
});
