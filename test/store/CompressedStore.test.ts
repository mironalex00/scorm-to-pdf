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

  it("round-trips structured values", () => {
    const { store } = make();
    store.set("c1", big);
    assert.deepEqual(store.get("c1"), big);
  });

  it("compresses a larger catalog with gzip", () => {
    const { store } = make();
    store.set("c1", big);
    assert.ok(store.bytes() < JSON.stringify(big).length / 5, `bytes=${store.bytes()}`);
    const raw = store.raw("c1")!;
    assert.deepEqual([...raw.subarray(0, 2)], [0x1f, 0x8b]);
    assert.equal(raw.buffer.byteLength, raw.length);
  });

  it("checks for missing keys, deletes entries, and clears the store", () => {
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

  it("redacts registered secrets before compressing values", () => {
    const { store, redactor } = make();
    redactor.addSecret("cookie-value-123");
    store.set("c", { url: "https://h/?q=cookie-value-123", n: 1 });
    assert.deepEqual(store.get("c"), { url: "https://h/?q=[REDACTED]", n: 1 });
    assert.ok(!Buffer.from(store.raw("c")!).toString("latin1").includes("cookie-value-123"));
  });

  it("replaces the value of an existing key", () => {
    const { store } = make();
    store.set("k", "uno");
    store.set("k", "dos");
    assert.equal(store.get("k"), "dos");
  });

  it("evicts the least recently read entry when the compressed byte limit is reached", () => {
    const { store: sample, redactor } = make();
    sample.set("sample", "Course");
    const maxBytes = sample.bytes() * 2;
    const store = new CompressedStore<unknown>({ redactor, maxBytes });
    store.set("first", "Course");
    store.set("second", "Course");
    assert.equal(store.get("first"), "Course");

    store.set("third", "Course");

    assert.deepEqual(store.keys(), ["first", "third"]);
    assert.equal(store.bytes(), maxBytes);
  });

  it("does not evict existing entries for a value larger than the whole store", () => {
    const { store: sample, redactor } = make();
    sample.set("sample", "Course");
    const maxBytes = sample.bytes();
    const store = new CompressedStore<unknown>({ redactor, maxBytes });
    store.set("course", "Course");
    store.set("catalog", big);
    assert.deepEqual(store.keys(), ["course"]);
    assert.equal(store.bytes(), maxBytes);
  });
});
