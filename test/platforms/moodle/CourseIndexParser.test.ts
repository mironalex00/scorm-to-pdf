import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { CourseIndexParser } from "../../../src/platforms/moodle/CourseIndexParser.ts";
import { BASE, COURSE_BODY, COURSE_INDEX } from "../../fixtures/moodle.ts";

const parser = new CourseIndexParser({ html: new HtmlParser() });
const parse = (html: string) => parser.parse(html, new URL(BASE));
const U = "https://moodle.example.org/mod";

describe("CourseIndexParser", () => {
  const { contents, stats } = parse(COURSE_INDEX);

  it("extrae las secciones tal como las nombra la página, sin tratar ningún número de forma especial", () => {
    assert.deepEqual(contents.sections, [
      { number: 0, title: "General" },
      { number: 1, title: "Săptămâna 1" },
      { number: 3, title: "Fără enlace" },
    ]);
  });

  it("extrae solo recursos y SCORM, con URL absoluta, id de módulo y sección", () => {
    assert.deepEqual(contents.items, [
      { id: "501", kind: "resource", name: "Programa", url: `${U}/resource/view.php?id=501`, sectionNumber: 0 },
      { id: "511", kind: "scorm", name: "Curs 5. Funcții", url: `${U}/scorm/view.php?id=511`, sectionNumber: 1 },
      { id: "512", kind: "resource", name: "Exerciții & teme", url: `${U}/resource/view.php?id=512`, sectionNumber: 1 },
      { id: "531", kind: "resource", name: "Complementar", url: `${U}/resource/view.php?id=531`, sectionNumber: 3 },
    ]);
  });

  it("cuenta lo descartado y por qué, para poder diagnosticar", () => {
    assert.equal(stats.sections, 3);
    assert.equal(stats.items, 4);
    assert.deepEqual(stats.skippedModules, { forum: 1, url: 1, other: 1 });
    assert.deepEqual(stats.dropped, { unnamed: 1, noHref: 1, noId: 1, invalidHref: 1, duplicate: 1, invalidSections: 1 });
  });

  it("registra los marcadores data-for encontrados (huella del marcado)", () => {
    assert.equal(stats.markers.section, 4);
    assert.equal(stats.markers.cm_name, 12);
    assert.equal(stats.markers.section_title, 3);
  });

  it("una página sin índice de curso da un resultado vacío con estadísticas a cero", () => {
    const empty = parse("<html><body><p>nada</p></body></html>");
    assert.deepEqual(empty.contents, { sections: [], items: [] });
    assert.deepEqual(empty.stats.markers, {});
  });

  it("descarta una sección que no declara data-number y lo anota", () => {
    const missing = parse(`<div class="courseindex-section"></div>`);
    assert.deepEqual(missing.contents.sections, []);
    assert.equal(missing.stats.dropped.invalidSections, 1);
  });

  it("identifica secciones solo por clase y deja el título vacío si no existe", () => {
    const only = parse(`<div class="courseindex-section" data-number="2"></div>`);
    assert.deepEqual(only.contents.sections, [{ number: 2, title: "" }]);
  });

  it("lee títulos y materiales del cuerpo, con cada actividad en su subsección", () => {
    const { contents, stats } = parse(COURSE_BODY);
    assert.deepEqual(contents.sections, [
      { number: 1, title: "Săptămâna 1" },
      { number: 15, title: "Curs 1: Introducere" },
    ]);
    assert.deepEqual(contents.items, [
      { id: "511", kind: "scorm", name: "Curs 1: prezentarea", url: `${U}/scorm/view.php?id=511`, sectionNumber: 15 },
      { id: "512", kind: "resource", name: "Exerciții & teme", url: `${U}/resource/view.php?id=512`, sectionNumber: 15 },
    ]);
    assert.deepEqual(stats.skippedModules, { book: 1 });
  });

  it("en un índice anidado toma los títulos y enlaces de la sección que los contiene", () => {
    const { contents } = parse(`
      <div class="courseindex-section" data-number="1">
        <div class="courseindex-section" data-number="15">
          <a data-for="section_title">Introducere</a>
          <a data-for="cm_name" href="/mod/scorm/view.php?id=511">Curs 1</a>
        </div>
      </div>`);
    assert.deepEqual(contents.sections, [{ number: 1, title: "" }, { number: 15, title: "Introducere" }]);
    assert.deepEqual(contents.items.map((item) => [item.id, item.sectionNumber]), [["511", 15]]);
  });

  it("combina ambos orígenes sin duplicados y conserva la sección del cuerpo si discrepan", () => {
    const { contents } = parse(COURSE_INDEX + COURSE_BODY);
    assert.equal(contents.sections.filter((section) => section.number === 1).length, 1);
    assert.deepEqual(contents.items.map((item) => [item.id, item.sectionNumber]), [
      ["511", 15], ["512", 15], ["501", 0], ["531", 3],
    ]);
  });

  it("completa con el título del índice una sección sin nombre en el cuerpo", () => {
    const { contents } = parse(`
      <li data-for="section" data-number="1"></li>
      <div class="courseindex-section" data-number="1"><a data-for="section_title">Tema</a></div>
    `);
    assert.deepEqual(contents.sections, [{ number: 1, title: "Tema" }]);
  });

  it("prefiere el texto del título del índice cuando el cuerpo usa otra etiqueta", () => {
    const { contents } = parse(COURSE_BODY + `
      <div class="courseindex-section" data-number="15" data-sectionname="Otra etiqueta">
        <a class="courseindex-link text-truncate" data-action="togglecourseindexsection" data-for="section_title" tabindex="-1">
          Curs 1 &amp; aplicații
        </a>
      </div>`);
    assert.deepEqual(contents.sections.find(({ number }) => number === 15), { number: 15, title: "Curs 1 & aplicații" });
    assert.equal(contents.items[0]?.sectionNumber, 15);
  });
});
