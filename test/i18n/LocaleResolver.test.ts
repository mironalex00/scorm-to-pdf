import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../src/i18n/en.ts";
import { es } from "../../src/plugins/i18n/es.ts";
import { ro } from "../../src/plugins/i18n/ro.ts";
import { LocaleResolver } from "../../src/plugins/i18n/LocaleResolver.ts";

const spanishMexico = { ...es, locale: "es-MX" };
const resolver = new LocaleResolver(en, [es, ro, spanishMexico], () => "ro-RO");

describe("LocaleResolver", () => {
  it("checks the runtime locale when there are no explicit preferences", () => {
    assert.equal(resolver.resolve({ env: {} }), ro);
  });

  it("honors the flag, override, and OS variables in order", () => {
    const env = {
      SCORM_LANG: "es_MX.UTF-8",
      LC_ALL: "ro_RO@euro",
      LC_MESSAGES: "es_ES.UTF-8",
      LANG: "en_US.UTF-8",
    };
    assert.equal(resolver.resolve({ flag: "en", env }), en);
    assert.equal(resolver.resolve({ env }), spanishMexico);
    assert.equal(resolver.resolve({ env: { ...env, SCORM_LANG: "" } }), ro);
    assert.equal(resolver.resolve({ env: { ...env, SCORM_LANG: "", LC_ALL: "" } }), es);
    assert.equal(resolver.resolve({ env: { LANG: "es_ES.UTF-8" } }), es);
  });

  it("tries a regional catalog before removing locale subtags", () => {
    assert.equal(resolver.resolve({ flag: "es-MX", env: {} }), spanishMexico);
    assert.equal(resolver.resolve({ flag: " ES-mx-u-hc-h23 ", env: {} }), spanishMexico);
    assert.equal(resolver.resolve({ flag: "es-AR", env: {} }), es);
  });

  it("falls back to the source catalog for an unsupported or untranslated locale", () => {
    assert.equal(resolver.resolve({ flag: "fr", env: { LANG: "ro_RO.UTF-8" } }), en);
    assert.equal(resolver.resolve({ env: { LANG: "fr_FR.UTF-8" } }), en);
    assert.equal(resolver.resolve({ env: { LANG: "C" } }), en);
  });
});
