import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";

const locator = new PluginfileLocator({ maxPrefix: 64 });
const ANY = /\/pluginfile\.php\/[^\s"'<>)]+/;
const SCORM = /\/pluginfile\.php\/\d+\/mod_scorm\/content\/\d+\/[^\s"'<>)]+/;

describe("PluginfileLocator", () => {
  const cases: Array<[string, string, string]> = [
    ["una URL absoluta entre comillas", `<a href="https://h.example/pluginfile.php/5/x/a.pdf">`, "https://h.example/pluginfile.php/5/x/a.pdf"],
    ["una ruta sin dominio", `<a href="/pluginfile.php/5/x/a.pdf">`, "/pluginfile.php/5/x/a.pdf"],
    ["conserva el prefijo de instalación (/moodle)", `url('https://h.example/moodle/pluginfile.php/5/a.pdf')`, "https://h.example/moodle/pluginfile.php/5/a.pdf"],
    ["se detiene en = y ;", `content="0;url=https://h.example/pluginfile.php/5/a.pdf"`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["se detiene en un punto y coma sin = delante", `x;https://h.example/pluginfile.php/5/a.pdf`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["se detiene en espacios y paréntesis", `abrir (https://h.example/pluginfile.php/5/a.pdf) ya`, "https://h.example/pluginfile.php/5/a.pdf"],
    ["se detiene en una coma", `x,/moodle/pluginfile.php/5/a.pdf`, "/moodle/pluginfile.php/5/a.pdf"],
  ];
  for (const [name, text, expected] of cases) {
    it(`localiza ${name}`, () => assert.equal(locator.locate(text, ANY), expected));
  }

  it("aplica el patrón indicado (p. ej. solo contenido SCORM)", () => {
    const text = `/pluginfile.php/1/mod_resource/content/1/a.pdf y https://h/pluginfile.php/10067/mod_scorm/content/3/index.html`;
    assert.equal(locator.locate(text, SCORM), "https://h/pluginfile.php/10067/mod_scorm/content/3/index.html");
  });

  it("devuelve undefined si no hay ninguna referencia", () => {
    assert.equal(locator.locate("<html>nada</html>", ANY), undefined);
  });

  it("limita cuánto retrocede buscando el inicio de la URL", () => {
    const text = `${"a".repeat(200)}/pluginfile.php/5/a.pdf`;
    assert.equal(locator.locate(text, ANY), `${"a".repeat(64)}/pluginfile.php/5/a.pdf`);
  });

  it("el principio del texto también es un límite", () => {
    assert.equal(locator.locate("/pluginfile.php/5/a.pdf", ANY), "/pluginfile.php/5/a.pdf");
  });

  describe("rendimiento con páginas patológicas (regresión: antes era cuadrático)", () => {
    const inputs: Array<[string, string]> = [
      ["50 000 «http://» seguidos", "http://".repeat(50_000)],
      ["40 000 «http://a» seguidos", "http://a".repeat(40_000)],
      ["una URL de 300 000 caracteres", `http://x/${"a".repeat(300_000)}`],
    ];
    for (const [name, input] of inputs) {
      it(`resuelve en menos de medio segundo ${name}`, () => {
        const started = performance.now();
        locator.locate(input, ANY);
        locator.locate(`${input}/pluginfile.php/1/mod_scorm/content/1/i.html`, SCORM);
        assert.ok(performance.now() - started < 500, `tardó ${(performance.now() - started).toFixed(0)} ms`);
      });
    }
  });
});
