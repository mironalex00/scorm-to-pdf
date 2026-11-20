import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../src/i18n/en.ts";

type Leaf = (params: Record<string, string>) => string | string[];

// Give each message parameter a visible placeholder.
const spy = new Proxy({}, { get: (_target, name) => `<${String(name)}>` }) as Record<string, string>;

function collect(node: unknown, path: string[] = []): Array<{ path: string; leaf: Leaf | string }> {
  if (typeof node === "function" || typeof node === "string") return [{ path: path.join("."), leaf: node as Leaf | string }];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => collect(value, [...path, key]));
}

describe("English message catalog", () => {
  const entries = collect(en);

  it("declares its locale identifier", () => {
    assert.equal(en.locale, "en");
  });

  it("renders every message as plain ASCII, with the Romanian farewell", () => {
    assert.ok(entries.length > 30, `Expected more than 30 entries, got ${entries.length}`);
    for (const { path, leaf } of entries) {
      const produced = typeof leaf === "function" ? leaf(spy) : leaf;
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
