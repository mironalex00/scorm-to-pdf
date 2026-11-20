import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SesskeyExtractor } from "../../../src/platforms/moodle/SesskeyExtractor.ts";
import { SESSKEY, coursesPage } from "../../fixtures/moodle.ts";

const extractor = new SesskeyExtractor();

describe("SesskeyExtractor", () => {
  const pages: Array<[string, string]> = [
    ["M.cfg", coursesPage()],
    ["a hidden input", `<input type="hidden" name="sesskey" value="${SESSKEY}">`],
    ["a sign-out link", `<a href="https://h/login/logout.php?sesskey=${SESSKEY}">Salir</a>`],
  ];
  for (const [name, html] of pages) {
    it(`extracts the session key from ${name}`, () => assert.equal(extractor.extract(html)?.reveal(), SESSKEY));
  }

  it("returns undefined when the session key is absent", () => assert.equal(extractor.extract("<html></html>"), undefined));

  it("hides the session key when printed", () => {
    assert.ok(!String(extractor.extract(coursesPage())).includes(SESSKEY));
  });
});
