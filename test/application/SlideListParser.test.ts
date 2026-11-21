import { describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";

const parser = new SlideListParser({ messages: en, maxSlides: 5 });

function assertFormatError(html: string, pattern: RegExp): void {
  assert.throws(
    () => parser.parse(html),
    (error: unknown) => error instanceof ScormFormatError && pattern.test(error.message),
  );
}

describe("SlideListParser", () => {
  it("extracts the document title and slides in source order", () => {
    const html = buildDeckHtml({
      title: "AFSD · Curs 5. Funcții și descompunerea problemelor",
      slides: [
        { src: "slides/slide-01.jpg", title: "Curs 5" },
        { src: "slides/slide-02.jpg", title: "Cursul 4" },
      ],
    });
    assert.deepEqual(parser.parse(html), {
      title: "AFSD · Curs 5. Funcții și descompunerea problemelor",
      slides: [
        { src: "slides/slide-01.jpg", title: "Curs 5" },
        { src: "slides/slide-02.jpg", title: "Cursul 4" },
      ],
    });
  });

  it("normalizes title whitespace and leaves a missing or blank title undefined", () => {
    const slides = [{ src: "a.jpg" }];
    assert.equal(parser.parse(buildDeckHtml({ title: "  AFSD \n  Curs 5  ", slides })).title, "AFSD Curs 5");
    assert.equal(parser.parse(buildDeckHtml({ title: "   ", slides })).title, undefined);
    assert.equal(parser.parse(buildDeckHtml({ slides })).title, undefined);
  });

  it("uses an empty title when the slide title is missing or is not a string", () => {
    const html = buildDeckHtml({ slides: [{ src: "a.jpg" }, { src: "b.jpg", title: 7 as unknown as string }] });
    assert.deepEqual(parser.parse(html).slides.map((slide) => slide.title), ["", ""]);
  });

  it("handles brackets and semicolons inside slide text", () => {
    const html = buildDeckHtml({
      slides: [
        { src: "a.jpg", title: "lista[0]; y más", text: "x = [1, 2]; const n = 3" },
        { src: "b.jpg", title: "otra ]; cosa" },
      ],
    });
    assert.deepEqual(parser.parse(html).slides.map((slide) => slide.src), ["a.jpg", "b.jpg"]);
  });

  it("includes the page title in the error when SLIDES is missing", () => {
    assertFormatError("<html><title>Conectați-vă la site</title></html>", /SLIDES.*Conectați-vă la site/);
  });

  it("reports an untitled page when SLIDES and the page title are missing", () => {
    assertFormatError("<html></html>", /untitled/);
  });

  it("rejects invalid JSON", () => {
    assertFormatError("<script>\nconst SLIDES = [{src: 'a.jpg'}];\nconst N = 1;</script>", /Could not parse the SLIDES array/);
  });

  it("rejects an empty slide array", () => {
    assertFormatError(buildDeckHtml({ slides: [] }), /SLIDES array is empty/);
  });

  it("accepts a deck at the slide limit", () => {
    const slides = Array.from({ length: 5 }, (_, index) => ({ src: `s${index}.jpg` }));
    assert.equal(parser.parse(buildDeckHtml({ slides })).slides.length, 5);
  });

  it("rejects a deck over the slide limit", () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({ src: `s${index}.jpg` }));
    assertFormatError(buildDeckHtml({ slides }), /6 slides.*limit is 5/);
  });

  const invalidSources: Array<[string, unknown]> = [
    ["missing src", { title: "x" }],
    ["blank src", { src: "   " }],
    ["non-string src", { src: 3 }],
    ["null slide", null],
  ];
  for (const [name, slide] of invalidSources) {
    it(`reports the slide position for ${name}`, () => {
      const html = `<script>\nconst SLIDES = ${JSON.stringify([{ src: "ok.jpg" }, slide])};\nconst N = 2;</script>`;
      assertFormatError(html, /Slide 2/);
    });
  }
});
