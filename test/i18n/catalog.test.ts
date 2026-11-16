import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { es } from "../../src/i18n/es.ts";

type Leaf = (params: Record<string, string>) => string | string[];

/** Parámetros espía: cualquier propiedad devuelve su propio nombre, para ejecutar cada mensaje. */
const spy = new Proxy({}, { get: (_target, name) => `<${String(name)}>` }) as Record<string, string>;

function collect(node: unknown, path: string[] = []): Array<{ path: string; leaf: Leaf | string }> {
  if (typeof node === "function" || typeof node === "string") return [{ path: path.join("."), leaf: node as Leaf | string }];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => collect(value, [...path, key]));
}

describe("catálogo es", () => {
  const entries = collect(es);

  it("declara su identificador de idioma", () => {
    assert.equal(es.locale, "es");
  });

  it("tiene mensajes y cada uno produce un texto no vacío con parámetros espía", () => {
    assert.ok(entries.length > 30, `solo ${entries.length} entradas`);
    for (const { path, leaf } of entries) {
      const produced = typeof leaf === "function" ? leaf(spy) : leaf;
      const text = Array.isArray(produced) ? produced.join("\n") : produced;
      assert.ok(text.trim().length > 0, `mensaje vacío: ${path}`);
    }
  });

  it("los mensajes con parámetros los incorporan al texto", () => {
    const withParams = entries.filter(({ leaf }) => typeof leaf === "function" && String(leaf(spy)).includes("<"));
    assert.ok(withParams.length > 20);
  });
});
