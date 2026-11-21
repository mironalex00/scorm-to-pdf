import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CatalogService } from "../../src/application/CatalogService.ts";
import { CourseResolver } from "../../src/application/CourseResolver.ts";
import { DiagnoseCommand } from "../../src/commands/DiagnoseCommand.ts";
import { ItemsCommand } from "../../src/commands/ItemsCommand.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseContents, CourseItem } from "../../src/domain/catalog.ts";
import { en } from "../../src/i18n/en.ts";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import { MemoryLogger } from "../support/fakes.ts";

const item = (id: string, kind: "resource" | "scorm", name: string, sectionNumber = 1): CourseItem => ({ id, kind, name, url: "u", sectionNumber });

function make() {
  const platform = new FakePlatform();
  platform.courses = [{ id: "1", name: "Alfa" }, { id: "2", name: "Beta" }];
  const catalog = new CatalogService({ platform, store: new CompressedStore({ redactor: new Redactor() }), locale: "en", tracer: new NullTracer() });
  const logger = new MemoryLogger();
  return { platform, catalog, logger };
}

describe("ItemsCommand", () => {
  it("labels an untitled section with no downloadable items", async () => {
    const { platform, catalog, logger } = make();
    platform.contents["1"] = { sections: [{ number: 2, title: "" }], items: [] };
    const command = new ItemsCommand({ catalog, resolver: new CourseResolver({ catalog, messages: en }), logger, messages: en, query: "alfa", json: false });
    assert.equal(await command.run(), 0);
    assert.deepEqual(logger.results, ["Section 2", "  (no downloadable materials)"]);
  });
});

describe("DiagnoseCommand", () => {
  function diagnose(parts: ReturnType<typeof make>) {
    return new DiagnoseCommand({ platform: parts.platform, catalog: parts.catalog, logger: parts.logger, messages: en, tracer: new NullTracer() });
  }

  it("reports a missing course and returns exit status 1", async () => {
    const parts = make();
    parts.platform.courses = [];
    assert.equal(await diagnose(parts).run(), 1);
    const out = parts.logger.results.join("\n");
    assert.match(out, /OK  List courses: Courses found: 0/);
    assert.match(out, /FAIL  Read course contents: nothing available to check/);
    assert.match(out, /OK  Resolve a resource: nothing available to check/);
    assert.match(out, /OK  Resolve a SCORM: nothing available to check/);
    assert.doesNotMatch(out, /Full trace saved to/);
  });

  it("succeeds when the courses have no sample resources or SCORM", async () => {
    const parts = make();
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [] }, "2": { sections: [], items: [] } };
    assert.equal(await diagnose(parts).run(), 0);
    assert.deepEqual(parts.platform.calls.fetchItem, []);
  });

  it("reports zero file bytes when a resource resolves to a slide deck", async () => {
    const parts = make();
    const resource = item("7", "resource", "Visor");
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [resource] }, "2": { sections: [], items: [] } };
    parts.platform.fetched["7"] = { kind: "slides", entryUrl: new URL("https://x/"), html: "" };
    assert.equal(await diagnose(parts).run(), 0);
    assert.match(parts.logger.results.join("\n"), /"Visor" \(0 bytes\)/);
  });

  it("reports a failed step and proceeds with the remaining checks", async () => {
    const parts = make();
    parts.platform.contents = { "1": new DownloadError("page could not be loaded"), "2": new DownloadError("page could not be loaded") };
    assert.equal(await diagnose(parts).run(), 1);
    const out = parts.logger.results.join("\n");
    assert.match(out, /FAIL  Read course contents: page could not be loaded/);
    assert.match(out, /OK  Resolve a resource: nothing available to check/);
  });

  it("traces a sample lookup failure and continues the diagnosis", async () => {
    const parts = make();
    const scorm = item("9", "scorm", "Curso");
    const contents: CourseContents = { sections: [{ number: 1, title: "S" }], items: [scorm] };
    parts.platform.contents = { "1": contents, "2": new DownloadError("could not read sample") };
    parts.platform.fetched["9"] = { kind: "slides", entryUrl: new URL("https://x/"), html: "" };
    assert.equal(await diagnose(parts).run(), 0);
    assert.match(parts.logger.results.join("\n"), /OK  Resolve a SCORM: "Curso"/);
  });

  it("stops after a session failure and returns exit status 3", async () => {
    const parts = make();
    parts.platform.contents = { "1": { sections: [{ number: 1, title: "S" }], items: [item("7", "resource", "R")] }, "2": { sections: [], items: [] } };
    parts.platform.fetched["7"] = new AuthenticationError("sesión");
    assert.equal(await diagnose(parts).run(), 3);
    assert.ok(!parts.logger.results.join("\n").includes("Resolve a SCORM"));
  });
});
