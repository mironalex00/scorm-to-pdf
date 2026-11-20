import { describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { UsageError } from "../../src/domain/errors.ts";

const SECRET = "s3cr3tvalue0123456789";

describe("SessionCookie", () => {
  it("treats a bare value as MoodleSession", () => {
    const cookie = SessionCookie.parse(SECRET, en);
    assert.equal(cookie.headerValue(), `MoodleSession=${SECRET}`);
    assert.deepEqual(cookie.names(), ["MoodleSession"]);
  });

  it("preserves an explicit cookie name and value", () => {
    assert.equal(SessionCookie.parse(`MoodleSessionkb=${SECRET}`, en).headerValue(), `MoodleSessionkb=${SECRET}`);
  });

  it("accepts a Cookie header with multiple cookies", () => {
    const cookie = SessionCookie.parse(`MOODLEID1_=abc; MoodleSession=${SECRET}`, en);
    assert.deepEqual(cookie.names(), ["MOODLEID1_", "MoodleSession"]);
    assert.equal(cookie.headerValue(), `MOODLEID1_=abc; MoodleSession=${SECRET}`);
  });

  it("strips the Cookie prefix, surrounding quotes, and trailing whitespace", () => {
    assert.equal(SessionCookie.parse(`  Cookie: MoodleSession=${SECRET}\n`, en).headerValue(), `MoodleSession=${SECRET}`);
    assert.equal(SessionCookie.parse(`'MoodleSession=${SECRET}'`, en).headerValue(), `MoodleSession=${SECRET}`);
    assert.equal(SessionCookie.parse(`"${SECRET}"`, en).headerValue(), `MoodleSession=${SECRET}`);
  });

  const invalid: Array<[string, string | undefined]> = [
    ["missing input", undefined],
    ["an empty value", ""],
    ["whitespace only", "   \n"],
    ["the prefix alone", "Cookie:"],
    ["an embedded line break", "MoodleSession=a\r\nX-Evil: 1"],
    ["non-ASCII characters", "MoodleSession=ñandú"],
  ];
  for (const [name, raw] of invalid) {
    it(`rejects a cookie with ${name}`, () => {
      assert.throws(
        () => SessionCookie.parse(raw, en),
        (error: unknown) => error instanceof UsageError && /MOODLE_COOKIE/.test(error.message),
      );
    });
  }

  it("hides the cookie value in string, JSON, and inspection output", () => {
    const cookie = SessionCookie.parse(SECRET, en);
    for (const rendered of [String(cookie), JSON.stringify(cookie), inspect(cookie), `${cookie}`]) {
      assert.ok(!rendered.includes(SECRET), "Rendering exposed the cookie value");
      assert.match(rendered, /MoodleSession/);
    }
  });
});
