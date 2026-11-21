import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader, type DownloadSettings } from "../../src/application/SlideDownloader.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import { FakeHttpClient, MemoryLogger, RecordingDelay, okResponse, statusResponse } from "../support/fakes.ts";
import type { HttpResponse } from "../../src/application/ports.ts";
import type { Slide } from "../../src/application/SlideListParser.ts";

const BASE = new URL("https://moodle.example.org/");
const ENTRY = new URL("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/index.html");
const JPEG = Uint8Array.of(0xff, 0xd8, 0xff, 0xd9);

function slideUrl(n: number): string {
  return `https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/slides/s${n}.jpg`;
}

function slides(count: number): Slide[] {
  return Array.from({ length: count }, (_, index) => ({ src: `slides/s${index + 1}.jpg`, title: `Título ${index + 1}` }));
}

function image(bytes: Uint8Array = JPEG, contentType = "image/jpeg"): HttpResponse {
  return okResponse(bytes, contentType);
}

function make(http: FakeHttpClient, overrides: Partial<DownloadSettings> = {}) {
  const logger = new MemoryLogger();
  const delay = new RecordingDelay();
  const session = new MoodleSession({ messages: en, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", en), baseUrl: BASE });
  const downloader = new SlideDownloader({ messages: en,
    session,
    logger,
    delay,
    settings: { concurrency: 2, maxImageBytes: 999, retries: 2, backoffMs: 100, ...overrides },
  });
  return { downloader, logger, delay };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "Expected the download to reject" });
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("SlideDownloader successful downloads", () => {
  it("preserves slide order when downloads finish out of order", async () => {
    const http = new FakeHttpClient()
      .on(slideUrl(1), async () => {
        for (let i = 0; i < 5; i += 1) await tick();
        return image(Uint8Array.of(0xff, 0xd8, 1));
      })
      .on(slideUrl(2), image(Uint8Array.of(0xff, 0xd8, 2)))
      .on(slideUrl(3), image(Uint8Array.of(0xff, 0xd8, 3)));
    const { downloader } = make(http, { concurrency: 3 });
    const result = await downloader.download(slides(3), ENTRY);
    assert.deepEqual(result.map((bytes) => bytes[2]), [1, 2, 3]);
  });

  it("resolves relative paths and passes on the response size limit", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image());
    await make(http).downloader.download(slides(1), ENTRY);
    assert.equal(http.requests[0]!.url.href, slideUrl(1));
    assert.equal(http.requests[0]!.maxBytes, 999);
  });

  it("reports progress with the slide title", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image()).on(slideUrl(2), image());
    const { downloader, logger } = make(http, { concurrency: 1 });
    await downloader.download([{ src: "slides/s1.jpg", title: "Uno" }, { src: "slides/s2.jpg", title: "" }], ENTRY);
    assert.deepEqual(logger.updates, [
      { done: 1, total: 2, label: "Uno" },
      { done: 2, total: 2, label: "slide 2" },
    ]);
  });

  it("limits concurrent requests and handles a deck smaller than the worker pool", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const http = new FakeHttpClient();
    for (let n = 1; n <= 5; n += 1) {
      http.on(slideUrl(n), async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await tick();
        inFlight -= 1;
        return image();
      });
    }
    await make(http, { concurrency: 2 }).downloader.download(slides(5), ENTRY);
    assert.equal(maxInFlight, 2);

    const small = new FakeHttpClient().on(slideUrl(1), image());
    assert.equal((await make(small, { concurrency: 8 }).downloader.download(slides(1), ENTRY)).length, 1);
  });

  it("accepts JPEG data without a Content-Type header", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image(JPEG, ""));
    assert.equal((await make(http).downloader.download(slides(1), ENTRY)).length, 1);
  });

  it("accepts a deck at the total byte limit", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image()).on(slideUrl(2), image());
    const { downloader } = make(http, { maxDeckBytes: 2 * JPEG.length });
    assert.deepEqual(await downloader.download(slides(2), ENTRY), [JPEG, JPEG]);
  });
});

