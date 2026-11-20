import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Redactor } from "../../src/tracing/Redactor.ts";

describe("Redactor", () => {
  it("replaces each registered secret and its URL-encoded form", () => {
    const redactor = new Redactor();
    redactor.addSecret("abc 123/XYZ");
    const out = redactor.redact(`a=abc 123/XYZ b=${encodeURIComponent("abc 123/XYZ")} c=abc 123/XYZ`);
    assert.equal(out, "a=[REDACTED] b=[REDACTED] c=[REDACTED]");
  });

  it("ignores empty and very short secrets", () => {
    const redactor = new Redactor();
    redactor.addSecret("");
    redactor.addSecret("ab");
    assert.equal(redactor.redact("abab"), "abab");
  });

  const patterns: Array<[string, string, string]> = [
    ["a session key in a URL", "https://h/x?sesskey=Ab3dEf9ZqW&info=y", "https://h/x?sesskey=[REDACTED]&info=y"],
    ["a session key in M.cfg JSON", `{"sesskey":"Ab3dEf9ZqW","a":1}`, `{"sesskey":"[REDACTED]","a":1}`],
    ["a session key in escaped JSON", `\\"sesskey\\":\\"Ab3dEf9ZqW\\"`, `\\"sesskey\\":\\"[REDACTED]\\"`],
    ["a session key in a hidden input", `<input type="hidden" name="sesskey" value="Ab3dEf9ZqW">`, `<input type="hidden" name="sesskey" value="[REDACTED]">`],
    ["a MoodleSession cookie", "Cookie: MoodleSession=abcdef123456; other=1", "Cookie: MoodleSession=[REDACTED]; other=1"],
    ["a suffixed MoodleSession cookie", "MoodleSessionkb=abcdef123456", "MoodleSessionkb=[REDACTED]"],
    ["a Set-Cookie header", "Set-Cookie: MoodleSession=zzzzzz; path=/", "Set-Cookie: MoodleSession=[REDACTED]; path=/"],
    ["an email address", "contacto: ion.ab.ionescu@student.utcluj.ro fin", "contacto: [REDACTED] fin"],
    ["a token in a URL", "https://h/f.php?token=0123456789abcdef&x=1", "https://h/f.php?token=[REDACTED]&x=1"],
  ];
  for (const [name, input, expected] of patterns) {
    it(`redacts ${name}`, () => assert.equal(new Redactor().redact(input), expected));
  }

  it("preserves text without secrets", () => {
    assert.equal(new Redactor().redact("GET /mod/resource/view.php?id=7 200"), "GET /mod/resource/view.php?id=7 200");
  });

  it("redacts strings in nested objects and arrays and preserves other value types", () => {
    const redactor = new Redactor();
    redactor.addSecret("topsecret");
    const out = redactor.redactValue({ a: "x topsecret y", n: 5, ok: true, none: null, list: ["topsecret", 2], deep: { k: "topsecret" } });
    assert.deepEqual(out, { a: "x [REDACTED] y", n: 5, ok: true, none: null, list: ["[REDACTED]", 2], deep: { k: "[REDACTED]" } });
  });

  it("limits how deeply redactValue traverses nested objects", () => {
    const redactor = new Redactor();
    let nested: Record<string, unknown> = { leaf: "topsecret" };
    for (let i = 0; i < 12; i += 1) nested = { next: nested };
    assert.ok(!JSON.stringify(redactor.redactValue(nested)).includes("topsecret"));
  });

  describe("Redactor performance regression", () => {
    const cases: Array<[string, string]> = [
      ["a long run of word characters", "x".repeat(300_000)],
      ["a long run of dot-separated segments", "a.".repeat(150_000)],
      ["repeated cookie names", "MoodleSession".repeat(15_000)],
      ["an at sign between long runs of text", `${"b".repeat(100_000)}@${"c".repeat(100_000)}`],
    ];
    for (const [name, input] of cases) {
      it(`redacts text in under one second with ${name}`, () => {
        const started = performance.now();
        new Redactor().redact(input);
        assert.ok(performance.now() - started < 1_000, `Elapsed time: ${(performance.now() - started).toFixed(0)} ms`);
      });
    }

    it("redacts a long email address inside surrounding text", () => {
      assert.equal(new Redactor().redact("a ion.ab.ionescu@student.utcluj.ro b"), "a [REDACTED] b");
    });
  });
});

