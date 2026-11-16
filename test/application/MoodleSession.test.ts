import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { es } from "../../src/i18n/es.ts";
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
  return new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse(SECRET, es), baseUrl: new URL(BASE) });
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "se esperaba un rechazo" });
}

describe("MoodleSession · peticiones", () => {
  it("envía la cookie y devuelve el texto decodificado como UTF-8 con la URL final", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<title>Funcții și Algoritmi</title>"));
    const result = await makeSession(http).getText(PAGE);
    assert.equal(result.text, "<title>Funcții și Algoritmi</title>");
    assert.equal(result.finalUrl.href, PAGE.href);
    assert.equal(http.requests[0]!.headers.Cookie, `MoodleSession=${SECRET}`);
    assert.match(http.requests[0]!.headers["User-Agent"]!, /Mozilla/);
  });

  it("getBytes devuelve el cuerpo y el tipo de contenido, y traslada el límite de tamaño", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(Uint8Array.of(1, 2, 3), "image/jpeg"));
    const result = await makeSession(http).getBytes(PAGE, 1234);
    assert.deepEqual([...result.bytes], [1, 2, 3]);
    assert.equal(result.contentType, "image/jpeg");
    assert.equal(http.requests[0]!.maxBytes, 1234);
  });
});

describe("MoodleSession · redirecciones", () => {
  it("sigue redirecciones del mismo origen conservando la cookie en cada salto", async () => {
    const http = new FakeHttpClient()
      .on(PAGE.href, redirectResponse("/pluginfile.php/7/mod_scorm/content/1/inicio.html", 302))
      .on("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/inicio.html", okResponse("ok"));
    const result = await makeSession(http).getText(PAGE);
    assert.equal(result.finalUrl.pathname, "/pluginfile.php/7/mod_scorm/content/1/inicio.html");
    assert.ok(http.requests.every((request) => request.headers.Cookie === `MoodleSession=${SECRET}`));
  });

  it("nunca contacta con otro dominio al que redirija el servidor", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("https://evil.example.net/steal"));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof DownloadError);
    assert.equal(error.retryable, false);
    assert.match(error.message, /otro dominio.*evil\.example\.net/);
    assert.deepEqual(http.requestedUrls(), [PAGE.href]);
  });

  it("rechaza una URL inicial de otro dominio sin hacer ninguna petición", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(makeSession(http).getBytes(new URL("https://cdn.example.net/a.jpg"), 10));
    assert.ok(error instanceof DownloadError);
    assert.equal(http.requests.length, 0);
  });

  it("la redirección a la página de login es un error de sesión y no se pide esa página", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("https://moodle.example.org/login/index.php"));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof AuthenticationError);
    assert.match(error.message, /Cookies enviadas \(solo nombres\): MoodleSession/);
    assert.ok(!error.message.includes(SECRET));
    assert.deepEqual(http.requestedUrls(), [PAGE.href]);
  });

  it("la redirección al proveedor de login interno (/auth/oidc/) también es un error de sesión", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse("/auth/oidc/?source=loginpage"));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("falla si hay demasiadas redirecciones encadenadas", async () => {
    const http = new FakeHttpClient().on(PAGE.href, redirectResponse(PAGE.href, 307));
    const error = await rejection(makeSession(http).getText(PAGE));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /demasiadas redirecciones/i);
    assert.equal(http.requests.length, 6);
  });

  it("falla si la redirección no trae Location o trae uno inválido", async () => {
    const sinLocation = new FakeHttpClient().on(PAGE.href, redirectResponse(undefined));
    assert.match((await rejection(makeSession(sinLocation).getText(PAGE))).message, /sin cabecera Location/);

    const invalida = new FakeHttpClient().on(PAGE.href, redirectResponse("http://[::1"));
    assert.match((await rejection(makeSession(invalida).getText(PAGE))).message, /Location no válido/);
  });
});

describe("MoodleSession · estados HTTP", () => {
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
    it(`HTTP ${status} se clasifica correctamente`, async () => {
      const http = new FakeHttpClient().on(PAGE.href, statusResponse(status));
      const error = await rejection(makeSession(http).getBytes(PAGE, 10));
      check(error);
      assert.ok(error.message.includes(PAGE.pathname) || error instanceof AuthenticationError);
    });
  }
});

