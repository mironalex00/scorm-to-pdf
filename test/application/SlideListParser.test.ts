import { describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";

const parser = new SlideListParser({ messages: es, maxSlides: 5 });

function assertFormatError(html: string, pattern: RegExp): void {
  assert.throws(
    () => parser.parse(html),
    (error: unknown) => error instanceof ScormFormatError && pattern.test(error.message),
  );
}

describe("SlideListParser", () => {
  it("extrae las diapositivas en orden y el título del documento", () => {
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

  it("normaliza espacios del título y devuelve undefined si falta o está vacío", () => {
    const slides = [{ src: "a.jpg" }];
    assert.equal(parser.parse(buildDeckHtml({ title: "  AFSD \n  Curs 5  ", slides })).title, "AFSD Curs 5");
    assert.equal(parser.parse(buildDeckHtml({ title: "   ", slides })).title, undefined);
    assert.equal(parser.parse(buildDeckHtml({ slides })).title, undefined);
  });

  it("usa cadena vacía cuando una diapositiva no tiene título o no es texto", () => {
    const html = buildDeckHtml({ slides: [{ src: "a.jpg" }, { src: "b.jpg", title: 7 as unknown as string }] });
    assert.deepEqual(parser.parse(html).slides.map((slide) => slide.title), ["", ""]);
  });

  it("no se confunde con corchetes ni punto y coma dentro del texto de las diapositivas", () => {
    const html = buildDeckHtml({
      slides: [
        { src: "a.jpg", title: "lista[0]; y más", text: "x = [1, 2]; const n = 3" },
        { src: "b.jpg", title: "otra ]; cosa" },
      ],
    });
    assert.deepEqual(parser.parse(html).slides.map((slide) => slide.src), ["a.jpg", "b.jpg"]);
  });

  it("falla con el título de la página recibida cuando no hay SLIDES (p. ej. página de login)", () => {
    assertFormatError("<html><title>Conectați-vă la site</title></html>", /SLIDES.*Conectați-vă la site/);
  });

  it("falla indicando que no hay título si la página tampoco lo tiene", () => {
    assertFormatError("<html></html>", /sin título/);
  });

  it("falla cuando el array no es JSON válido", () => {
    assertFormatError("<script>\nconst SLIDES = [{src: 'a.jpg'}];\nconst N = 1;</script>", /interpretar/);
  });

  it("falla cuando el array está vacío", () => {
    assertFormatError(buildDeckHtml({ slides: [] }), /vacío/);
  });

  it("acepta exactamente el máximo de diapositivas permitido", () => {
    const slides = Array.from({ length: 5 }, (_, index) => ({ src: `s${index}.jpg` }));
    assert.equal(parser.parse(buildDeckHtml({ slides })).slides.length, 5);
  });

  it("falla cuando hay más diapositivas que el máximo permitido", () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({ src: `s${index}.jpg` }));
    assertFormatError(buildDeckHtml({ slides }), /6 diapositivas.*máximo.*5/);
  });

  const invalidSources: Array<[string, unknown]> = [
    ["sin src", { title: "x" }],
    ["src vacío", { src: "   " }],
    ["src que no es texto", { src: 3 }],
    ["elemento nulo", null],
  ];
  for (const [name, slide] of invalidSources) {
    it(`falla señalando el número de la diapositiva con ${name}`, () => {
      const html = `<script>\nconst SLIDES = ${JSON.stringify([{ src: "ok.jpg" }, slide])};\nconst N = 2;</script>`;
      assertFormatError(html, /diapositiva 2/);
    });
  }
});
