import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { ConvertScormToPdf } from "../../src/application/ConvertScormToPdf.ts";
import type { ConversionRequest } from "../../src/application/ConvertScormToPdf.ts";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { OutputNamer } from "../../src/application/OutputNamer.ts";
import { SlidesToPdf } from "../../src/application/SlidesToPdf.ts";
import { ScormLocator } from "../../src/application/ScormLocator.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { AuthenticationError, DownloadError, ScormFormatError } from "../../src/domain/errors.ts";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { PdfBuilder } from "../../src/pdf/PdfBuilder.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";
import { FakeHttpClient, MemoryFileSink, MemoryLogger, RecordingDelay, okResponse, redirectResponse, statusResponse } from "../support/fakes.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const BASE = new URL("https://moodle.example.org/");
const ROOT = "https://moodle.example.org/pluginfile.php/10067/mod_scorm/content/1";

function build() {
  const http = new FakeHttpClient();
  const sink = new MemoryFileSink();
  const logger = new MemoryLogger();
  const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", es), baseUrl: BASE });
  const useCase = new ConvertScormToPdf({
    messages: es,
    locator: new ScormLocator({ messages: es, session, logger, maxRevision: 4, probeBatchSize: 2 }),
    slides: new SlidesToPdf({
      messages: es,
      logger,
      parser: new SlideListParser({ messages: es, maxSlides: 10 }),
      downloader: new SlideDownloader({
        messages: es,
        session,
        logger,
        delay: new RecordingDelay(),
        settings: { concurrency: 2, maxImageBytes: 1_000_000, retries: 0, backoffMs: 1 },
      }),
      pdfBuilder: new PdfBuilder({ messages: es, pageWidth: 960, pageHeight: 540, inspector: new JpegInspector({ messages: es }) }),
    }),
    namer: new OutputNamer({ maxStemLength: 40 }),
    sink,
    logger,
  });
  return { http, sink, logger, useCase };
}

function serveDeck(http: FakeHttpClient, title: string | undefined): void {
  http
    .on(
      `${ROOT}/index.html`,
      okResponse(buildDeckHtml({ title, slides: [{ src: "slides/a.jpg", title: "A" }, { src: "slides/b.jpg", title: "B" }] })),
    )
    .on(`${ROOT}/slides/a.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"))
    .on(`${ROOT}/slides/b.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"));
}

const request: ConversionRequest = {
  baseUrl: BASE,
  scormId: 10067,
  entry: "index.html",
  revision: undefined,
  outPath: undefined,
  outDir: ".",
};

describe("ConvertScormToPdf", () => {
  it("con solo el ID descarga, genera el PDF y lo nombra según el título del curso", async () => {
    const { http, sink, useCase } = build();
    serveDeck(http, "AFSD · Curs 5. Funcții și descompunerea problemelor");

    const report = await useCase.execute(request);

    assert.equal(report.outputPath, "AFSD-Curs-5.pdf");
    assert.deepEqual([report.pages, report.revision, report.title], [2, 1, "AFSD · Curs 5. Funcții și descompunerea problemelor"]);
    const pdf = sink.files.get("AFSD-Curs-5.pdf")!;
    assert.equal(report.bytes, pdf.length);
    assert.equal(Buffer.from(pdf).subarray(0, 8).toString("latin1"), "%PDF-1.4");
  });

  it("deja el PDF en la carpeta pedida cuando se usa --out-dir", async () => {
    const { http, sink, useCase } = build();
    serveDeck(http, "AFSD · Curs 5. X");
    await useCase.execute({ ...request, outDir: "pdfs" });
    assert.deepEqual([...sink.files.keys()], ["pdfs/AFSD-Curs-5.pdf"]);
  });

  it("respeta una ruta de salida explícita", async () => {
    const { http, sink, useCase } = build();
    serveDeck(http, "AFSD · Curs 5. X");
    const report = await useCase.execute({ ...request, outPath: "mio/curso.pdf" });
    assert.equal(report.outputPath, "mio/curso.pdf");
    assert.deepEqual([...sink.files.keys()], ["mio/curso.pdf"]);
  });

  it("sin título en el documento usa scorm-<id>.pdf", async () => {
    const { http, sink, useCase } = build();
    serveDeck(http, undefined);
    const report = await useCase.execute(request);
    assert.equal(report.outputPath, "scorm-10067.pdf");
    assert.equal(report.title, undefined);
    assert.equal(sink.files.size, 1);
  });

  it("informa de cada hito para que el usuario vea qué ocurre", async () => {
    const { http, logger, useCase } = build();
    serveDeck(http, "AFSD · Curs 5. X");
    await useCase.execute(request);
    assert.match(logger.infos[0]!, /SCORM 10067.*revisión 1.*AFSD · Curs 5\. X/);
    assert.match(logger.infos[1]!, /2 diapositivas/);
    assert.match(logger.infos[2]!, /Generando el PDF/);
    assert.equal(logger.updates.length, 2);
  });
});

describe("ConvertScormToPdf · fallos sin dejar archivos a medias", () => {
  it("una sesión inválida aborta antes de escribir nada", async () => {
    const { http, sink, useCase } = build();
    http.on(`${ROOT}/index.html`, redirectResponse("/login/index.php"));
    await assert.rejects(useCase.execute(request), AuthenticationError);
    assert.equal(sink.files.size, 0);
  });

  it("un documento sin SLIDES aborta con error de formato", async () => {
    const { http, sink, useCase } = build();
    http.on(`${ROOT}/index.html`, okResponse("<title>Otra cosa</title>"));
    await assert.rejects(useCase.execute(request), ScormFormatError);
    assert.equal(sink.files.size, 0);
  });

  it("si una diapositiva falla no se escribe un PDF incompleto", async () => {
    const { http, sink, useCase } = build();
    serveDeck(http, "AFSD · Curs 5. X");
    http.on(`${ROOT}/slides/b.jpg`, statusResponse(400));
    await assert.rejects(useCase.execute(request), DownloadError);
    assert.equal(sink.files.size, 0);
  });
});
