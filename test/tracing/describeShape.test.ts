import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { describeShape } from "../../src/tracing/describeShape.ts";

describe("describeShape", () => {
  it("describes primitives and null", () => {
    assert.equal(describeShape("x"), "string");
    assert.equal(describeShape(3), "number");
    assert.equal(describeShape(true), "boolean");
    assert.equal(describeShape(null), "null");
    assert.equal(describeShape(undefined), "undefined");
  });

  it("shows object keys and types without revealing values", () => {
    const shape = describeShape({ password: "hunter2", id: 4, nested: { ok: true } });
    assert.equal(shape, "{password: string, id: number, nested: {ok: boolean}}");
    assert.ok(!shape.includes("hunter2"));
  });

  it("shows array length and the shape of the first element", () => {
    assert.equal(describeShape([]), "[]");
    assert.equal(describeShape([{ id: 1 }, { id: 2 }, { id: 3 }]), "[3 x {id: number}]");
  });

  it("counts nested arrays toward the depth limit", () => {
    assert.equal(describeShape([[[1]]], { depth: 2 }), "[1 x [1 x [...]]]");
  });

  it("limits object depth and the number of keys", () => {
    assert.equal(describeShape({ a: { b: { c: { d: 1 } } } }, { depth: 2 }), "{a: {b: {...}}}");
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, 1]));
    assert.match(describeShape(many, { maxKeys: 3 }), /^\{k0: number, k1: number, k2: number, \.\.\.\+17\}$/);
  });
});
