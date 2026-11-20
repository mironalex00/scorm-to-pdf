import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
import { SlideListParser } from "../../src/application/SlideListParser.ts";
import { SlidesToPdf } from "../../src/application/SlidesToPdf.ts";
import { ScormFormatError } from "../../src/domain/errors.ts";
import { en } from "../../src/i18n/en.ts";
import { JpegInspector } from "../../src/pdf/JpegInspector.ts";
import { PdfBuilder } from "../../src/pdf/PdfBuilder.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { buildDeckHtml } from "../support/deckHtml.ts";
import { FakeHttpClient, MemoryLogger, RecordingDelay, okResponse } from "../support/fakes.ts";
import { makeJpeg } from "../support/jpegFixtures.ts";

const ROOT = "https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1";

function make(http: FakeHttpClient) {
  const logger = new MemoryLogger();
  const session = new MoodleSession({ messages: en, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", en), baseUrl: new URL("https://moodle.example.org/") });
  const slides = new SlidesToPdf({
    messages: en,
    logger,
    parser: new SlideListParser({ messages: en, maxSlides: 10 }),
    downloader: new SlideDownloader({ messages: en, session, logger, delay: new RecordingDelay(), settings: { concurrency: 2, maxImageBytes: 1_000_000, retries: 0, backoffMs: 1 } }),
    pdfBuilder: new PdfBuilder({ messages: en, pageWidth: 960, pageHeight: 540, inspector: new JpegInspector({ messages: en }) }),
  });
  return { slides, logger };
}

describe("SlidesToPdf", () => {
  const html = buildDeckHtml({ title: "AFSD · Curs 5", slides: [{ src: "slides/a.jpg", title: "A" }, { src: "slides/b.jpg", title: "B" }] });
  const http = () =>
    new FakeHttpClient()
      .on(`${ROOT}/slides/a.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"))
      .on(`${ROOT}/slides/b.jpg`, okResponse(makeJpeg({ width: 1280, height: 720 }), "image/jpeg"));

  it("parses the deck title and slide list", () => {
    const { slides } = make(http());
    const deck = slides.parse(html);
    assert.deepEqual([deck.title, deck.slides.length], ["AFSD · Curs 5", 2]);
  });

  it("downloads the deck and builds one PDF page per slide", async () => {
    const { slides, logger } = make(http());
    const rendered = await slides.render(slides.parse(html), new URL(`${ROOT}/index.html`));
    assert.equal(rendered.pages, 2);
    assert.equal(Buffer.from(rendered.pdf).subarray(0, 8).toString("latin1"), "%PDF-1.4");
    assert.match(logger.infos[0]!, /2 slides/);
    assert.match(logger.infos[1]!, /Building the PDF/);
  });

  it("propagates deck format errors", () => {
    assert.throws(() => make(http()).slides.parse("<html></html>"), ScormFormatError);
  });
});
