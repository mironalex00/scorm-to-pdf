import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchReport } from "../../src/application/BatchDownloader.ts";
import type { ItemOutcome } from "../../src/application/ItemDownloader.ts";
import { ReportPrinter } from "../../src/application/ReportPrinter.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";
import { en } from "../../src/i18n/en.ts";
import { MemoryLogger } from "../support/fakes.ts";

const item = (name: string): CourseItem => ({ id: name, kind: "resource", name, url: "u", sectionNumber: 1 });

function report(outcomes: ItemOutcome[], aborted = false): BatchReport {
  const count = (status: string) => outcomes.filter((o) => o.status === status).length;
  return { outcomes, downloaded: count("downloaded"), skipped: count("skipped"), failed: count("failed"), aborted };
}

function print(batch: BatchReport) {
  const logger = new MemoryLogger();
  const code = new ReportPrinter({ logger, messages: en }).print(batch);
  return { code, logger };
}

describe("ReportPrinter", () => {
  it("prints output paths and a summary, and returns exit code 0", () => {
    const { code, logger } = print(report([
      { item: item("a"), status: "downloaded", path: "out/1/a.pdf", bytes: 1 },
      { item: item("b"), status: "skipped", path: "out/1/b.pdf" },
    ]));
    assert.equal(code, 0);
    assert.deepEqual(logger.results, ["out/1/a.pdf"]);
    assert.deepEqual(logger.infos, ["Skipped (already exists): out/1/b.pdf", "Downloaded: 1 | Skipped: 1 | Failed: 0"]);
    assert.deepEqual(logger.warnings, []);
  });

  it("reports a download failure and returns exit code 1", () => {
    const { code, logger } = print(report([{ item: item("c"), status: "failed", error: new DownloadError("no network"), authentication: false }]));
    assert.equal(code, 1);
    assert.deepEqual(logger.warnings, ['Failed to download "c": no network']);
  });

  it("reports a batch stopped by an expired session and returns exit code 3", () => {
    const { code, logger } = print(
      report([{ item: item("d"), status: "failed", error: new AuthenticationError("sesión"), authentication: true }], true),
    );
    assert.equal(code, 3);
    assert.match(logger.warnings.join("\n"), /The Moodle session expired/);
  });

  it("returns success for an empty batch", () => {
    assert.equal(print(report([])).code, 0);
  });
});
