import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { AuthenticationError, DownloadError, NotFoundError } from "../../src/domain/errors.ts";
import { FakeHttpClient, okResponse, redirectResponse, statusResponse } from "../support/fakes.ts";
import { makeRecorder } from "../support/tracing.ts";

const SECRET = "s3cr3tvalue0123456789";
const BASE = "https://moodle.example.org/";
const PAGE = new URL("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/index.html");

function makeSession(http: FakeHttpClient): MoodleSession {
  return new MoodleSession({ messages: en, tracer: new NullTracer(), http, cookie: SessionCookie.parse(SECRET, en), baseUrl: new URL(BASE) });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "Expected the request to reject" });
}

describe("MoodleSession requests", () => {
  it("sends the cookie and returns decoded UTF-8 text with the final URL", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<title>Funcții și Algoritmi</title>"));
    const result = await makeSession(http).getText(PAGE);
    assert.equal(result.text, "<title>Funcții și Algoritmi</title>");
    assert.equal(result.finalUrl.href, PAGE.href);
    assert.equal(http.requests[0]!.headers.Cookie, `MoodleSession=${SECRET}`);
    assert.match(http.requests[0]!.headers["User-Agent"]!, /Mozilla/);
  });

  it("returns bytes and media type and passes on the size limit", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(Uint8Array.of(1, 2, 3), "image/jpeg"));
    const result = await makeSession(http).getBytes(PAGE, 1234);
    assert.deepEqual([...result.bytes], [1, 2, 3]);
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(http.requests[0]!.maxBytes, 1234);
  });
});

describe("MoodleSession redirects", () => {
  it("sends the cookie on each same-origin redirect", async () => {
    const http = new FakeHttpClient()
      .on(PAGE.href, redirectResponse("/pluginfile.php/7/mod_scorm/content/1/inicio.html", 302))
      .on("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/inicio.html", okResponse("ok"));
    const result = await makeSession(http).getText(PAGE);
    assert.equal(result.finalUrl.pathname, "/pluginfile.php/7/mod_scorm/content/1/inicio.html");
    assert.ok(http.requests.every((request) => request.headers.Cookie === `MoodleSession=${SECRET}`));
  });

  it("refuses a redirect to a different origin", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("https://evil.example.net/steal"));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /another origin.*evil\.example\.net/);
    assert.deepEqual(http.requestedUrls(), [PAGE.href]);
  });

  it("rejects an initial URL from a different origin before making a request", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(makeSession(http).getBytes(new URL("https://cdn.example.net/a.jpg"), 10));
    assert.ok(error instanceof DownloadError);
    assert.equal(http.requests.length, 0);
  });

  it("reports an authentication error without fetching the login page", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("https://moodle.example.org/login/index.php"));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof AuthenticationError);
    assert.match(error.message, /Cookies sent \(names only\): MoodleSession/);
    assert.ok(!error.message.includes(SECRET));
    assert.deepEqual(http.requestedUrls(), [PAGE.href]);
  });

  it("reports an authentication error on an internal identity provider redirect", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("/auth/oidc/?source=loginpage"));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("rejects a redirect chain over the limit", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse(PAGE.href, 307));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /too many redirects/i);
    assert.equal(http.requests.length, 6);
  });

  it("rejects a missing or invalid Location header", async () => {
    const sinLocation = new FakeHttpClient().on(PAGE.href, redirectResponse(undefined));
    assert.match((await rejection(makeSession(sinLocation).getText(PAGE))).message, /has no Location header/);

    const invalida = new FakeHttpClient().on(PAGE.href, redirectResponse("http://[::1"));
    assert.match((await rejection(makeSession(invalida).getText(PAGE))).message, /Invalid redirect location/);
  });
});

describe("MoodleSession HTTP status codes", () => {
  const cases: Array<[number, (error: Error) => void]> = [
    [404, (error) => assert.ok(error instanceof NotFoundError)],
    [401, (error) => assert.ok(error instanceof AuthenticationError)],
    [403, (error) => assert.ok(error instanceof AuthenticationError)],
    [500, (error) => assert.equal((error as DownloadError).retryable, true)],
    [503, (error) => assert.equal((error as DownloadError).retryable, true)],
    [429, (error) => assert.equal((error as DownloadError).retryable, true)],
    [408, (error) => assert.equal((error as DownloadError).retryable, true)],
    [400, (error) => assert.equal((error as DownloadError).retryable, false)],
    [304, (error) => assert.equal((error as DownloadError).retryable, false)],
  ];
  for (const [status, check] of cases) {
    it(`classifies HTTP ${status}`, async () => {
      const http = new FakeHttpClient().on(PAGE.href, statusResponse(status));
      const error = await rejection(makeSession(http).getBytes(PAGE, 10));
      check(error);
      assert.ok(error.message.includes(PAGE.pathname) || error instanceof AuthenticationError);
    });
  }
});

describe("MoodleSession login pages returned with HTTP 200", () => {
  it("detects the notloggedin class", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<body class='path-login notloggedin'>"));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
  });

  it("detects the page-login-index identifier", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(`<body id="page-login-index">`));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
  });
});

