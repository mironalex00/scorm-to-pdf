import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { OutputNamer } from "../../src/application/OutputNamer.ts";

const namer = new OutputNamer({ maxStemLength: 20 });

describe("OutputNamer", () => {
  it("uses the title up to the first period followed by a space", () => {
    const name = namer.name({ title: "AFSD · Curs 5. Funcții și descompunerea problemelor", scormId: 10067 });
    assert.equal(name, "AFSD-Curs-5.pdf");
  });

  it("uses the whole title when there is no sentence break", () => {
    assert.equal(namer.name({ title: "Curs 5", scormId: 1 }), "Curs-5.pdf");
    assert.equal(namer.name({ title: "AFSD · Curs 5.", scormId: 1 }), "AFSD-Curs-5.pdf");
  });

  it("removes diacritics from the filename", () => {
    assert.equal(namer.name({ title: "Algoritmi și structuri", scormId: 1 }), "Algoritmi-si-structu.pdf");
  });

  it("removes path separators from the filename", () => {
    assert.equal(namer.name({ title: "../../etc/passwd", scormId: 1 }), "etc-passwd.pdf");
    assert.equal(namer.name({ title: "a\\b:c*d?\u0000e", scormId: 1 }), "a-b-c-d-e.pdf");
  });

  it("truncates the filename stem and removes a trailing hyphen", () => {
    const name = namer.name({ title: "abcdefghijklmnopqrs tuvwxyz", scormId: 1 });
    assert.equal(name, "abcdefghijklmnopqrs.pdf");
    assert.equal(namer.name({ title: "abcdefghijklmnopqrs-tuvwxyz", scormId: 1 }), "abcdefghijklmnopqrs.pdf");
  });

  it("uses the whole title when the first sentence is empty", () => {
    assert.equal(namer.name({ title: ". Intro", scormId: 1 }), "Intro.pdf");
  });

  const fallbacks: Array<[string, string | undefined]> = [
    ["the title is missing", undefined],
    ["the title is empty", ""],
    ["the title contains only symbols", "·· ** ··"],
  ];
  for (const [name, title] of fallbacks) {
    it(`uses scorm-<id>.pdf when ${name}`, () => {
      assert.equal(namer.name({ title, scormId: 10067 }), "scorm-10067.pdf");
    });
  }
});
