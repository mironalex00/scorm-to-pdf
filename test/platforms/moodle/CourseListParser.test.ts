import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CourseListParser } from "../../../src/platforms/moodle/CourseListParser.ts";
import { AuthenticationError, PlatformError } from "../../../src/domain/errors.ts";
import { en } from "../../../src/i18n/en.ts";
import { coursesJson } from "../../fixtures/moodle.ts";

const parser = new CourseListParser({ messages: en });

describe("CourseListParser valid responses", () => {
  it("returns string IDs and decoded names and counts invalid entries", () => {
    const raw = JSON.stringify([{ error: false, data: { courses: [
      { id: 101, fullname: "Algoritmi &amp; date" },
      { id: "102", fullname: "Fizică" },
      { fullname: "sin id" },
      { id: 103 },
      null,
    ] } }]);
    assert.deepEqual(parser.parse(raw), {
      courses: [{ id: "101", name: "Algoritmi & date" }, { id: "102", name: "Fizică" }],
      skipped: 3,
    });
  });

  it("accepts an empty course list", () => {
    assert.deepEqual(parser.parse(coursesJson([])), { courses: [], skipped: 0 });
  });
});

describe("CourseListParser errors", () => {
  const platformErrors: Array<[string, string, RegExp]> = [
    ["non-JSON input", "<html>", /is not JSON/],
    ["a service error with exception details", JSON.stringify([{ error: true, exception: { errorcode: "accessexception", message: "Sin acceso" } }]), /accessexception.*Sin acceso/],
    ["a service error without exception details", JSON.stringify([{ error: true }]), /unknown/],
    ["an object without errorcode", "{}", /\{\}/],
    ["an empty response array", "[]", /\[\]/],
    ["a non-object response entry", "[1]", /number/],
    ["a response entry without data", JSON.stringify([{ error: false }]), /error: boolean/],
    ["a non-array courses field", JSON.stringify([{ error: false, data: { courses: "x" } }]), /courses: string/],
    ["a top-level service error", JSON.stringify({ error: "Fallo", errorcode: "otracosa" }), /otracosa.*Fallo/],
  ];
  for (const [name, raw, pattern] of platformErrors) {
    it(`throws PlatformError for ${name}`, () => {
      assert.throws(() => parser.parse(raw), (e: unknown) => e instanceof PlatformError && pattern.test(e.message));
    });
  }

  const authErrors: Array<[string, string]> = [
    ["an invalid session key", JSON.stringify([{ error: true, exception: { errorcode: "invalidsesskey", message: "x" } }])],
    ["a service that requires sign-in", JSON.stringify({ error: "Debe iniciar sesión", errorcode: "servicerequireslogin" })],
    ["a sign-in requirement", JSON.stringify({ error: "x", errorcode: "requireloginerror" })],
  ];
  for (const [name, raw] of authErrors) {
    it(`throws AuthenticationError for ${name}`, () => {
      assert.throws(() => parser.parse(raw), AuthenticationError);
    });
  }
});
