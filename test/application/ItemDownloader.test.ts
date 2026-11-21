import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { FileNamer } from "../../src/application/FileNamer.ts";
import { ItemDownloader } from "../../src/application/ItemDownloader.ts";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { SlidesToPdf } from "../../src/application/SlidesToPdf.ts";
import { DownloadError } from "../../src/domain/errors.ts";
import { en } from "../../src/i18n/en.ts";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { PdfBuilder } from "../../src/pdf/PdfBuilder.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import { FakeHttpClient, MemoryFileSink, MemoryLogger, RecordingDelay, okResponse } from "../support/fakes.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";
import type { CourseItem } from "../../src/domain/catalog.ts";

const ROOT = "https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1";
const item = (id: string, kind: "resource" | "scorm", sectionNumber: number): CourseItem => ({ id, kind, name: `Item ${id}`, url: "u", sectionNumber });

function make() {
  const platform = new FakePlatform();
  const sink = new MemoryFileSink();
  const logger = new MemoryLogger();
  const http = new FakeHttpClient()
    .on(`${ROOT}/slides/a.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"));
  const session = new MoodleSession({ messages: en, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", en), baseUrl: new URL("https://moodle.example.org/") });
  const downloader = new ItemDownloader({
    platform,
    sink,
    tracer: new NullTracer(),
    namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }),
    slides: new SlidesToPdf({
      messages: en,
      logger,
      parser: new SlideListParser({ messages: en, maxSlides: 10 }),
      downloader: new SlideDownloader({ messages: en, session, logger, delay: new RecordingDelay(), settings: { concurrency: 1, maxImageBytes: 1_000_000, retries: 0, backoffMs: 1 } }),
      pdfBuilder: new PdfBuilder({ messages: en, pageWidth: 960, pageHeight: 540, inspector: new JpegInspector({ messages: en }) }),
    }),
  });
  return { platform, sink, downloader };
}

describe("ItemDownloader", () => {
  it("writes a direct resource as received under its section folder", async () => {
    const { platform, sink, downloader } = make();
    const bytes = Uint8Array.of(1, 2, 3);
    const path = join("out", "3", "Complementar.pdf");
    platform.fetched["1"] = { kind: "file", bytes, fileName: "origen.pdf", contentType: "application/pdf" };
    const outcome = await downloader.download(item("1", "resource", 3), { destRoot: "out", baseName: "Complementar" });
    assert.deepEqual(outcome, { item: item("1", "resource", 3), status: "downloaded", path, bytes: 3 });
    assert.deepEqual([...sink.files.get(path)!], [1, 2, 3]);
  });

  it("converts SCORM slides and writes a PDF under the item name", async () => {
    const { platform, sink, downloader } = make();
    const path = join("out", "1", "Curs 5.pdf");
    platform.fetched["2"] = { kind: "slides", entryUrl: new URL(`${ROOT}/index.html`), html: buildDeckHtml({ slides: [{ src: "slides/a.jpg" }] }) };
    const outcome = await downloader.download(item("2", "scorm", 1), { destRoot: "out", baseName: "Curs 5" });
    assert.equal(outcome.status, "downloaded");
    assert.equal(outcome.status === "downloaded" && outcome.path, path);
    assert.equal(Buffer.from(sink.files.get(path)!).subarray(0, 4).toString("latin1"), "%PDF");
  });

  it("skips an existing file and preserves its contents", async () => {
    const { platform, sink, downloader } = make();
    const path = join("out", "1", "Hecho.pdf");
    platform.fetched["1"] = { kind: "file", bytes: Uint8Array.of(9), fileName: "a.pdf", contentType: "application/pdf" };
    sink.files.set(path, Uint8Array.of(7));
    const outcome = await downloader.download(item("1", "resource", 1), { destRoot: "out", baseName: "Hecho" });
    assert.deepEqual([outcome.status, [...sink.files.get(path)!]], ["skipped", [7]]);
  });

  it("preserves the other writer's file if it appears after the existence check", async (t) => {
    const { platform, sink, downloader } = make();
    const resource = item("1", "resource", 1);
    const path = join("out", "1", "Apuntes.pdf");
    const otherContent = Uint8Array.of(4, 5, 6);
    platform.fetched["1"] = { kind: "file", bytes: Uint8Array.of(9), fileName: "course.pdf", contentType: "application/pdf" };
    const publish = sink.writeIfAbsent.bind(sink);
    t.mock.method(sink, "writeIfAbsent", async (target: string, content: Uint8Array) => {
      sink.files.set(path, otherContent);
      return publish(target, content);
    });

    const outcome = await downloader.download(resource, { destRoot: "out", baseName: "Apuntes" });

    assert.deepEqual(outcome, { item: resource, status: "skipped", path });
    assert.deepEqual(sink.files.get(path), otherContent);
  });

  it("skips an existing SCORM PDF before fetching the activity", async () => {
    const { platform, sink, downloader } = make();
    const scorm = item("2", "scorm", 1);
    const path = join("out", "1", "Curs 5", "Curs 5.pdf");
    const bytes = Uint8Array.of(7);
    sink.files.set(path, bytes);
    const outcome = await downloader.download(scorm, { destRoot: "out", baseName: "Curs 5", groupByItem: true });
    assert.deepEqual(outcome, { item: scorm, status: "skipped", path });
    assert.deepEqual(platform.calls.fetchItem, []);
    assert.deepEqual(sink.files.get(path), bytes);
  });

  it("passes platform errors to the batch downloader", async () => {
    const { platform, downloader } = make();
    platform.fetched["1"] = new DownloadError("falló");
    await assert.rejects(downloader.download(item("1", "resource", 1), { destRoot: "out", baseName: "X" }), DownloadError);
  });
});
