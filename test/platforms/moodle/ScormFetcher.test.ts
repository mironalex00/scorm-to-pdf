import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PluginfileLocator } from "../../../src/platforms/moodle/PluginfileLocator.ts";
import { PlatformError } from "../../../src/domain/errors.ts";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { en } from "../../../src/i18n/en.ts";
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
  return { fetcher: new ScormFetcher({ session: stack.session, profile, tracer: stack.tracer, messages: en, html: new HtmlParser(), locator: new PluginfileLocator({ maxPrefix: 2048 }) }), ...stack };
}
const slides = { kind: "slides", entryUrl: new URL(ENTRY_URL), html: ENTRY_HTML };

describe("ScormFetcher launch", () => {
  it("uses player.php parameters and follows the loadSCO redirect to the content", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=normal&attempt=2`, redirectResponse(ENTRY_URL, 302))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    const { fetcher, events } = make(http);
    assert.deepEqual(await fetcher.fetch({ ...view, url: `${PLAYER}&mode=normal&attempt=2` }), slides);
    assert.ok(events().some((e) => e.scope === "moodle.scorm" && e.name === "launch.params" && e.data?.scoid === "9"));
  });

  it("defaults to an empty mode and attempt 1", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(ENTRY_HTML));
    // An HTTP 200 wrapper page points to the content in its body.
    http.on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(SCORM_LOAD_JS)).on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch({ ...view, url: PLAYER }), slides);
  });

  it("reads the launch form in view.php and uses the module ID when a is absent", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(SCORM_VIEW_FORM))
      .on(`${LOAD}?id=511&scoid=6&currentorg=ORG-1&mode=normal&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("reads the launch parameters after a redirect to player.php", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, redirectResponse(PLAYER))
      .on(PLAYER, okResponse("<html>player</html>"))
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("decodes ampersand entities in player.php links", async () => {
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(SCORM_VIEW_LINK))
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("fetches content referenced in the loadSCO page", async () => {
    const http = new FakeHttpClient()
      .on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse(SCORM_LOAD_JS))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch({ ...view, url: PLAYER }), slides);
  });
});

describe("ScormFetcher error handling", () => {
  it("reports the page title and captures the response when loadSCO has no content reference", async () => {
    const http = new FakeHttpClient().on(`${LOAD}?a=7&scoid=9&currentorg=ORG-1&mode=&attempt=1`, okResponse("<title>Rara</title>"));
    const error = await rejection(make(http).fetcher.fetch({ ...view, url: PLAYER }));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /"Curs 5".*Rara/);
  });

  it("reports when view.php has no launch information", async () => {
    const http = new FakeHttpClient().on(VIEW, okResponse("<html><title>Vacía</title></html>"));
    const error = await rejection(make(http).fetcher.fetch(view));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /launch details.*Vacía.*player\.php: 0/);
  });

  it("rejects a player.php URL without scoid", async () => {
    const error = await rejection(make(new FakeHttpClient()).fetcher.fetch({ ...view, url: `${M}/player.php?a=7` }));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /launch details/);
  });

  it("treats a form input without value as an empty string", async () => {
    const form = `<form action="${M}/player.php"><input name="scoid" value="6"><input name="mode"></form>`;
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(form))
      .on(`${LOAD}?id=511&scoid=6&currentorg=&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });

  it("uses the item ID when the form has neither a module ID nor a", async () => {
    const form = `<form action="${M}/player.php"><input name="scoid" value="6"></form>`;
    const http = new FakeHttpClient()
      .on(VIEW, okResponse(form))
      .on(`${LOAD}?id=511&scoid=6&currentorg=&mode=&attempt=1`, redirectResponse(ENTRY_URL))
      .on(ENTRY_URL, okResponse(ENTRY_HTML));
    assert.deepEqual(await make(http).fetcher.fetch(view), slides);
  });
});
