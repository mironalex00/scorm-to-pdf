import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";

describe("CompressedStore", () => {
  const make = () => {
    const redactor = new Redactor();
    return { store: new CompressedStore<unknown>({ redactor }), redactor };
  };
  const big = Array.from({ length: 300 }, (_, i) => ({ id: String(i), name: "Algoritmi fundamentali și structuri de date", kind: "resource" }));

  it("guarda y recupera estructuras idénticas", () => {
    const { store } = make();
    store.set("c1", big);
    assert.deepEqual(store.get("c1"), big);
  });

  it("ocupa bastante menos que el JSON original y se guarda como gzip", () => {
    const { store } = make();
    store.set("c1", big);
    assert.ok(store.bytes() < JSON.stringify(big).length / 5, `bytes=${store.bytes()}`);
    assert.deepEqual([...store.raw("c1")!.subarray(0, 2)], [0x1f, 0x8b]);
  });

  it("devuelve undefined para claves ausentes y permite comprobar, borrar y vaciar", () => {
    const { store } = make();
    assert.equal(store.get("x"), undefined);
    assert.equal(store.raw("x"), undefined);
    store.set("a", 1);
    store.set("b", 2);
    assert.deepEqual([store.has("a"), store.has("z")], [true, false]);
    assert.deepEqual(store.keys(), ["a", "b"]);
    store.delete("a");
    assert.equal(store.has("a"), false);
    store.clear();
    assert.deepEqual([store.keys(), store.bytes()], [[], 0]);
  });

  it("jamás almacena secretos registrados: se redactan antes de comprimir", () => {
    const { store, redactor } = make();
    redactor.addSecret("cookie-value-123");
    store.set("c", { url: "https://h/?q=cookie-value-123", n: 1 });
    assert.deepEqual(store.get("c"), { url: "https://h/?q=[REDACTADO]", n: 1 });
    assert.ok(!Buffer.from(store.raw("c")!).toString("latin1").includes("cookie-value-123"));
  });

  it("sobrescribe una clave existente", () => {
    const { store } = make();
    store.set("k", "uno");
    store.set("k", "dos");
    assert.equal(store.get("k"), "dos");
  });
});
