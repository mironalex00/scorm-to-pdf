import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { HtmlParser } from "../../../src/html/HtmlParser.ts";
import { AuthenticationError, PlatformError } from "../../../src/domain/errors.ts";
import { en } from "../../../src/i18n/en.ts";
import { CourseIndexParser } from "../../../src/platforms/moodle/CourseIndexParser.ts";
import { CourseListParser } from "../../../src/platforms/moodle/CourseListParser.ts";
import { MoodlePlatform } from "../../../src/platforms/moodle/MoodlePlatform.ts";
import { SesskeyExtractor } from "../../../src/platforms/moodle/SesskeyExtractor.ts";
import { COURSE_INDEX, SESSKEY, coursesJson, coursesPage } from "../../fixtures/moodle.ts";
import { FakeHttpClient, okResponse, redirectResponse, statusResponse } from "../../support/fakes.ts";
import { makeStack, profile, rejection } from "../../support/moodle.ts";
import type { CourseItem, FetchedItem } from "../../../src/domain/catalog.ts";

const PAGE = "https://moodle.example.org/my/courses.php";
const SERVICE = `https://moodle.example.org/lib/ajax/service.php?sesskey=${SESSKEY}&info=core_course_get_enrolled_courses_by_timeline_classification`;
const COURSE = { id: "101", name: "Algoritmi" };

const fileResult: FetchedItem = { kind: "file", bytes: Uint8Array.of(1), fileName: "a.pdf", contentType: "application/pdf" };
const slidesResult: FetchedItem = { kind: "slides", entryUrl: new URL("https://moodle.example.org/x"), html: "" };
const calls: string[] = [];

function make(http: FakeHttpClient, paths: readonly string[] = profile.contentsPaths, capture = false) {
  const stack = makeStack(http, { capture });
  const platform = new MoodlePlatform({
    id: "org.test",
    profile: { ...profile, contentsPaths: paths },
    session: stack.session,
    tracer: stack.tracer,
    messages: en,
    sesskeys: new SesskeyExtractor(),
    courseList: new CourseListParser({ messages: en }),
    courseIndex: new CourseIndexParser({ html: new HtmlParser() }),
    resources: { fetch: async (item: CourseItem) => (calls.push(`resource:${item.id}`), fileResult) },
    scorms: { fetch: async (item: CourseItem) => (calls.push(`scorm:${item.id}`), slidesResult) },
  });
  return { platform, ...stack };
}
const item = (kind: "resource" | "scorm"): CourseItem => ({ id: "7", kind, name: "n", url: "https://moodle.example.org/x", sectionNumber: 1 });

describe("MoodlePlatform course listing", () => {
  it("reads the session key from my/courses.php and makes the course-list AJAX request", async () => {
    const http = new FakeHttpClient().on(PAGE, okResponse(coursesPage())).on(SERVICE, okResponse(coursesJson([{ id: 7, fullname: "Algoritmi" }]), "application/json"));
    const { platform } = make(http);
    assert.deepEqual(await platform.listCourses(), [{ id: "7", name: "Algoritmi" }]);

    const post = http.requests[1]!;
    assert.equal(post.method, "POST");
    assert.equal(post.headers.Referer, PAGE);
    assert.deepEqual(JSON.parse(post.body!), [{
      index: 0,
      methodname: "core_course_get_enrolled_courses_by_timeline_classification",
      args: {
        offset: 0, limit: 0, classification: "all", sort: "fullname", customfieldname: "", customfieldvalue: "",
        requiredfields: ["id", "fullname", "shortname", "showcoursecategory", "showshortname", "visible", "enddate"],
      },
    }]);
  });

  it("redacts the session key and cookie from events and snapshots", async () => {
    const http = new FakeHttpClient().on(PAGE, okResponse(coursesPage())).on(SERVICE, okResponse(coursesJson([{ id: 7, fullname: "A" }])));
    const { platform, sink, tracer } = make(http, profile.contentsPaths, true);
    tracer.addSecret("cookie-value-123");
    await platform.listCourses();
    const everything = sink.lines.join("\n") + sink.snapshots.map((s) => s.content).join("\n");
    assert.ok(everything.length > 0 && !everything.includes(SESSKEY) && !everything.includes("cookie-value-123"));
    assert.ok(sink.snapshots.some((s) => s.name === "courses-page"));
  });

  it("includes the page title when the session key is missing", async () => {
    const http = new FakeHttpClient().on(PAGE, okResponse("<html><title>Rara</title></html>"));
    const error = await rejection(make(http).platform.listCourses());
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /Rara/);
  });

  it("uses the untitled label when the page has no title or session key", async () => {
    const http = new FakeHttpClient().on(PAGE, okResponse("<html><body>nada</body></html>"));
    assert.match((await rejection(make(http).platform.listCourses())).message, /untitled/);
  });

  it("reports an authentication error when the course list shows a sign-in page", async () => {
    const http = new FakeHttpClient().on(PAGE, redirectResponse("/login/index.php"));
    assert.ok((await rejection(make(http).platform.listCourses())) instanceof AuthenticationError);
  });
});

