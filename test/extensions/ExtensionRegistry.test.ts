import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ExtensionRegistry } from "../../src/extensions/ExtensionRegistry.ts";
import { extension as utcluj } from "../../src/extensions/ro/utcluj/kb/index.ts";
import { UsageError } from "../../src/domain/errors.ts";
import { en } from "../../src/i18n/en.ts";

const registry = new ExtensionRegistry({ extensions: [utcluj], defaultId: "ro.utcluj.kb", messages: en });
const resolve = (spec?: string, baseUrl?: string) =>
  registry.resolve({ spec, baseUrl: baseUrl === undefined ? undefined : new URL(baseUrl) });

describe("ExtensionRegistry", () => {
  it("uses the default extension and base URL when no options are given", () => {
    const resolved = resolve();
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.href, "https://kb.cunbm.utcluj.ro/");
  });

  it("loads the full course by ID in the UTCluj extension", () => {
    assert.deepEqual(utcluj.contentsPaths, ["course/view.php?id={courseId}"]);
  });

  it("selects an extension by its package ID", () => {
    assert.equal(resolve("ro.utcluj.kb").extension.id, "ro.utcluj.kb");
  });

  it("lists available extension IDs when an unknown ID is given", () => {
    assert.throws(() => resolve("com.otro.app"), (e: unknown) => e instanceof UsageError && /com\.otro\.app/.test(e.message) && /ro\.utcluj\.kb/.test(e.message));
  });

  it("selects the extension for a known host and keeps the supplied installation path", () => {
    const resolved = resolve("https://kb.cunbm.utcluj.ro/moodle");
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.href, "https://kb.cunbm.utcluj.ro/moodle/");
  });

  it("uses the generic Moodle adapter for an unknown host", () => {
    const resolved = resolve("https://campus.example.org");
    assert.equal(resolved.extension.id, "org.moodle");
    assert.equal(resolved.baseUrl.href, "https://campus.example.org/");
    assert.deepEqual(resolved.extension.contentsPaths, ["course/view.php?id={courseId}"]);
  });

  it("selects the adapter by host when only a base URL is given", () => {
    assert.equal(resolve(undefined, "https://kb.cunbm.utcluj.ro").extension.id, "ro.utcluj.kb");
    assert.equal(resolve(undefined, "https://campus.example.org").extension.id, "org.moodle");
  });

  it("lets an explicit base URL override the selected extension's URL", () => {
    const resolved = resolve("ro.utcluj.kb", "http://127.0.0.1:8080");
    assert.equal(resolved.extension.id, "ro.utcluj.kb");
    assert.equal(resolved.baseUrl.origin, "http://127.0.0.1:8080");
  });

  it("rejects a malformed platform URL", () => {
    assert.throws(() => resolve("https://"), UsageError);
  });

  it("requires HTTPS for platform URLs outside the loopback hosts", () => {
    assert.throws(() => resolve("http://campus.example.org"), { name: "UsageError", message: /--platform.*https/i });
    assert.equal(resolve("http://[::1]:8080/moodle").baseUrl.href, "http://[::1]:8080/moodle/");
  });
});
