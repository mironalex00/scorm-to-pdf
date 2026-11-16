import { describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { UsageError } from "../../src/domain/errors.ts";

const SECRET = "s3cr3tvalue0123456789";

describe("SessionCookie", () => {
  it("un valor suelto se interpreta como MoodleSession", () => {
    const cookie = SessionCookie.parse(SECRET, es);
    assert.equal(cookie.headerValue(), `MoodleSession=${SECRET}`);
    assert.deepEqual(cookie.names(), ["MoodleSession"]);
  });

  it("un par nombre=valor se conserva tal cual (p. ej. con sufijo de sesión)", () => {
    assert.equal(SessionCookie.parse(`MoodleSessionkb=${SECRET}`, es).headerValue(), `MoodleSessionkb=${SECRET}`);
  });

  it("acepta la cabecera Cookie completa con varias cookies", () => {
    const cookie = SessionCookie.parse(`MOODLEID1_=abc; MoodleSession=${SECRET}`, es);
    assert.deepEqual(cookie.names(), ["MOODLEID1_", "MoodleSession"]);
    assert.equal(cookie.headerValue(), `MOODLEID1_=abc; MoodleSession=${SECRET}`);
  });

  it("quita el prefijo 'Cookie:', comillas envolventes y espacios o saltos de línea finales", () => {
    assert.equal(SessionCookie.parse(`  Cookie: MoodleSession=${SECRET}\n`, es).headerValue(), `MoodleSession=${SECRET}`);
    assert.equal(SessionCookie.parse(`'MoodleSession=${SECRET}'`, es).headerValue(), `MoodleSession=${SECRET}`);
    assert.equal(SessionCookie.parse(`"${SECRET}"`, es).headerValue(), `MoodleSession=${SECRET}`);
  });

  const invalid: Array<[string, string | undefined]> = [
    ["ausente", undefined],
    ["vacía", ""],
    ["solo espacios", "   \n"],
    ["solo el prefijo", "Cookie:"],
    ["con salto de línea intermedio (inyección de cabeceras)", "MoodleSession=a\r\nX-Evil: 1"],
    ["con caracteres no ASCII", "MoodleSession=ñandú"],
  ];
  for (const [name, raw] of invalid) {
    it(`rechaza una cookie ${name}`, () => {
      assert.throws(
        () => SessionCookie.parse(raw, es),
        (error: unknown) => error instanceof UsageError && /MOODLE_COOKIE/.test(error.message),
      );
    });
  }

  it("nunca revela el valor al convertirla en texto, JSON o al inspeccionarla", () => {
    const cookie = SessionCookie.parse(SECRET, es);
    for (const rendered of [String(cookie), JSON.stringify(cookie), inspect(cookie), `${cookie}`]) {
      assert.ok(!rendered.includes(SECRET), `filtración en: ${rendered}`);
      assert.match(rendered, /MoodleSession/);
    }
  });
});
