import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Redactor } from "../../src/tracing/Redactor.ts";

describe("Redactor", () => {
  it("reemplaza cada secreto registrado, también codificado como URL", () => {
    const redactor = new Redactor();
    redactor.addSecret("abc 123/XYZ");
    const out = redactor.redact(`a=abc 123/XYZ b=${encodeURIComponent("abc 123/XYZ")} c=abc 123/XYZ`);
    assert.equal(out, "a=[REDACTADO] b=[REDACTADO] c=[REDACTADO]");
  });

  it("ignora secretos vacíos o demasiado cortos para no destrozar el texto", () => {
    const redactor = new Redactor();
    redactor.addSecret("");
    redactor.addSecret("ab");
    assert.equal(redactor.redact("abab"), "abab");
  });

  const patterns: Array<[string, string, string]> = [
    ["sesskey en URL", "https://h/x?sesskey=Ab3dEf9ZqW&info=y", "https://h/x?sesskey=[REDACTADO]&info=y"],
    ["sesskey en JSON de M.cfg", `{"sesskey":"Ab3dEf9ZqW","a":1}`, `{"sesskey":"[REDACTADO]","a":1}`],
    ["sesskey en JSON escapado", `\\"sesskey\\":\\"Ab3dEf9ZqW\\"`, `\\"sesskey\\":\\"[REDACTADO]\\"`],
    ["sesskey en input hidden", `<input type="hidden" name="sesskey" value="Ab3dEf9ZqW">`, `<input type="hidden" name="sesskey" value="[REDACTADO]">`],
    ["cookie MoodleSession", "Cookie: MoodleSession=abcdef123456; other=1", "Cookie: MoodleSession=[REDACTADO]; other=1"],
    ["cookie con sufijo", "MoodleSessionkb=abcdef123456", "MoodleSessionkb=[REDACTADO]"],
    ["Set-Cookie", "Set-Cookie: MoodleSession=zzzzzz; path=/", "Set-Cookie: MoodleSession=[REDACTADO]; path=/"],
    ["correo electrónico", "contacto: ion.ab.ionescu@student.utcluj.ro fin", "contacto: [REDACTADO] fin"],
    ["token en URL", "https://h/f.php?token=0123456789abcdef&x=1", "https://h/f.php?token=[REDACTADO]&x=1"],
  ];
  for (const [name, input, expected] of patterns) {
    it(`redacta ${name}`, () => assert.equal(new Redactor().redact(input), expected));
  }

  it("no toca el texto sin secretos", () => {
    assert.equal(new Redactor().redact("GET /mod/resource/view.php?id=7 200"), "GET /mod/resource/view.php?id=7 200");
  });

  it("redactValue recorre objetos y arrays y deja intactos los valores no textuales", () => {
    const redactor = new Redactor();
    redactor.addSecret("topsecret");
    const out = redactor.redactValue({ a: "x topsecret y", n: 5, ok: true, none: null, list: ["topsecret", 2], deep: { k: "topsecret" } });
    assert.deepEqual(out, { a: "x [REDACTADO] y", n: 5, ok: true, none: null, list: ["[REDACTADO]", 2], deep: { k: "[REDACTADO]" } });
  });

  it("redactValue corta la recursión demasiado profunda", () => {
    const redactor = new Redactor();
    let nested: Record<string, unknown> = { leaf: "topsecret" };
    for (let i = 0; i < 12; i += 1) nested = { next: nested };
    assert.ok(!JSON.stringify(redactor.redactValue(nested)).includes("topsecret"));
  });

  describe("rendimiento con entradas patológicas (regresión: antes era cuadrático y tardaba decenas de segundos)", () => {
    const cases: Array<[string, string]> = [
      ["una racha larguísima de caracteres de palabra", "x".repeat(300_000)],
      ["una racha de segmentos con punto", "a.".repeat(150_000)],
      ["el nombre de la cookie repetido sin cesar", "MoodleSession".repeat(15_000)],
      ["un @ rodeado de rachas largas", `${"b".repeat(100_000)}@${"c".repeat(100_000)}`],
    ];
    for (const [name, input] of cases) {
      it(`redacta en menos de un segundo ${name}`, () => {
        const started = performance.now();
        new Redactor().redact(input);
        assert.ok(performance.now() - started < 1_000, `tardó ${(performance.now() - started).toFixed(0)} ms`);
      });
    }

    it("sigue redactando un correo largo dentro de texto", () => {
      assert.equal(new Redactor().redact("a ion.ab.ionescu@student.utcluj.ro b"), "a [REDACTADO] b");
    });
  });
});

