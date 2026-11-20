import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LocaleResolver } from "../../src/i18n/LocaleResolver.ts";
import { en } from "../../src/i18n/en.ts";
import { UsageError } from "../../src/domain/errors.ts";
import type { Messages } from "../../src/i18n/Messages.ts";

const fake: Messages = { ...en, locale: "xx" };
const resolver = new LocaleResolver({ catalogs: { en, xx: fake }, defaultLocale: "en" });

describe("LocaleResolver", () => {
  it("uses the default locale when none is specified", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: {} }).locale, "en");
  });

  it("gives --lang priority over environment variables", () => {
    assert.equal(resolver.resolve({ flag: "xx", env: { SCORM_LANG: "en", LANG: "en_US.UTF-8" } }).locale, "xx");
  });

  it("gives SCORM_LANG priority over LANG", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { SCORM_LANG: "xx", LANG: "en_US.UTF-8" } }).locale, "xx");
  });

  it("extracts the language from a locale such as en_US.UTF-8", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "xx_YY.UTF-8" } }).locale, "xx");
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "XX-yy" } }).locale, "xx");
  });

  it("falls back to the default locale when the environment locale is unsupported", () => {
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "fr_FR.UTF-8" } }).locale, "en");
    assert.equal(resolver.resolve({ flag: undefined, env: { LANG: "C" } }).locale, "en");
  });

  it("lists available locales when --lang is unsupported", () => {
    assert.throws(
      () => resolver.resolve({ flag: "fr", env: {} }),
      (error: unknown) => error instanceof UsageError && /fr/.test(error.message) && /en, xx/.test(error.message),
    );
  });

  it("returns the catalog for the selected locale", () => {
    assert.equal(resolver.resolve({ flag: "xx", env: {} }).messages, fake);
  });
});
