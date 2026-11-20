import { after, before, describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { FetchHttpClient } from "../../src/infra/FetchHttpClient.ts";
import { DownloadError } from "../../src/domain/errors.ts";
import { LocalServer } from "../support/LocalServer.ts";

let server: LocalServer;
const client = new FetchHttpClient({ messages: en, timeoutMs: 300 });
const compressedText = "One line of course material.\n".repeat(40);
const compressedBody = gzipSync(compressedText);

before(async () => {
  server = await LocalServer.start((request, response) => {
    switch (request.url) {
      case "/echo":
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(`${request.headers.cookie}|${request.headers["user-agent"]}`);
        break;
      case "/redirect":
        response.writeHead(303, { location: "/echo" });
        response.end();
        break;
      case "/missing":
        response.writeHead(404);
        response.end();
        break;
      case "/post": {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
          response.writeHead(200, { "content-type": "application/json", "content-disposition": 'inline; filename="a.pdf"' });
          response.end(`${request.method}|${request.headers["content-type"]}|${Buffer.concat(chunks).toString()}`);
        });
        break;
      }
      case "/nocontent":
        response.writeHead(204);
        response.end();
        break;
      case "/no-type":
        response.writeHead(200, { "content-type": "" });
        response.end("x");
        break;
      case "/declared-big":
        response.writeHead(200, { "content-length": "5000" });
        response.end(Buffer.alloc(5000));
        break;
      case "/streamed-big":
        response.writeHead(200);
        response.write(Buffer.alloc(600));
        setTimeout(() => response.end(Buffer.alloc(600)), 10);
        break;
      case "/gzip":
        response.writeHead(200, { "content-encoding": "gzip", "content-length": compressedBody.length });
        response.end(compressedBody);
        break;
      case "/hang":
        break;
      default:
        response.writeHead(500);
        response.end();
    }
  });
});
after(() => server.close());

const request = (path: string, maxBytes = 1000) => ({ url: server.url(path), headers: { Cookie: "a=b", "User-Agent": "ua" }, maxBytes });

describe("FetchHttpClient", () => {
  it("sends request headers and returns the status, media type, and body", async () => {
    const response = await client.get(request("/echo"));
    assert.equal(response.status, 200);
    assert.equal(response.contentType, "text/plain");
    assert.equal(response.location, undefined);
    assert.equal(Buffer.from(response.body).toString(), "a=b|ua");
  });

  it("returns the redirect status and Location header without following it", async () => {
    const echoHits = () => server.requests.filter((r) => r.url === "/echo").length;
    const before = echoHits();
    const response = await client.get(request("/redirect"));
    assert.equal(response.status, 303);
    assert.equal(response.location, "/echo");
    assert.equal(echoHits(), before);
  });

  it("returns HTTP errors with an empty response body", async () => {
    const response = await client.get(request("/missing"));
    assert.deepEqual([response.status, response.body.length], [404, 0]);
  });

  it("sends the POST body and returns Content-Disposition", async () => {
    const response = await client.get({
      ...request("/post"),
      method: "POST",
      body: '{"a":1}',
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(Buffer.from(response.body).toString(), 'POST|application/json|{"a":1}');
    assert.equal(response.contentDisposition, 'inline; filename="a.pdf"');
  });

  it("returns undefined when Content-Disposition is absent", async () => {
    assert.equal((await client.get(request("/echo"))).contentDisposition, undefined);
  });

  it("accepts an HTTP 204 response without a body", async () => {
    const response = await client.get(request("/nocontent"));
    assert.deepEqual([response.status, response.body.length], [204, 0]);
  });

  it("uses an empty media type when Content-Type is absent", async () => {
    assert.equal((await client.get(request("/no-type"))).contentType, "");
  });

  it("rejects an oversized Content-Length before reading the body", async () => {
    const error = await client.get(request("/declared-big")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /1000-byte limit/);
  });

  it("stops when a streamed response exceeds the limit", async () => {
    const error = await client.get(request("/streamed-big")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /1000-byte limit/);
  });

  it("uses the decoded body length for a gzip response", async () => {
    const maxBytes = Buffer.byteLength(compressedText);
    assert.ok(compressedBody.length < maxBytes);
    const { body } = await client.get(request("/gzip", maxBytes));
    assert.equal(Buffer.from(body).toString(), compressedText);

    await assert.rejects(
      client.get(request("/gzip", maxBytes - 1)),
      (error: unknown) => error instanceof DownloadError && !error.retryable,
    );
  });

  it("preserves the caller's cancellation reason while a response is open", async () => {
    let started!: () => void;
    const startedResponse = new Promise<void>((resolve) => { started = resolve; });
    const slow = await LocalServer.start((_request, response) => {
      response.writeHead(200);
      response.write("Partial response");
      started();
    });
    try {
      const cancellable = new FetchHttpClient({ messages: en, timeoutMs: 2000 });
      const controller = new AbortController();
      const reason = new Error("Cancelled by caller");
      const rejected = assert.rejects(
        cancellable.get({ url: slow.url("/"), headers: {}, maxBytes: 1000, signal: controller.signal }),
        (error: unknown) => error === reason,
      );
      await Promise.race([startedResponse, rejected]);
      controller.abort(reason);
      await rejected;
    } finally {
      await slow.close();
    }
  });

  it("reports a retryable timeout when the server does not respond", async () => {
    const error = await client.get(request("/hang")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /\/hang/);
  });

  it("reports a retryable connection failure and preserves the cause", async () => {
    const closed = await LocalServer.start(() => {});
    const url = closed.url("/x");
    await closed.close();
    const error = await client.get({ url, headers: {}, maxBytes: 10 }).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, true);
    assert.ok(error.cause instanceof Error);
  });
});
