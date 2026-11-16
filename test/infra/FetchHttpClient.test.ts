import { after, before, describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { FetchHttpClient } from "../../src/infra/FetchHttpClient.ts";
import { DownloadError } from "../../src/domain/errors.ts";
import { LocalServer } from "../support/LocalServer.ts";

let server: LocalServer;
const client = new FetchHttpClient({ messages: es, timeoutMs: 300 });

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
  it("devuelve estado, tipo de contenido y cuerpo, y envía las cabeceras indicadas", async () => {
    const response = await client.get(request("/echo"));
    assert.equal(response.status, 200);
    assert.equal(response.contentType, "text/plain");
    assert.equal(response.location, undefined);
    assert.equal(Buffer.from(response.body).toString(), "a=b|ua");
  });

  it("no sigue las redirecciones: las devuelve con su Location", async () => {
    const echoHits = () => server.requests.filter((r) => r.url === "/echo").length;
    const before = echoHits();
    const response = await client.get(request("/redirect"));
    assert.equal(response.status, 303);
    assert.equal(response.location, "/echo");
    assert.equal(echoHits(), before);
  });

  it("devuelve los errores HTTP como respuesta normal, con cuerpo vacío", async () => {
    const response = await client.get(request("/missing"));
    assert.deepEqual([response.status, response.body.length], [404, 0]);
  });

  it("envía el método y el cuerpo de un POST y expone Content-Disposition", async () => {
    const response = await client.get({
      ...request("/post"),
      method: "POST",
      body: '{"a":1}',
      headers: { "Content-Type": "application/json" },
    });
    assert.equal(Buffer.from(response.body).toString(), 'POST|application/json|{"a":1}');
    assert.equal(response.contentDisposition, 'inline; filename="a.pdf"');
  });

  it("sin Content-Disposition devuelve undefined", async () => {
    assert.equal((await client.get(request("/echo"))).contentDisposition, undefined);
  });

  it("acepta respuestas sin cuerpo (204)", async () => {
    const response = await client.get(request("/nocontent"));
    assert.deepEqual([response.status, response.body.length], [204, 0]);
  });

  it("usa cadena vacía cuando no hay Content-Type", async () => {
    assert.equal((await client.get(request("/no-type"))).contentType, "");
  });

  it("rechaza sin descargar cuando Content-Length ya supera el límite", async () => {
    const error = await client.get(request("/declared-big")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /1000 bytes/);
  });

  it("corta una respuesta en streaming que supera el límite sin Content-Length", async () => {
    const error = await client.get(request("/streamed-big")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /1000 bytes/);
  });

  it("un servidor que no responde provoca un fallo reintentable por timeout", async () => {
    const error = await client.get(request("/hang")).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /\/hang/);
  });

  it("un servidor inalcanzable provoca un fallo reintentable y conserva la causa", async () => {
    const closed = await LocalServer.start(() => {});
    const url = closed.url("/x");
    await closed.close();
    const error = await client.get({ url, headers: {}, maxBytes: 10 }).catch((e: unknown) => e);
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, true);
    assert.ok(error.cause instanceof Error);
  });
});