describe("MoodlePlatform course contents", () => {
  const url = (path: string) => `https://moodle.example.org/${path}`;

  it("tries candidate paths in order and returns the first with materials", async () => {
    const http = new FakeHttpClient()
      .on(url("course/section.php?id=101"), statusResponse(404))
      .on(url("course/view.php?id=101"), okResponse(COURSE_INDEX));
    const { platform, events } = make(http, ["course/section.php?id={courseId}", "course/view.php?id={courseId}"]);
    const contents = await platform.loadContents(COURSE);
    assert.equal(contents.sections.length, 3);
    assert.deepEqual(events().filter((e) => e.name === "contents.attempt").map((e) => e.data?.outcome), ["error", "ok"]);
  });

  it("tries the next path when a page has no sections", async () => {
    const http = new FakeHttpClient()
      .on(url("a/101"), okResponse("<html>vacía</html>"))
      .on(url("b/101"), okResponse(COURSE_INDEX));
    const { platform, events } = make(http, ["a/{courseId}", "b/{courseId}"]);
    assert.equal((await platform.loadContents(COURSE)).items.length, 4);
    assert.equal(events().find((e) => e.name === "contents.attempt")?.data?.outcome, "empty");
  });

  it("tries the next path when a page has sections but no materials", async () => {
    const http = new FakeHttpClient()
      .on(url("a/101"), okResponse('<li data-for="section" data-number="1" data-sectionname="Tema"></li>'))
      .on(url("b/101"), okResponse(COURSE_INDEX));
    const { platform, events } = make(http, ["a/{courseId}", "b/{courseId}"]);
    assert.equal((await platform.loadContents(COURSE)).items.length, 4);
    assert.deepEqual(events().filter((e) => e.name === "contents.attempt").map((e) => e.data?.outcome), ["empty", "ok"]);
  });

  it("returns empty sections when no candidate path contains materials", async () => {
    const http = new FakeHttpClient()
      .on(url("a/101"), okResponse('<li data-for="section" data-number="1" data-sectionname="Tema"></li>'))
      .on(url("b/101"), statusResponse(404));
    const { platform } = make(http, ["a/{courseId}", "b/{courseId}"]);
    assert.deepEqual(await platform.loadContents(COURSE), {
      sections: [{ number: 1, title: "Tema" }],
      items: [],
    });
  });

  it("lists attempted paths when none can load the course", async () => {
    const http = new FakeHttpClient().on(url("a/101"), okResponse("<html></html>")).on(url("b/101"), statusResponse(404));
    const error = await rejection(make(http, ["a/{courseId}", "b/{courseId}"]).platform.loadContents(COURSE));
    assert.ok(error instanceof PlatformError);
    assert.match(error.message, /"Algoritmi".*a\/\{courseId\}.*b\/\{courseId\}/);
  });

  it("stops trying alternate paths on an authentication error", async () => {
    const http = new FakeHttpClient().on(url("a/101"), redirectResponse("/login/index.php"));
    assert.ok((await rejection(make(http, ["a/{courseId}", "b/{courseId}"]).platform.loadContents(COURSE))) instanceof AuthenticationError);
    assert.equal(http.requests.length, 1);
  });
});

describe("MoodlePlatform item retrieval", () => {
  it("dispatches each item to its matching fetcher", async () => {
    const { platform } = make(new FakeHttpClient());
    assert.equal(await platform.fetchItem(item("resource")), fileResult);
    assert.equal(await platform.fetchItem(item("scorm")), slidesResult);
    assert.deepEqual(calls, ["resource:7", "scorm:7"]);
    assert.equal(platform.id, "org.test");
  });
});
