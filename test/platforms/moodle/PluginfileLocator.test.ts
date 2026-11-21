import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";

const locator = new PluginfileLocator({ maxPrefix: 64 });
const ANY = /\/pluginfile\.php\/[^\s"'<>)]+/;
const SCORM = /\/pluginfile\.php\/\d+\/mod_scorm\/content\/\d+\/[^\s"'<>)]+/;

describe("PluginfileLocator", () => {
  const cases: Array<[string, string, string]> = [
    ["in a quoted absolute reference", `<a href="https://h.example/pluginfile.php/5/x/a.pdf">`, "https://h.example/pluginfile.php/5/x/a.pdf"],
    ["in a path without a host", `<a href="/pluginfile.php/5/x/a.pdf">`, "/pluginfile.php/5/x/a.pdf"],
    ["under the Moodle installation path", `url('https://h.example/moodle/pluginfile.php/5/a.pdf')`, "https://h.example/moodle/pluginfile.php/5/a.pdf"],
    ["after the equals sign in a refresh directive", `content="0;url=https://h.example/pluginfile.php/5/a.pdf"`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["after a semicolon", `x;https://h.example/pluginfile.php/5/a.pdf`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["inside parentheses", `abrir (https://h.example/pluginfile.php/5/a.pdf) ya`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["after a comma", `x,/moodle/pluginfile.php/5/a.pdf`, "/moodle/pluginfile.php/5/a.pdf"],
  ];
  for (const [name, text, expected] of cases) {
    it(`finds the URL ${name}`, () => assert.equal(locator.locate(text, ANY), expected));
  }

  it("applies the supplied pattern to find SCORM content", () => {
    const text = `/pluginfile.php/1/mod_resource/content/1/a.pdf y https://h/pluginfile.php/10067/mod_scorm/content/3/index.html`;
    assert.equal(locator.locate(text, SCORM), "https://h/pluginfile.php/10067/mod_scorm/content/3/index.html");
  });

  it("returns undefined when no reference is present", () => {
    assert.equal(locator.locate("<html>nada</html>", ANY), undefined);
  });

  it("limits how far it looks back for the start of a URL", () => {
    const text = `${"a".repeat(200)}/pluginfile.php/5/a.pdf`;
    assert.equal(locator.locate(text, ANY), `${"a".repeat(64)}/pluginfile.php/5/a.pdf`);
  });

  it("handles a reference at the start of the text", () => {
    assert.equal(locator.locate("/pluginfile.php/5/a.pdf", ANY), "/pluginfile.php/5/a.pdf");
  });

  describe("PluginfileLocator performance regression", () => {
    const inputs: Array<[string, string]> = [
      ["50,000 consecutive http:// prefixes", "http://".repeat(50_000)],
      ["40,000 consecutive http://a prefixes", "http://a".repeat(40_000)],
      ["a 300,000-character URL", `http://x/${"a".repeat(300_000)}`],
    ];
    for (const [name, input] of inputs) {
      it(`finds a reference in under 500 ms with ${name}`, () => {
        const started = performance.now();
        locator.locate(input, ANY);
        locator.locate(`${input}/pluginfile.php/1/mod_scorm/content/1/i.html`, SCORM);
        assert.ok(performance.now() - started < 500, `Elapsed time: ${(performance.now() - started).toFixed(0)} ms`);
      });
    }
  });
});
