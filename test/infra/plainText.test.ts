import { it } from "node:test";
import assert from "node:assert/strict";
import { jsonOutput } from "../../src/infra/plainText.ts";

it("escapes directional marks in JSON while preserving the original value", () => {
  const record = { title: "Plan \u200eSemestrul 1" };
  const rendered = jsonOutput(record);

  assert.ok(rendered.includes("\\u200e"));
  assert.ok(!rendered.includes("\u200e"));
  assert.deepEqual(JSON.parse(rendered), record);
});
