import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { MoodleSession } from "../../src/application/MoodleSession.ts";
import { SessionCookie } from "../../src/application/SessionCookie.ts";
import { SlideDownloader } from "../../src/application/SlideDownloader.ts";
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

function make(http: FakeHttpClient, overrides: { concurrency?: number; retries?: number } = {}) {
  const logger = new MemoryLogger();
  const delay = new RecordingDelay();
  const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", es), baseUrl: BASE });
  const downloader = new SlideDownloader({ messages: es,
    session,
    logger,
    delay,
    settings: { concurrency: overrides.concurrency ?? 2, maxImageBytes: 999, retries: overrides.retries ?? 2, backoffMs: 100 },
  });
  return { downloader, logger, delay };
}

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "se esperaba un rechazo" });
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("SlideDownloader · camino feliz", () => {
  it("devuelve las imágenes en el orden del SCORM aunque terminen desordenadas", async () => {
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

  it("resuelve rutas relativas contra el documento de entrada y traslada el límite de tamaño", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image());
    await make(http).downloader.download(slides(1), ENTRY);
    assert.equal(http.requests[0]!.url.href, slideUrl(1));
    assert.equal(http.requests[0]!.maxBytes, 999);
  });

  it("informa del progreso con el título de cada diapositiva", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image()).on(slideUrl(2), image());
    const { downloader, logger } = make(http, { concurrency: 1 });
    await downloader.download([{ src: "slides/s1.jpg", title: "Uno" }, { src: "slides/s2.jpg", title: "" }], ENTRY);
    assert.deepEqual(logger.updates, [
      { done: 1, total: 2, label: "Uno" },
      { done: 2, total: 2, label: "diapositiva 2" },
    ]);
  });

  it("nunca supera el paralelismo configurado y funciona con más hilos que diapositivas", async () => {
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

  it("acepta una respuesta sin Content-Type siempre que sea un JPEG", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image(JPEG, ""));
    assert.equal((await make(http).downloader.download(slides(1), ENTRY)).length, 1);
  });
});

describe("SlideDownloader · reintentos", () => {
  it("reintenta los fallos transitorios con espera exponencial y acaba teniendo éxito", async () => {
    let calls = 0;
    const http = new FakeHttpClient().on(slideUrl(1), () => (++calls === 1 ? statusResponse(503) : image()));
    const { downloader, delay, logger } = make(http);
    await downloader.download(slides(1), ENTRY);
    assert.equal(calls, 2);
    assert.deepEqual(delay.waits, [100]);
    assert.match(logger.warnings[0]!, /Título 1.*reintento 1\/2.*503/);
  });

  it("agota los reintentos y falla con la causa original", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(500));
    const { downloader, delay } = make(http);
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /Diapositiva 1 \(Título 1\).*500/);
    assert.ok(error.cause instanceof DownloadError);
    assert.equal(http.requests.length, 3);
    assert.deepEqual(delay.waits, [100, 200]);
  });

  it("no reintenta los errores permanentes", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(404));
    const { downloader, delay } = make(http);
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.match(error.message, /Diapositiva 1.*No existe/);
    assert.equal(http.requests.length, 1);
    assert.deepEqual(delay.waits, []);
  });
});

describe("SlideDownloader · validaciones y errores", () => {
  it("un error de sesión se propaga sin envolver (código de salida 3)", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), statusResponse(403));
    assert.ok((await rejection(make(http).downloader.download(slides(1), ENTRY))) instanceof AuthenticationError);
  });

  it("rechaza respuestas que no son imágenes y sugiere que la sesión caducó", async () => {
    const http = new FakeHttpClient().on(slideUrl(1), image(JPEG, "text/html"));
    const error = await rejection(make(http).downloader.download(slides(1), ENTRY));
    assert.match(error.message, /Content-Type.*text\/html.*sesión/);
  });

  const notJpeg: Array<[string, Uint8Array]> = [
    ["vacío", new Uint8Array()],
    ["cabecera PNG", Uint8Array.of(0x89, 0x50, 0x4e, 0x47)],
    ["un solo byte válido", Uint8Array.of(0xff)],
  ];
  for (const [name, bytes] of notJpeg) {
    it(`rechaza un recurso que no es JPEG (${name})`, async () => {
      const http = new FakeHttpClient().on(slideUrl(1), image(bytes));
      assert.match((await rejection(make(http).downloader.download(slides(1), ENTRY))).message, /no es un JPEG/);
    });
  }

  it("no contacta con dominios ajenos aunque el SCORM los declare", async () => {
    const http = new FakeHttpClient();
    const error = await rejection(make(http).downloader.download([{ src: "https://cdn.evil.net/a.jpg", title: "x" }], ENTRY));
    assert.match(error.message, /Diapositiva 1.*otro dominio/);
    assert.equal(http.requests.length, 0);
  });

  it("describe con su texto un fallo que no es un Error (en vez de «undefined»)", async () => {
    const lanzaTexto = { get: () => Promise.reject("texto suelto") };
    const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http: lanzaTexto, cookie: SessionCookie.parse("abc", es), baseUrl: BASE });
    const downloader = new SlideDownloader({ messages: es,
      session,
      logger: new MemoryLogger(),
      delay: new RecordingDelay(),
      settings: { concurrency: 1, maxImageBytes: 999, retries: 0, backoffMs: 1 },
    });
    const error = await rejection(downloader.download(slides(1), ENTRY));
    assert.equal(error.message, "Diapositiva 1 (Título 1): texto suelto");
  });

  it("rechaza un src que no es una URL válida", async () => {
    const error = await rejection(make(new FakeHttpClient()).downloader.download([{ src: "http://[::1", title: "" }], ENTRY));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /Diapositiva 1.*src no válido/);
  });

  it("tras el primer fallo no inicia más descargas", async () => {
    const http = new FakeHttpClient()
      .on(slideUrl(1), image())
      .on(slideUrl(2), statusResponse(400))
      .on(slideUrl(3), image());
    const error = await rejection(make(http, { concurrency: 1 }).downloader.download(slides(3), ENTRY));
    assert.match(error.message, /Diapositiva 2/);
    assert.deepEqual(http.requestedUrls(), [slideUrl(1), slideUrl(2)]);
  });
});
