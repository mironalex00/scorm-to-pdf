import { describe, it } from "node:test";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { es } from "../../src/i18n/es.ts";
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

/** Registra 404 para las revisiones 0..max y sustituye las indicadas por su respuesta. */
function setup(overrides: Record<number, HttpResponse>, max = 12, entry = "index.html"): Setup {
  const http = new FakeHttpClient();
  for (let revision = 0; revision <= max; revision += 1) {
    http.on(entryUrl(revision, 10067, entry), overrides[revision] ?? statusResponse(404));
  }
  const logger = new MemoryLogger();
  const session = new MoodleSession({ messages: es, tracer: new NullTracer(), http, cookie: SessionCookie.parse("abc", es), baseUrl: BASE });
  return { http, logger, locator: new ScormLocator({ messages: es, session, logger, maxRevision: max, probeBatchSize: 3 }) };
}

const request = { baseUrl: BASE, scormId: 10067, entry: "index.html", revision: undefined };

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new assert.AssertionError({ message: "se esperaba un rechazo" });
}

describe("ScormLocator · revisión automática", () => {
  it("acierta a la primera con la revisión 1 y no sondea más", async () => {
    const { locator, http, logger } = setup({ 1: okResponse("<html>uno</html>") });
    const located = await locator.locate(request);
    assert.deepEqual([located.revision, located.html, located.entryUrl.href], [1, "<html>uno</html>", entryUrl(1)]);
    assert.deepEqual(http.requestedUrls(), [entryUrl(1)]);
    assert.deepEqual(logger.infos, []);
  });

  it("si la 1 no existe, sondea por tandas y devuelve la encontrada", async () => {
    const { locator, http, logger } = setup({ 3: okResponse("tres") });
    const located = await locator.locate(request);
    assert.equal(located.revision, 3);
    assert.deepEqual(http.requestedUrls(), [1, 0, 2, 3].map((revision) => entryUrl(revision)));
    assert.equal(logger.infos.length, 1);
    assert.match(logger.infos[0]!, /revisión/i);
  });

  it("encuentra revisiones en tandas posteriores y no pide más allá de la tanda que acierta", async () => {
    const { locator, http } = setup({ 5: okResponse("cinco") });
    assert.equal((await locator.locate(request)).revision, 5);
    const asked = http.requestedUrls();
    assert.ok(asked.includes(entryUrl(6)));
    assert.ok(!asked.includes(entryUrl(7)));
  });

  it("si varias revisiones de la misma tanda existen, gana la de menor orden de prueba", async () => {
    const { locator } = setup({ 2: okResponse("dos"), 3: okResponse("tres") });
    assert.equal((await locator.locate(request)).revision, 2);
  });

  it("prefiere un acierto a un fallo transitorio dentro de la misma tanda", async () => {
    const { locator } = setup({ 0: statusResponse(500), 2: okResponse("dos") });
    assert.equal((await locator.locate(request)).revision, 2);
  });

  it("un fallo no 404 sin ningún acierto en la tanda se propaga", async () => {
    const { locator } = setup({ 2: statusResponse(503) });
    const error = await rejection(locator.locate(request));
    assert.ok(error instanceof DownloadError);
    assert.match(error.message, /503/);
  });

  it("si ninguna revisión existe, informa del rango probado y del ID", async () => {
    const { locator, http } = setup({});
    const error = await rejection(locator.locate(request));
    assert.ok(error instanceof NotFoundError);
    assert.match(error.message, /10067/);
    assert.match(error.message, /0\.\.12/);
    assert.equal(http.requests.length, 13);
  });

  it("un error de sesión en la primera petición corta de inmediato", async () => {
    const { locator, http } = setup({ 1: statusResponse(403) });
    assert.ok((await rejection(locator.locate(request))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });

  it("un error de sesión durante el sondeo se propaga aunque otras peticiones den 404", async () => {
    const { locator } = setup({ 2: statusResponse(401) });
    assert.ok((await rejection(locator.locate(request))) instanceof AuthenticationError);
  });
});

describe("ScormLocator · revisión explícita y rutas", () => {
  it("con revisión explícita pide solo esa, incluida la 0", async () => {
    const { locator, http } = setup({ 0: okResponse("cero") });
    const located = await locator.locate({ ...request, revision: 0 });
    assert.equal(located.revision, 0);
    assert.deepEqual(http.requestedUrls(), [entryUrl(0)]);
  });

  it("con revisión explícita inexistente falla sin sondear y sugiere quitar la opción", async () => {
    const { locator, http } = setup({});
    const error = await rejection(locator.locate({ ...request, revision: 4 }));
    assert.ok(error instanceof NotFoundError);
    assert.match(error.message, /--revision/);
    assert.equal(http.requests.length, 1);
  });

  it("una revisión explícita con un error distinto de 404 se propaga tal cual", async () => {
    const { locator } = setup({ 4: statusResponse(500) });
    assert.ok((await rejection(locator.locate({ ...request, revision: 4 }))) instanceof DownloadError);
  });

  it("respeta el prefijo de instalación y las entradas en subcarpetas", async () => {
    const { locator } = setup({ 1: okResponse("ok") }, 12, "deck/start.html");
    const located = await locator.locate({ ...request, entry: "deck/start.html" });
    assert.equal(located.entryUrl.href, entryUrl(1, 10067, "deck/start.html"));
  });
});
