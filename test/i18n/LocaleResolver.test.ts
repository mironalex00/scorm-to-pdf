import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LocaleResolver } from "../../src/i18n/LocaleResolver.ts";
import { es } from "../../src/i18n/es.ts";
import { UsageError } from "../../src/domain/errors.ts";
import type { Messages } from "../../src/i18n/Messages.ts";

const fake: Messages = { ...es, locale: "xx" };
const resolver = new LocaleResolver({ catalogs: { es, xx: fake }, defaultLocale: "es" });

describe("LocaleResolver", () => {
  it("sin indicaciones usa el idioma por defecto", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: {} }).locale, "es");
  });

  it("la opción --lang tiene prioridad sobre el entorno", () => {
    assert.equal(resolver.resolve({ flag: "xx", env: { SCORM_LANG: "es", LANG: "es_ES.UTF-8" } }).locale, "xx");
  });

  it("SCORM_LANG tiene prioridad sobre LANG", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { SCORM_LANG: "xx", LANG: "es_ES.UTF-8" } }).locale, "xx");
  });

  it("LANG se reduce al código de idioma (es_ES.UTF-8, xx-YY → xx)", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "xx_YY.UTF-8" } }).locale, "xx");
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "XX-yy" } }).locale, "xx");
  });

  it("un idioma de entorno no soportado cae al idioma por defecto sin fallar", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "fr_FR.UTF-8" } }).locale, "es");
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "C" } }).locale, "es");
  });

  it("un --lang no soportado es un error de uso que lista los idiomas disponibles", () => {
    assert.throws(
      () => resolver.resolve({ flag: "fr", env: {} }),
      (error: unknown) => error instanceof UsageError && /fr/.test(error.message) && /es, xx/.test(error.message),
    );
  });

  it("devuelve el catálogo del idioma elegido", () => {
    assert.equal(resolver.resolve({ flag: "xx", env: {} }).messages, fake);
  });
});
