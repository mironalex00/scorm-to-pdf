import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SesskeyExtractor } from "../../../src/platforms/moodle/SesskeyExtractor.ts";
import { SESSKEY, coursesPage } from "../../fixtures/moodle.ts";

const extractor = new SesskeyExtractor();

describe("SesskeyExtractor", () => {
  const pages: Array<[string, string]> = [
    ["M.cfg", coursesPage()],
    ["input oculto", `<input type="hidden" name="sesskey" value="${SESSKEY}">`],
    ["enlace de cierre de sesión", `<a href="https://h/login/logout.php?sesskey=${SESSKEY}">Salir</a>`],
  ];
  for (const [name, html] of pages) {
    it(`lo extrae de ${name}`, () => assert.equal(extractor.extract(html)?.reveal(), SESSKEY));
  }

  it("devuelve undefined si no aparece", () => assert.equal(extractor.extract("<html></html>"), undefined));

  it("el resultado no revela su valor al imprimirlo", () => {
    assert.ok(!String(extractor.extract(coursesPage())).includes(SESSKEY));
  });
});
