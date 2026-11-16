import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SourceFileNameResolver } from "../../../src/application/SourceFileNameResolver.ts";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";
import { PlatformError } from "../../../src/domain/errors.ts";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { es } from "../../../src/i18n/es.ts";
import { ResourceFetcher } from "../../../src/platforms/moodle/ResourceFetcher.ts";
import { PDF_URL, resourceViewer } from "../../fixtures/moodle.ts";
import { FakeHttpClient, okResponse, redirectResponse } from "../../support/fakes.ts";
import { makeStack, profile, rejection } from "../../support/moodle.ts";
import type { CourseItem } from "../../../src/domain/catalog.ts";

const VIEW = "https://moodle.example.org/mod/resource/view.php?id=512&redirect=1";
const item: CourseItem = { id: "512", kind: "resource", name: "Exerciții", url: "https://moodle.example.org/mod/resource/view.php?id=512", sectionNumber: 1 };
const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46);

function make(http: FakeHttpClient) {
  const stack = makeStack(http);
  const fetcher = new ResourceFetcher({
    session: stack.session, profile, tracer: stack.tracer, messages: es,
    fileNames: new SourceFileNameResolver(), html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }),
  });
  return { fetcher, ...stack };
}

describe("ResourceFetcher · archivo directo", () => {
  it("pide la vista con redirect=1 y, si acaba en el archivo, lo devuelve con su nombre", async () => {
    const http = new FakeHttpClient().on(VIEW, redirectResponse(PDF_URL)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    const { fetcher, events } = make(http);
    assert.deepEqual(await fetcher.fetch(item), { kind: "file", bytes: pdf, fileName: "Curs 1.pdf", contentType: "application/pdf" });
    assert.deepEqual(http.requestedUrls(), [VIEW, PDF_URL]);
    assert.ok(events().some((e) => e.scope === "moodle.resource" && e.name === "view.fetched"));
  });

  it("prefiere el nombre de Content-Disposition", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(pdf, "application/pdf", 'attachment; filename="Otro nombre.pdf"'));
    assert.equal(((await make(http).fetcher.fetch(item)) as { fileName: string }).fileName, "Otro nombre.pdf");
  });
});

describe("ResourceFetcher · página visor", () => {
  const variants: Array<[string, string]> = [
    ["object#resourceobject", resourceViewer.object],
    ["iframe#resourceobject", resourceViewer.iframe],
    ["enlace a pluginfile", resourceViewer.link],
    ["referencia dentro de un script", resourceViewer.scriptOnly],
  ];
  for (const [name, html] of variants) {
    it(`localiza el archivo mediante ${name} y lo descarga`, async () => {
      const http = new FakeHttpClient()
        .on(VIEW, okResponse(html))
        .on(PDF_URL, okResponse(pdf, "application/pdf"))
        .on(`${PDF_URL}?forcedownload=1`, okResponse(pdf, "application/pdf"));
      const result = await make(http).fetcher.fetch(item);
      assert.equal(result.kind, "file");
      assert.equal(http.requests.length, 2);
    });
  }

  it("ignora enlaces sin href al buscar la referencia al archivo", async () => {
    const html = `<a name="ancla">x</a><a href="${PDF_URL}">archivo</a>`;
    const http = new FakeHttpClient().on(VIEW, okResponse(html)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    assert.equal((await make(http).fetcher.fetch(item)).kind, "file");
  });

  it("resuelve referencias relativas contra la URL final", async () => {
    const html = `<object id="resourceobject" data="/pluginfile.php/55/mod_resource/content/1/Curs%201.pdf"></object>`;
    const http = new FakeHttpClient().on(VIEW, okResponse(html)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    assert.equal((await make(http).fetcher.fetch(item)).kind, "file");
  });

  it("si la página no contiene ninguna referencia falla con el título de la página y guarda una captura", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.none));
    const stack = makeStack(http, { capture: true });
    const fetcher = new ResourceFetcher({ session: stack.session, profile, tracer: stack.tracer, messages: es, fileNames: new SourceFileNameResolver(), html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }) });
    const error = await rejection(fetcher.fetch(item));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /«Exerciții».*Sin archivo/);
    assert.equal(stack.sink.snapshots[0]?.name, "resource-viewer-512");
  });

  it("indica «sin título» cuando la página no tiene título", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.untitled));
    assert.match((await rejection(make(http).fetcher.fetch(item))).message, /sin título/);
  });

  it("falla si la referencia sigue llevando a otra página HTML", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.object)).on(PDF_URL, okResponse("<html>otra</html>"));
    assert.ok((await rejection(make(http).fetcher.fetch(item))) instanceof PlatformError);
  });
});
