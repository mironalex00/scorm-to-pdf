import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";
import { PlatformError } from "../../../src/domain/errors.ts";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { es } from "../../../src/i18n/es.ts";
import { ScormFetcher } from "../../../src/platforms/moodle/ScormFetcher.ts";
import { ENTRY_URL, SCORM_LOAD_JS, SCORM_VIEW_FORM, SCORM_VIEW_LINK } from "../../fixtures/moodle.ts";
import { FakeHttpClient, okResponse, redirectResponse } from "../../support/fakes.ts";
import { makeStack, profile, rejection } from "../../support/moodle.ts";
import type { CourseItem } from "../../../src/domain/catalog.ts";

const M = "https://moodle.example.org/mod/scorm";
const LOAD = `${M}/loadSCO.php`;
const VIEW = `${M}/view.php?id=511`;
const PLAYER = `${M}/player.php?a=7&currentorg=ORG-1&scoid=9`;
const ENTRY_HTML = "<html>deck</html>";
const view: CourseItem = { id: "511", kind: "scorm", name: "Curs 5", url: VIEW, sectionNumber: 1 };

function make(http: FakeHttpClient) {
  const stack = makeStack(http);
  return { fetcher: new ScormFetcher({ session: stack.session, profile, tracer: stack.tracer, messages: es, html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }) }), ...stack };
}
const slides = { kind: "slides", entryUrl: new URL(ENTRY_URL), html: ENTRY_HTML };

describe("ScormFetcher · lanzamiento", () => {
  it("con una URL player.php usa sus parámetros tal cual y sigue la redirección de loadSCO hasta el contenido", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=normal&attempt=2`, redirectResponse(ENTRY_URL, 302))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    const { fetcher, events } = make(http);
    assert.deepEqual(await fetcher.fetch({ ...view, url: `${PLAYER}&mode=normal&attempt=2` }), slides);
    assert.ok(events().some((e) => e.scope === "moodle.scorm" && e.name === "launch.params" && e.data?.scoid === "9"));
  });

  it("aplica modo vacío e intento 1 cuando la URL no los indica", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(ENTRY_HTML));
    // 200 sin ser contenido: se busca la referencia en el cuerpo
    http.on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(SCORM_LOAD_JS)).on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch({ ...view, url: PLAYER }), slides);
  });

  it("desde view.php lee el formulario de entrada y usa el id del módulo cuando no hay parámetro a", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(SCORM_VIEW_FORM))
      .on(`${LOAD}?id=511&scoid=6&currentorg=ORG-1&mode=normal&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("desde view.php que redirige a player.php toma los parámetros de la URL final", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, redirectResponse(PLAYER))
      .on(PLAYER, okResponse("<html>player</html>"))
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("desde view.php con un enlace a player.php decodifica los &amp; y lo usa", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(SCORM_VIEW_LINK))
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("si loadSCO devuelve una página que menciona el contenido, descarga ese documento", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(SCORM_LOAD_JS))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch({ ...view, url: PLAYER }), slides);
  });
});

describe("ScormFetcher · errores diagnosticables", () => {
  it("loadSCO sin referencia al contenido: error con título y captura", async () => {
    const http = new FakeHttpClient().on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse("<title>Rara</title>"));
    const error = await rejection(make(http).fetcher.fetch({ ...view, url: PLAYER }));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /«Curs 5».*Rara/);
  });

  it("view.php sin ningún dato de lanzamiento", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse("<html><title>Vacía</title></html>"));
    const error = await rejection(make(http).fetcher.fetch(view));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /lanzamiento.*Vacía.*player\.php: 0/);
  });

  it("una URL player.php sin scoid", async () => {
    const error = await rejection(make(new FakeHttpClient()).fetcher.fetch({ ...view, url: `${M}/player.php?a=7` }));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /lanzamiento/);
  });

  it("un input del formulario sin atributo value cuenta como cadena vacía", async () => {
    const form = `<form action="${M}/player.php"><input name="scoid" value="6"><input name="mode"></form>`;
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(form))
      .on(`${LOAD}?id=511&scoid=6&currentorg=&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("un formulario sin identificador de módulo ni parámetro a cae al id del ítem", async () => {
    const form = `<form action="${M}/player.php"><input name="scoid" value="6"></form>`;
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(form))
      .on(`${LOAD}?id=511&scoid=6&currentorg=&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });
});
