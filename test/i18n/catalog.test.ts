import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../src/i18n/en.ts";
import { createCatalog } from "../../src/plugins/i18n/catalog.ts";
import { es } from "../../src/plugins/i18n/es.ts";
import { ro } from "../../src/plugins/i18n/ro.ts";

type Leaf = (params: Record<string, string>) => string | string[];

// Give each message parameter a visible placeholder.
const spy = new Proxy({}, { get: (_target, name) => `<${String(name)}>` }) as Record<string, string>;
const markers = new Proxy({}, { get: (_target, name) => `{#${String(name)}#}` }) as Record<string, string>;

function collect(node: unknown, path: string[] = []): Array<{ path: string; leaf: Leaf | string }> {
  if (typeof node === "function" || typeof node === "string") return [{ path: path.join("."), leaf: node as Leaf | string }];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => collect(value, [...path, key]));
}

function interpolate(leaf: Leaf | string, params = spy): string | string[] {
  return typeof leaf === "function" ? leaf(params) : leaf;
}

function parameters(text: string | string[]): string[] {
  return [...String(text).matchAll(/\{#([A-Za-z][A-Za-z0-9]*)#\}/g)].map(([, name]) => name!).sort();
}

describe("English message catalog", () => {
  const entries = collect(en);

  it("declares its locale identifier", () => {
    assert.equal(en.locale, "en");
  });

  it("renders every message as plain ASCII, with the Romanian farewell", () => {
    assert.ok(entries.length > 30, `Expected more than 30 entries, got ${entries.length}`);
    for (const { path, leaf } of entries) {
      const produced = interpolate(leaf);
      const text = Array.isArray(produced) ? produced.join("\n") : produced;
      assert.ok(text.trim().length > 0, `Empty message: ${path}`);
      if (path === "tui.farewell") assert.equal(text, "Mulțumesc!");
      else assert.match(text, /^[\n -~]+$/, `Non-ASCII message: ${path}`);
    }
  });

  it("includes interpolated parameters in the message text", () => {
    const withParams = entries.filter(({ leaf }) => typeof leaf === "function" && String(leaf(spy)).includes("<"));
    assert.ok(withParams.length > 20);
  });
});

describe("Spanish and Romanian message catalogs", () => {
  const originals = new Map(collect(en).map(({ path, leaf }) => [path, interpolate(leaf, markers)]));

  for (const catalog of [es, ro]) {
    it(`preserves message shape and interpolation in ${catalog.locale}`, () => {
      const translations = collect(catalog);
      assert.deepEqual(translations.map(({ path }) => path), [...originals.keys()]);
      for (const { path, leaf } of translations) {
        const translated = interpolate(leaf, markers);
        const original = originals.get(path)!;
        assert.equal(Array.isArray(translated), Array.isArray(original), path);
        assert.equal(Array.isArray(translated) && translated.length, Array.isArray(original) && original.length, path);
        assert.deepEqual(parameters(translated), parameters(original), path);
        assert.ok(String(translated).trim(), path);
      }
      assert.equal(catalog.common.defaultFileName(), en.common.defaultFileName());
      assert.equal(catalog.tui.farewell(), "Mulțumesc!");
    });
  }

  it("localizes unnamed sections and outputs without extensions", () => {
    assert.equal(es.commands.weekHeading({ number: "2", title: "" }), "Sección 2");
    assert.equal(ro.commands.weekHeading({ number: "2", title: "" }), "Secțiunea 2");
    assert.match(es.ascii.unsupportedFormat({ format: "" }), /\(sin extensión\)/);
    assert.match(ro.ascii.unsupportedFormat({ format: "" }), /\(fără extensie\)/);
  });

  it("uses English for messages missing from a partial catalog", () => {
    const catalog = createCatalog("fr", { app: { errorPrefix: () => "Erreur :" } });
    assert.equal(catalog.app.errorPrefix(), "Erreur :");
    assert.equal(catalog.app.usageHint(), en.app.usageHint());
    assert.equal(catalog.ascii, en.ascii);
  });
});
