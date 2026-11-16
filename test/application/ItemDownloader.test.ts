import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileNamer } from "../../src/application/FileNamer.ts";
import { ItemDownloader } from "../../src/application/ItemDownloader.ts";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { SlidesToPdf } from "../../src/application/SlidesToPdf.ts";
import { DownloadError } from "../../src/domain/errors.ts";
import { es } from "../../src/i18n/es.ts";
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
  const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", es), baseUrl: new URL("https://moodle.example.org/") });
  const downloader = new ItemDownloader({
    platform,
    sink,
    tracer: new NullTracer(),
    namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }),
    slides: new SlidesToPdf({
      messages: es,
      logger,
      parser: new SlideListParser({ messages: es, maxSlides: 10 }),
      downloader: new SlideDownloader({ messages: es, session, logger, delay: new RecordingDelay(), settings: { concurrency: 1, maxImageBytes: 1_000_000, retries: 0, backoffMs: 1 } }),
      pdfBuilder: new PdfBuilder({ messages: es, pageWidth: 960, pageHeight: 540, inspector: new JpegInspector({ messages: es }) }),
    }),
  });
  return { platform, sink, downloader };
}

describe("ItemDownloader", () => {
  it("un archivo directo se guarda en <destino>/<sección>/<nombre><ext> tal cual, sin conversión", async () => {
    const { platform, sink, downloader } = make();
    const bytes = Uint8Array.of(1, 2, 3);
    platform.fetched["1"] = { kind: "file", bytes, fileName: "origen.pdf", contentType: "application/pdf" };
    const outcome = await downloader.download(item("1", "resource", 3), { destRoot: "out", baseName: "Complementar" });
    assert.deepEqual(outcome, { item: item("1", "resource", 3), status: "downloaded", path: "out/3/Complementar.pdf", bytes: 3 });
    assert.deepEqual([...sink.files.get("out/3/Complementar.pdf")!], [1, 2, 3]);
  });

  it("un SCORM de diapositivas se convierte en PDF con el flujo actual y se guarda como <nombre>.pdf", async () => {
    const { platform, sink, downloader } = make();
    platform.fetched["2"] = { kind: "slides", entryUrl: new URL(`${ROOT}/index.html`), html: buildDeckHtml({ slides: [{ src: "slides/a.jpg" }] }) };
    const outcome = await downloader.download(item("2", "scorm", 1), { destRoot: "out", baseName: "Curs 5" });
    assert.equal(outcome.status, "downloaded");
    assert.equal(outcome.status === "downloaded" && outcome.path, "out/1/Curs 5.pdf");
    assert.equal(Buffer.from(sink.files.get("out/1/Curs 5.pdf")!).subarray(0, 4).toString("latin1"), "%PDF");
  });

  it("si el archivo ya existe lo omite sin sobrescribirlo", async () => {
    const { platform, sink, downloader } = make();
    platform.fetched["1"] = { kind: "file", bytes: Uint8Array.of(9), fileName: "a.pdf", contentType: "application/pdf" };
    sink.files.set("out/1/Hecho.pdf", Uint8Array.of(7));
    const outcome = await downloader.download(item("1", "resource", 1), { destRoot: "out", baseName: "Hecho" });
    assert.deepEqual([outcome.status, [...sink.files.get("out/1/Hecho.pdf")!]], ["skipped", [7]]);
  });

  it("los errores de la plataforma se propagan para que el lote los registre", async () => {
    const { platform, downloader } = make();
    platform.fetched["1"] = new DownloadError("falló");
    await assert.rejects(downloader.download(item("1", "resource", 1), { destRoot: "out", baseName: "X" }), DownloadError);
  });
});
