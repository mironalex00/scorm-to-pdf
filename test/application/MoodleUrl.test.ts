import { it } from "node:test";
import assert from "node:assert/strict";
import { parseMoodleBaseUrl } from "../../src/application/MoodleUrl.ts";
import { UsageError } from "../../src/domain/errors.ts";
import { en } from "../../src/i18n/en.ts";

it("rejects Moodle URLs with user information and keeps it out of the message", () => {
  for (const userInfo of ["demo-user", ":demo-pass"]) {
    assert.throws(
      () => parseMoodleBaseUrl(`https://${userInfo}@moodle.example.org/campus`, "--base-url", en),
      { name: UsageError.name, message: en.cli.baseUrlCredentials({ source: "--base-url" }) },
    );
  }
});