describe("MoodleSession JSON requests", () => {
  const SERVICE = new URL("https://moodle.example.org/lib/ajax/service.php?info=x");

  it("sends JSON with AJAX request headers and returns the response text and status", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, okResponse('[{"error":false}]', "application/json"));
    const result = await makeSession(http).postJson(SERVICE, [{ index: 0 }], "https://moodle.example.org/my/courses.php");
    assert.deepEqual(result, { text: '[{"error":false}]', status: 200 });
    const request = http.requests[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.body, '[{"index":0}]');
    assert.equal(request.headers["Content-Type"], "application/json");
    assert.equal(request.headers["X-Requested-With"], "XMLHttpRequest");
    assert.equal(request.headers.Origin, "https://moodle.example.org");
    assert.equal(request.headers.Referer, "https://moodle.example.org/my/courses.php");
    assert.equal(request.headers.Cookie, `MoodleSession=${SECRET}`);
  });

  it("reports an authentication error on a POST redirect to the login page", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, redirectResponse("/login/index.php"));
    assert.ok((await rejection(makeSession(http).postJson(SERVICE, {}, "r"))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("rejects a POST redirect to a different page", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, redirectResponse("/otra"));
    const error = await rejection(makeSession(http).postJson(SERVICE, {}, "r"));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /POST/);
  });

  it("rejects a cross-origin POST target before making a request", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(makeSession(http).postJson(new URL("https://evil.example.net/x"), {}, "r"));
    assert.ok(error instanceof DownloadError);
    assert.equal(http.requests.length, 0);
  });

  it("classifies HTTP status codes the same way for GET and POST", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, statusResponse(404));
    assert.ok((await rejection(makeSession(http).postJson(SERVICE, {}, "r"))) instanceof NotFoundError);
  });
});

describe("MoodleSession tracing", () => {
  it("records the request, duration, response status, media type, and size for each hop", async () => {
    const { tracer, events } = makeRecorder();
    const http = new FakeHttpClient()
      .on(PAGE.href, redirectResponse("/pluginfile.php/7/mod_scorm/content/1/b.html", 302))
      .on("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/b.html", okResponse("hola"));
    await new MoodleSession({ messages: en, tracer, http, cookie: SessionCookie.parse(SECRET, en), baseUrl: new URL(BASE) }).getText(PAGE);

    const names = events().map((e) => `${e.scope}:${e.name}`);
    assert.deepEqual(names, [
      "moodle.http:request.start", "moodle.http:request.end", "moodle.http:response",
      "moodle.http:request.start", "moodle.http:request.end", "moodle.http:response",
    ]);
    const responses = events().filter((e) => e.name === "response");
    assert.deepEqual(responses.map((e) => e.data?.status), [302, 200]);
    assert.deepEqual(responses.map((e) => e.data?.hop), [0, 1]);
    assert.equal(responses[0]!.data?.location, "/pluginfile.php/7/mod_scorm/content/1/b.html");
    assert.equal(responses[1]!.data?.bytes, 4);
    assert.equal(events()[0]!.data?.method, "GET");
  });

  it("records a network failure and its cause", async () => {
    const { tracer, events } = makeRecorder();
    const http = { get: () => Promise.reject(new TypeError("fetch failed")) };
    await new MoodleSession({ messages: en, tracer, http, cookie: SessionCookie.parse(SECRET, en), baseUrl: new URL(BASE) })
      .getText(PAGE)
      .catch(() => undefined);
    assert.ok(events().some((e) => e.name === "request.fail" && e.error?.chain[0] === "TypeError: fetch failed"));
  });

  it("records a warning when it detects a login page", async () => {
    const { tracer, events } = makeRecorder();
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<body class='notloggedin'>"));
    await new MoodleSession({ messages: en, tracer, http, cookie: SessionCookie.parse(SECRET, en), baseUrl: new URL(BASE) })
      .getText(PAGE)
      .catch(() => undefined);
    assert.ok(events().some((e) => e.level === "warn" && e.name === "login-page-detected"));
  });

  it("saves a redacted snapshot when capture is enabled and a label is provided", async () => {
    const { tracer, sink } = makeRecorder({ capture: true });
    tracer.addSecret("Ab3dEf9ZqW");
    const http = new FakeHttpClient().on(PAGE.href, okResponse('{"sesskey":"Ab3dEf9ZqW"} hola'));
    await new MoodleSession({ messages: en, tracer, http, cookie: SessionCookie.parse(SECRET, en), baseUrl: new URL(BASE) })
      .getText(PAGE, "mi-pagina");
    assert.equal(sink.snapshots[0]?.name, "mi-pagina");
    assert.ok(!sink.snapshots[0]!.content.includes("Ab3dEf9ZqW"));
  });

  it("returns the suggested filename from Content-Disposition", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(Uint8Array.of(1), "application/pdf", 'inline; filename="x.pdf"'));
    assert.equal((await makeSession(http).getBytes(PAGE, 10)).contentDisposition, 'inline; filename="x.pdf"');
  });
});
