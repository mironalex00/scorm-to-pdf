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

describe("errores del dominio", () => {
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
    it(`${error.constructor.name} sale con código ${exitCode} y conserva nombre y mensaje`, () => {
      assert.ok(error instanceof AppError);
      assert.ok(error instanceof Error);
      assert.equal(error.exitCode, exitCode);
      assert.equal(error.name, error.constructor.name);
      assert.equal(error.message, message);
    });
  }

  it("DownloadError es reintentable solo si se pide explícitamente", () => {
    assert.equal(new DownloadError("x").retryable, false);
    assert.equal(new DownloadError("x", { retryable: true }).retryable, true);
  });

  it("conserva la causa original para depurar", () => {
    const cause = new TypeError("fetch failed");
    const error = new DownloadError("red", { retryable: true, cause });
    assert.equal(error.cause, cause);
  });

  describe("errorMessage", () => {
    it("devuelve el mensaje de un Error", () => {
      assert.equal(errorMessage(new TypeError("boom")), "boom");
    });

    it("convierte en texto cualquier valor lanzado que no sea un Error", () => {
      assert.equal(errorMessage("texto suelto"), "texto suelto");
      assert.equal(errorMessage(42), "42");
      assert.equal(errorMessage(undefined), "undefined");
    });
  });
});