describe("MoodleSession · detección de login con respuesta 200", () => {
  it("detecta la clase notloggedin del cuerpo", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<body class='path-login notloggedin'>"));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
  });

  it("detecta el identificador page-login-index", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(`<body id="page-login-index">`));
    assert.ok((await rejection(makeSession(http).getText(PAGE))) instanceof AuthenticationError);
  });
});

describe("MoodleSession · POST JSON", () => {
  const SERVICE = new URL("https://moodle.example.org/lib/ajax/service.php?info=x");

  it("envía el cuerpo JSON con cabeceras de petición AJAX y devuelve texto y estado", async () => {
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

  it("no sigue redirecciones: la del login es un error de sesión", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, redirectResponse("/login/index.php"));
    assert.ok((await rejection(makeSession(http).postJson(SERVICE, {}, "r"))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("una redirección cualquiera a otra página en un POST es un error", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, redirectResponse("/otra"));
    const error = await rejection(makeSession(http).postJson(SERVICE, {}, "r"));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /POST/);
  });

  it("bloquea un destino de otro dominio sin hacer peticiones", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(makeSession(http).postJson(new URL("https://evil.example.net/x"), {}, "r"));
    assert.ok(error instanceof DownloadError);
    assert.equal(http.requests.length, 0);
  });

  it("clasifica los estados HTTP igual que en GET", async () => {
    const http = new FakeHttpClient().on(SERVICE.href, statusResponse(404));
    assert.ok((await rejection(makeSession(http).postJson(SERVICE, {}, "r"))) instanceof NotFoundError);
  });
});

describe("MoodleSession · trazabilidad", () => {
  it("registra cada salto: petición, duración y respuesta con estado, tipo y tamaño", async () => {
    const { tracer, events } = makeRecorder();
    const http = new FakeHttpClient()
      .on(PAGE.href, redirectResponse("/pluginfile.php/7/mod_scorm/content/1/b.html", 302))
      .on("https://moodle.example.org/pluginfile.php/7/mod_scorm/content/1/b.html", okResponse("hola"));
    await new MoodleSession({ messages: es, tracer, http, cookie: SessionCookie.parse(SECRET, es), baseUrl: new URL(BASE) }).getText(PAGE);

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

  it("un fallo de red queda como evento .fail con su causa", async () => {
    const { tracer, events } = makeRecorder();
    const http = { get: () => Promise.reject(new TypeError("fetch failed")) };
    await new MoodleSession({ messages: es, tracer, http, cookie: SessionCookie.parse(SECRET, es), baseUrl: new URL(BASE) })
      .getText(PAGE)
      .catch(() => undefined);
    assert.ok(events().some((e) => e.name === "request.fail" && e.error?.chain[0] === "TypeError: fetch failed"));
  });

  it("avisa en la traza cuando detecta la página de login", async () => {
    const { tracer, events } = makeRecorder();
    const http = new FakeHttpClient().on(PAGE.href, okResponse("<body class='notloggedin'>"));
    await new MoodleSession({ messages: es, tracer, http, cookie: SessionCookie.parse(SECRET, es), baseUrl: new URL(BASE) })
      .getText(PAGE)
      .catch(() => undefined);
    assert.ok(events().some((e) => e.level === "warn" && e.name === "login-page-detected"));
  });

  it("guarda una captura redactada de la página cuando se pide etiqueta y la captura está activa", async () => {
    const { tracer, sink } = makeRecorder({ capture: true });
    tracer.addSecret("Ab3dEf9ZqW");
    const http = new FakeHttpClient().on(PAGE.href, okResponse('{"sesskey":"Ab3dEf9ZqW"} hola'));
    await new MoodleSession({ messages: es, tracer, http, cookie: SessionCookie.parse(SECRET, es), baseUrl: new URL(BASE) })
      .getText(PAGE, "mi-pagina");
    assert.equal(sink.snapshots[0]?.name, "mi-pagina");
    assert.ok(!sink.snapshots[0]!.content.includes("Ab3dEf9ZqW"));
  });

  it("getBytes expone el nombre sugerido en Content-Disposition", async () => {
    const http = new FakeHttpClient().on(PAGE.href, okResponse(Uint8Array.of(1), "application/pdf", 'inline; filename="x.pdf"'));
    assert.equal((await makeSession(http).getBytes(PAGE, 10)).contentDisposition, 'inline; filename="x.pdf"');
  });
});
