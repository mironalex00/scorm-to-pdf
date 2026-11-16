import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeShape } from "../../src/tracing/describeShape.ts";

describe("describeShape", () => {
  it("describe tipos primitivos y nulos", () => {
    assert.equal(describeShape("x"), "string");
    assert.equal(describeShape(3), "number");
    assert.equal(describeShape(true), "boolean");
    assert.equal(describeShape(null), "null");
    assert.equal(describeShape(undefined), "undefined");
  });

  it("describe objetos con sus claves y tipos, sin revelar nunca los valores", () => {
    const shape = describeShape({ password: "hunter2", id: 4, nested: { ok: true } });
    assert.equal(shape, "{password: string, id: number, nested: {ok: boolean}}");
    assert.ok(!shape.includes("hunter2"));
  });

  it("describe arrays por su longitud y la forma del primer elemento", () => {
    assert.equal(describeShape([]), "[]");
    assert.equal(describeShape([{ id: 1 }, { id: 2 }, { id: 3 }]), "[3 × {id: number}]");
  });

  it("limita la profundidad y el número de claves", () => {
    assert.equal(describeShape({ a: { b: { c: { d: 1 } } } }, { depth: 2 }), "{a: {b: {…}}}");
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 1]));
    assert.match(describeShape(many, { maxKeys: 3 }), /^\{k0: number, k1: number, k2: number, …\+17\}$/);
  });
});
