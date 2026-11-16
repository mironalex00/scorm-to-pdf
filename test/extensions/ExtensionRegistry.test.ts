import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../src/extensions/ExtensionRegistry.ts";
import { extension as utcluj } from "../../src/extensions/ro/utcluj/kb/index.ts";
import { UsageError } from "../../src/domain/errors.ts";
import { es } from "../../src/i18n/es.ts";

const registry = new ExtensionRegistry({ extensions: [utcluj], defaultId: "ro.utcluj.kb", messages: es });
const resolve = (spec?: string, baseUrl?: string) =>
  registry.resolve({ spec, baseUrl: baseUrl === undefined ? undefined : new URL(baseUrl) });

describe("ExtensionRegistry", () => {
  it("sin indicaciones usa la extensión por defecto y su URL base", () => {
    const resolved = resolve();
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.href, "https://kb.cunbm.utcluj.ro/");
  });

  it("la extensión de utcluj carga el curso completo por su id", () => {
    assert.deepEqual(utcluj.contentsPaths, ["course/view.php?id={courseId}"]);
  });

  it("elige por identificador estilo paquete", () => {
    assert.equal(resolve("ro.utcluj.kb").extension.id, "ro.utcluj.kb");
  });

  it("un identificador desconocido es un error de uso que lista los disponibles", () => {
    assert.throws(() => resolve("com.otro.app"), (e: unknown) => e instanceof UsageError && /com\.otro\.app/.test(e.message) && /ro\.utcluj\.kb/.test(e.message));
  });

  it("una URL de un host conocido selecciona esa extensión con la URL dada", () => {
    const resolved = resolve("https://kb.cunbm.utcluj.ro/moodle");
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.href, "https://kb.cunbm.utcluj.ro/moodle/");
  });

  it("una URL de un host desconocido usa el adaptador genérico de Moodle", () => {
    const resolved = resolve("https://campus.example.org");
    assert.equal(resolved.extension.id, "org.moodle");
    assert.equal(resolved.baseUrl.href, "https://campus.example.org/");
    assert.deepEqual(resolved.extension.contentsPaths, ["course/view.php?id={courseId}"]);
  });

  it("una URL base sin plataforma elige por host: conocido o genérico", () => {
    assert.equal(resolve(undefined, "https://kb.cunbm.utcluj.ro").extension.id, "ro.utcluj.kb");
    assert.equal(resolve(undefined, "https://campus.example.org").extension.id, "org.moodle");
  });

  it("una URL base explícita sustituye a la de la extensión elegida por id", () => {
    const resolved = resolve("ro.utcluj.kb", "http://127.0.0.1:8080");
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.origin, "http://127.0.0.1:8080");
  });

  it("una URL mal formada en --platform es un error de uso", () => {
    assert.throws(() => resolve("https://"), UsageError);
  });
});
