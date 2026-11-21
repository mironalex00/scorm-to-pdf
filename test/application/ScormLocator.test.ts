import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { ScormLocator } from "../../src/application/ScormLocator.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { AuthenticationError, DownloadError, NotFoundError } from "../../src/domain/errors.ts";
import { FakeHttpClient, MemoryLogger, okResponse, statusResponse } from "../support/fakes.ts";
import type { HttpResponse } from "../../src/application/ports.ts";

const BASE = new URL("https://moodle.example.org/lms/");

function entryUrl(revision: number, scormId = 10067, entry = "index.html"): string {
  return `https://moodle.example.org/lms/pluginfile.php/${scormId}/mod_scorm/content/${revision}/${entry}`;
}

interface Setup {
  locator: ScormLocator;
  http: FakeHttpClient;
  logger: MemoryLogger;
}

/** Registers a 404 for each revision unless the test supplies a response. */
function setup(overrides: Record<number, HttpResponse>, max = 12, entry = "index.html"): Setup {
  const http = new FakeHttpClient();
  for (let revision = 0; revision <= max; revision += 1) {
    http.on(entryUrl(revision, 10067, entry), overrides[revision] ?? statusResponse(404));
  }
  const logger = new MemoryLogger();
  const session = new MoodleSession({ messages: en, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", en), baseUrl: BASE });
  return { http, logger, locator: new ScormLocator({ messages: en, session, logger, maxRevision: max, probeBatchSize: 3 }) };
}

const request = { baseUrl: BASE, scormId: 10067, entry: "index.html", revision: undefined };

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "Expected the request to reject" });
}

describe("ScormLocator automatic revision lookup", () => {
  it("stops after revision 1 when it resolves successfully", async () => {
    const { locator, http, logger } = setup({ 1: okResponse("<html>uno</html>") });
    const located = await locator.locate(request);
    assert.deepEqual([located.revision, located.html, located.entryUrl.href], [1, "<html>uno</html>", entryUrl(1)]);
    assert.deepEqual(http.requestedUrls(), [entryUrl(1)]);
    assert.deepEqual(logger.infos, []);
  });

  it("probes in batches when revision 1 is missing", async () => {
    const { locator, http, logger } = setup({ 3: okResponse("tres") });
    const located = await locator.locate(request);
    assert.equal(located.revision, 3);
    assert.deepEqual(http.requestedUrls(), [1, 0, 2, 3].map((revision) => entryUrl(revision)));
    assert.equal(logger.infos.length, 1);
    assert.match(logger.infos[0]!, /revision/i);
  });

  it("stops after finding a revision in a later batch", async () => {
    const { locator, http } = setup({ 5: okResponse("cinco") });
    assert.equal((await locator.locate(request)).revision, 5);
    const asked = http.requestedUrls();
    assert.ok(asked.includes(entryUrl(6)));
    assert.ok(!asked.includes(entryUrl(7)));
  });

  it("uses the first successful result in probe order", async () => {
    const { locator } = setup({ 2: okResponse("dos"), 3: okResponse("tres") });
    assert.equal((await locator.locate(request)).revision, 2);
  });

  it("prefers a successful result to a transient failure in the same batch", async () => {
    const { locator } = setup({ 0: statusResponse(500), 2: okResponse("dos") });
    assert.equal((await locator.locate(request)).revision, 2);
  });

  it("propagates a non-404 error when no revision in the batch succeeds", async () => {
    const { locator } = setup({ 2: statusResponse(503) });
    const error = await rejection(locator.locate(request));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /503/);
  });

  it("reports the revision range and SCORM ID when no revision exists", async () => {
    const { locator, http } = setup({});
    const error = await rejection(locator.locate(request));
    assert.ok(error instanceof NotFoundError);
    assert.match(error.message, /10067/);
    assert.match(error.message, /0\.\.12/);
    assert.equal(http.requests.length, 13);
  });

  it("stops immediately when the first request fails authentication", async () => {
    const { locator, http } = setup({ 1: statusResponse(403) });
    assert.ok((await rejection(locator.locate(request))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("propagates an authentication error during a batch of missing revisions", async () => {
    const { locator } = setup({ 2: statusResponse(401) });
    assert.ok((await rejection(locator.locate(request))) instanceof AuthenticationError);
  });
});

describe("ScormLocator explicit revisions and entry paths", () => {
  it("requests only the explicit revision, including revision zero", async () => {
    const { locator, http } = setup({ 0: okResponse("cero") });
    const located = await locator.locate({ ...request, revision: 0 });
    assert.equal(located.revision, 0);
    assert.deepEqual(http.requestedUrls(), [entryUrl(0)]);
  });

  it("reports a missing explicit revision without probing and suggests removing the option", async () => {
    const { locator, http } = setup({});
    const error = await rejection(locator.locate({ ...request, revision: 4 }));
    assert.ok(error instanceof NotFoundError);
    assert.match(error.message, /--revision/);
    assert.equal(http.requests.length, 1);
  });

  it("propagates a non-404 error for an explicit revision", async () => {
    const { locator } = setup({ 4: statusResponse(500) });
    assert.ok((await rejection(locator.locate({ ...request, revision: 4 }))) instanceof DownloadError);
  });

  it("supports an installation path prefix and an entry in a subdirectory", async () => {
    const { locator } = setup({ 1: okResponse("ok") }, 12, "deck/start.html");
    const located = await locator.locate({ ...request, entry: "deck/start.html" });
    assert.equal(located.entryUrl.href, entryUrl(1, 10067, "deck/start.html"));
  });
});
