import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { SlidesToPdf } from "../../src/application/SlidesToPdf.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { es } from "../../src/i18n/es.ts";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { PdfBuilder } from "../../src/pdf/PdfBuilder.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";
import { FakeHttpClient, MemoryLogger, RecordingDelay, okResponse } from "../support/fakes.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const ROOT = "https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1";

function make(http: FakeHttpClient) {
  const logger = new MemoryLogger();
  const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", es), baseUrl: new URL("https://moodle.example.org/") });
  const slides = new SlidesToPdf({
    messages: es,
    logger,
    parser: new SlideListParser({ messages: es, maxSlides: 10 }),
    downloader: new SlideDownloader({ messages: es, session, logger, delay: new RecordingDelay(), settings: { concurrency: 2, maxImageBytes: 1_000_000, retries: 0, backoffMs: 1 } }),
    pdfBuilder: new PdfBuilder({ messages: es, pageWidth: 960, pageHeight: 540, inspector: new JpegInspector({ messages: es }) }),
  });
  return { slides, logger };
}

describe("SlidesToPdf", () => {
  const html = buildDeckHtml({ title: "AFSD · Curs 5", slides: [{ src: "slides/a.jpg", title: "A" }, { src: "slides/b.jpg", title: "B" }] });
  const http = () =>
    new FakeHttpClient()
      .on(`${ROOT}/slides/a.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"))
      .on(`${ROOT}/slides/b.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"));

  it("parse devuelve el mazo con su título", () => {
    const { slides } = make(http());
    const deck = slides.parse(html);
    assert.deepEqual([deck.title, deck.slides.length], ["AFSD · Curs 5", 2]);
  });

  it("render descarga las diapositivas y devuelve un PDF con una página por diapositiva", async () => {
    const { slides, logger } = make(http());
    const rendered = await slides.render(slides.parse(html), new URL(`${ROOT}/index.html`));
    assert.equal(rendered.pages, 2);
    assert.equal(Buffer.from(rendered.pdf).subarray(0, 8).toString("latin1"), "%PDF-1.4");
    assert.match(logger.infos[0]!, /2 diapositivas/);
    assert.match(logger.infos[1]!, /Generando el PDF/);
  });

  it("propaga los errores de formato del mazo", () => {
    assert.throws(() => make(http()).slides.parse("<html></html>"), ScormFormatError);
  });
});
