import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { Secret } from "../../src/store/Secret.ts";

describe("Secret", () => {
  it("returns the underlying value through reveal()", () => {
    assert.equal(Secret.of("abc123", "sesskey").reveal(), "abc123");
  });

  it("hides the value in string, JSON, and inspection output", () => {
    const secret = Secret.of("abc123", "sesskey");
    for (const out of [String(secret), `${secret}`, JSON.stringify(secret), inspect(secret)]) {
      assert.ok(!out.includes("abc123"));
      assert.match(out, /sesskey/);
    }
  });
});