describe("SlideDownloader retries", () => {
  it("recovers from transient errors with exponential backoff", async () => {
    let calls = 0;
    const http = new FakeHttpClient().on(slideUrl(1), () => (++calls === 1 ? statusResponse(503) : image()));
    const { downloader, delay, logger } = make(http);
    await downloader.download(slides(1), ENTRY);
    assert.equal(calls, 2);
    assert.deepEqual(delay.waits, [100]);
    assert.match(logger.warnings[0]!, /Título 1.*retry 1\/2.*503/);
  });

  it("reports the original error after exhausting retries", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(500));
    const { downloader, delay } = make(http);
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /Slide 1 \(Título 1\).*500/);
    assert.ok(error.cause instanceof DownloadError);
    assert.equal(http.requests.length, 3);
    assert.deepEqual(delay.waits, [100, 200]);
  });

  it("skips retries for permanent errors", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(404));
    const { downloader, delay } = make(http);
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.match(error.message, /Slide 1.*Resource not found/);
    assert.equal(http.requests.length, 1);
    assert.deepEqual(delay.waits, []);
  });
});

describe("SlideDownloader validation and errors", () => {
  it("stops requesting slides when their total exceeds the deck byte limit", async () => {
    const http = new FakeHttpClient()
      .on(slideUrl(1), image())
      .on(slideUrl(2), image())
      .on(slideUrl(3), image());
    const { downloader, logger } = make(http, { concurrency: 1, maxDeckBytes: JPEG.length });
    const error = await rejection(downloader.download(slides(3), ENTRY));
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.equal(error.message, en.downloader.deckTooLarge({ max: String(JPEG.length) }));
    assert.deepEqual(http.requestedUrls(), [slideUrl(1), slideUrl(2)]);
    assert.equal(logger.updates.length, 1);
  });

  it("propagates authentication errors unchanged", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(403));
    assert.ok((await rejection(make(http).downloader.download(slides(1), ENTRY))) instanceof AuthenticationError);
  });

  it("rejects a non-image response with a session hint", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image(JPEG, "text/html"));
    const error = await rejection(make(http).downloader.download(slides(1), ENTRY));
    assert.match(error.message, /Content-Type.*text\/html.*session/);
  });

  const notJpeg: Array<[string, Uint8Array]> = [
    ["empty response", new Uint8Array()],
    ["PNG header", Uint8Array.of(0x89, 0x50, 0x4e, 0x47)],
    ["one byte of the JPEG signature", Uint8Array.of(0xff)],
  ];
  for (const [name, bytes] of notJpeg) {
    it(`rejects non-JPEG data (${name})`, async () => {
      const http = new FakeHttpClient().on(slideUrl(1), image(bytes));
      assert.match((await rejection(make(http).downloader.download(slides(1), ENTRY))).message, /not a valid JPEG/);
    });
  }

  it("rejects a cross-origin slide URL before making a request", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(make(http).downloader.download([{ src: "https://cdn.evil.net/a.jpg", title: "x" }], ENTRY));
    assert.match(error.message, /Slide 1.*another origin/);
    assert.equal(http.requests.length, 0);
  });

  it("uses the original value in the message when a request throws a string", async () => {
    const throwsString = { get: () => Promise.reject("plain text") };
    const session = new MoodleSession({ messages: en, tracer: new NullTracer(), http: throwsString, cookie: SessionCookie.parse("abc", en), baseUrl: BASE });
    const downloader = new SlideDownloader({ messages: en,
      session,
      logger: new MemoryLogger(),
      delay: new RecordingDelay(),
      settings: { concurrency: 1, maxImageBytes: 999, retries: 0, backoffMs: 1 },
    });
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.equal(error.message, "Slide 1 (Título 1): plain text");
  });

  it("rejects an invalid slide URL", async () => {
    const error = await rejection(make(new FakeHttpClient()).downloader.download([{ src: "http://[::1", title: "" }], ENTRY));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /Slide 1.*Invalid src/);
  });

  it("stops starting downloads after a permanent error", async () => {
    const http = new FakeHttpClient()
      .on(slideUrl(1), image())
      .on(slideUrl(2), statusResponse(400))
      .on(slideUrl(3), image());
    const error = await rejection(make(http, { concurrency: 1 }).downloader.download(slides(3), ENTRY));
    assert.match(error.message, /Slide 2/);
    assert.deepEqual(http.requestedUrls(), [slideUrl(1), slideUrl(2)]);
  });

  it("discards a completed slide after another worker fails", async () => {
    const http = new FakeHttpClient()
      .on(slideUrl(1), async () => {
        await tick();
        return image();
      })
      .on(slideUrl(2), statusResponse(400));
    const { downloader, logger } = make(http);

    await assert.rejects(downloader.download(slides(3), ENTRY), /Slide 2/);

    assert.deepEqual(logger.updates, []);
    assert.deepEqual(http.requestedUrls(), [slideUrl(1), slideUrl(2)]);
  });
});
