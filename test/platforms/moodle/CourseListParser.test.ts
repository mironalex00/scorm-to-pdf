import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CourseListParser } from "../../../src/platforms/moodle/CourseListParser.ts";
import { AuthenticationError, PlatformError } from "../../../src/domain/errors.ts";
import { es } from "../../../src/i18n/es.ts";
import { coursesJson } from "../../fixtures/moodle.ts";

const parser = new CourseListParser({ messages: es });

describe("CourseListParser · respuestas válidas", () => {
  it("extrae id (como texto) y nombre decodificado, e informa de las entradas descartadas", () => {
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

  it("acepta una lista vacía", () => {
    assert.deepEqual(parser.parse(coursesJson([])), { courses: [], skipped: 0 });
  });
});

describe("CourseListParser · errores", () => {
  const platformErrors: Array<[string, string, RegExp]> = [
    ["no es JSON", "<html>", /no es JSON/],
    ["error de servicio con excepción", JSON.stringify([{ error: true, exception: { errorcode: "accessexception", message: "Sin acceso" } }]), /accessexception.*Sin acceso/],
    ["error sin excepción", JSON.stringify([{ error: true }]), /desconocido/],
    ["objeto sin errorcode", "{}", /\{\}/],
    ["array vacío", "[]", /\[\]/],
    ["elemento que no es objeto", "[1]", /number/],
    ["sin data", JSON.stringify([{ error: false }]), /error: boolean/],
    ["courses que no es array", JSON.stringify([{ error: false, data: { courses: "x" } }]), /courses: string/],
    ["error de servicio de nivel superior", JSON.stringify({ error: "Fallo", errorcode: "otracosa" }), /otracosa.*Fallo/],
  ];
  for (const [name, raw, pattern] of platformErrors) {
    it(`PlatformError cuando ${name}`, () => {
      assert.throws(() => parser.parse(raw), (e: unknown) => e instanceof PlatformError && pattern.test(e.message));
    });
  }

  const authErrors: Array<[string, string]> = [
    ["sesskey inválido", JSON.stringify([{ error: true, exception: { errorcode: "invalidsesskey", message: "x" } }])],
    ["servicio que exige login", JSON.stringify({ error: "Debe iniciar sesión", errorcode: "servicerequireslogin" })],
    ["login requerido", JSON.stringify({ error: "x", errorcode: "requireloginerror" })],
  ];
  for (const [name, raw] of authErrors) {
    it(`AuthenticationError cuando ${name}`, () => {
      assert.throws(() => parser.parse(raw), AuthenticationError);
    });
  }
});
