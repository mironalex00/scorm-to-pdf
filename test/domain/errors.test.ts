import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AppError,
  AuthenticationError,
  DownloadError,
  NotFoundError,
  OutputError,
  ScormFormatError,
  UsageError,
  errorMessage,
} from "../../src/domain/errors.ts";

describe("domain errors", () => {
  const cases = [
    { make: () => new UsageError("uso"), exitCode: 2, message: "uso" },
    { make: () => new AuthenticationError("sesión"), exitCode: 3, message: "sesión" },
    { make: () => new NotFoundError("no existe"), exitCode: 1, message: "no existe" },
    { make: () => new ScormFormatError("formato"), exitCode: 1, message: "formato" },
    { make: () => new DownloadError("red"), exitCode: 1, message: "red" },
    { make: () => new OutputError("disco"), exitCode: 1, message: "disco" },
  ];

  for (const { make, exitCode, message } of cases) {
    const error = make();
    it(`gives ${error.constructor.name} exit code ${exitCode} and preserves its name and message`, () => {
      assert.ok(error instanceof AppError);
      assert.ok(error instanceof Error);
      assert.equal(error.exitCode, exitCode);
      assert.equal(error.name, error.constructor.name);
      assert.equal(error.message, message);
    });
  }

  it("makes DownloadError retryable only when requested", () => {
    assert.equal(new DownloadError("x").retryable, false);
    assert.equal(new DownloadError("x", { retryable: true }).retryable, true);
  });

  it("preserves the original cause", () => {
    const cause = new TypeError("fetch failed");
    const error = new DownloadError("red", { retryable: true, cause });
    assert.equal(error.cause, cause);
  });

  describe("errorMessage", () => {
    it("returns an Error's message", () => {
      assert.equal(errorMessage(new TypeError("boom")), "boom");
    });

    it("converts other thrown values to text", () => {
      assert.equal(errorMessage("plain text"), "plain text");
      assert.equal(errorMessage(42), "42");
      assert.equal(errorMessage(undefined), "undefined");
    });
  });
});
