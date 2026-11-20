import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SourceFileNameResolver } from "../../../src/application/SourceFileNameResolver.ts";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";
import { AuthenticationError, PlatformError } from "../../../src/domain/errors.ts";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { en } from "../../../src/i18n/en.ts";
import { ResourceFetcher } from "../../../src/platforms/moodle/ResourceFetcher.ts";
import { PDF_URL, resourceViewer } from "../../fixtures/moodle.ts";
import { FakeHttpClient, okResponse, redirectResponse } from "../../support/fakes.ts";
import { makeStack, profile, rejection } from "../../support/moodle.ts";
import type { CourseItem } from "../../../src/domain/catalog.ts";

const VIEW = "https://moodle.example.org/mod/resource/view.php?id=512&redirect=1";
const HTML_URL = "https://moodle.example.org/pluginfile.php/55/mod_resource/content/1/handout.html";
const item: CourseItem = { id: "512", kind: "resource", name: "Exerciții", url: "https://moodle.example.org/mod/resource/view.php?id=512", sectionNumber: 1 };
const pdf = Uint8Array.of(0x25, 0x50, 0x44, 0x46);

function make(http: FakeHttpClient) {
  const stack = makeStack(http);
  const fetcher = new ResourceFetcher({
    session: stack.session, profile, tracer: stack.tracer, messages: en,
    fileNames: new SourceFileNameResolver(), html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }),
  });
  return { fetcher, ...stack };
}

describe("ResourceFetcher direct downloads", () => {
  it("requests redirect=1 and returns the redirected file with its filename", async () => {
    const http = new FakeHttpClient().on(VIEW, redirectResponse(PDF_URL)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    const { fetcher, events } = make(http);
    assert.deepEqual(await fetcher.fetch(item), { kind: "file", bytes: pdf, fileName: "Curs 1.pdf", contentType: "application/pdf" });
    assert.deepEqual(http.requestedUrls(), [VIEW, PDF_URL]);
    assert.ok(events().some((e) => e.scope === "moodle.resource" && e.name === "view.fetched"));
  });

  it("prefers the filename from Content-Disposition", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(pdf, "application/pdf", 'attachment; filename="Otro nombre.pdf"'));
    assert.equal(((await make(http).fetcher.fetch(item)) as { fileName: string }).fileName, "Otro nombre.pdf");
  });

  it("returns an HTML attachment as file bytes", async () => {
    const html = new TextEncoder().encode("<!doctype html><title>Handout</title><p>Course notes</p>");
    const http = new FakeHttpClient().on(VIEW, okResponse(html, "text/html", 'attachment; filename="handout.html"'));
    assert.deepEqual(await make(http).fetcher.fetch(item), {
      kind: "file", bytes: html, fileName: "handout.html", contentType: "text/html",
    });
    assert.deepEqual(http.requestedUrls(), [VIEW]);
  });

  it("returns inline HTML from a pluginfile URL", async () => {
    const html = new TextEncoder().encode("<!doctype html><title>Handout</title><p>Course notes</p>");
    const http = new FakeHttpClient().on(VIEW, redirectResponse(HTML_URL)).on(HTML_URL, okResponse(html, "text/html"));
    assert.deepEqual(await make(http).fetcher.fetch(item), {
      kind: "file", bytes: html, fileName: "handout.html", contentType: "text/html",
    });
  });
});

describe("ResourceFetcher viewer pages", () => {
  const variants: Array<[string, string]> = [
    ["object#resourceobject", resourceViewer.object],
    ["iframe#resourceobject", resourceViewer.iframe],
    ["a pluginfile link", resourceViewer.link],
    ["a reference inside a script", resourceViewer.scriptOnly],
  ];
  for (const [name, html] of variants) {
    it(`downloads the file referenced by ${name}`, async () => {
      const http = new FakeHttpClient()
        .on(VIEW, okResponse(html))
        .on(PDF_URL, okResponse(pdf, "application/pdf"))
        .on(`${PDF_URL}?forcedownload=1`, okResponse(pdf, "application/pdf"));
      const result = await make(http).fetcher.fetch(item);
      assert.equal(result.kind, "file");
      assert.equal(http.requests.length, 2);
    });
  }

  it("ignores links without href when looking for the file reference", async () => {
    const html = `<a name="ancla">x</a><a href="${PDF_URL}">archivo</a>`;
    const http = new FakeHttpClient().on(VIEW, okResponse(html)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    assert.equal((await make(http).fetcher.fetch(item)).kind, "file");
  });

  it("resolves relative references against the final page URL", async () => {
    const html = `<object id="resourceobject" data="/pluginfile.php/55/mod_resource/content/1/Curs%201.pdf"></object>`;
    const http = new FakeHttpClient().on(VIEW, okResponse(html)).on(PDF_URL, okResponse(pdf, "application/pdf"));
    assert.equal((await make(http).fetcher.fetch(item)).kind, "file");
  });

  it("reports the title and captures the viewer page when it has no file reference", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.none));
    const stack = makeStack(http, { capture: true });
    const fetcher = new ResourceFetcher({ session: stack.session, profile, tracer: stack.tracer, messages: en, fileNames: new SourceFileNameResolver(), html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }) });
    const error = await rejection(fetcher.fetch(item));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /"Exerciții".*Sin archivo/);
    assert.equal(stack.sink.snapshots[0]?.name, "resource-viewer-512");
  });

  it("uses the untitled label when the viewer page has no title", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.untitled));
    assert.match((await rejection(make(http).fetcher.fetch(item))).message, /untitled/);
  });

  it("rejects a file reference that leads to another viewer page", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(resourceViewer.object)).on(PDF_URL, okResponse("<html>otra</html>"));
    assert.ok((await rejection(make(http).fetcher.fetch(item))) instanceof PlatformError);
  });

  const signInPage = '<html><body id="page-login-index">Sign in</body></html>';

  it("reports authentication failure when the resource viewer returns a sign-in page with HTTP 200", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse(signInPage));
    await assert.rejects(make(http).fetcher.fetch(item), AuthenticationError);
  });

  it("reports authentication failure when the HTML file endpoint returns a sign-in page with HTTP 200", async () => {
    const viewer = `<object id="resourceobject" data="${HTML_URL}"></object>`;
    const http = new FakeHttpClient().on(VIEW, okResponse(viewer)).on(HTML_URL, okResponse(signInPage));
    await assert.rejects(make(http).fetcher.fetch(item), AuthenticationError);
    assert.deepEqual(http.requestedUrls(), [VIEW, HTML_URL]);
  });
});
