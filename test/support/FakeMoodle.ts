import type { IncomingMessage, ServerResponse } from "node:http";
import { buildDeckHtml } from "./deckHtml.ts";
import { LocalServer } from "./LocalServer.ts";
import { makeJpeg } from "./jpegFixtures.ts";
import { coursesJson, coursesPage, SESSKEY } from "../fixtures/moodle.ts";

export interface FakeMoodleOptions {
  readonly scormId: number;
  readonly revision: number;
  readonly title: string;
  readonly slideCount: number;
  readonly validCookie: string;
  /** Resource IDs that return 404 when opened. */
  readonly failItems?: readonly string[];
}

const CONTENT_PATH = /^\/pluginfile\.php\/(\d+)\/mod_scorm\/content\/(\d+)\/(.+)$/;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const COURSES = [
  { id: 101, fullname: "Structuri de date" },
  { id: 102, fullname: "Algoritmi fundamentali" },
];

/** Course fixtures covering relative links, the sidebar index, and the course body. */
const INDEXES: Readonly<Record<string, string>> = {
  "102": `<div id="courseindex-content">
<div class="courseindex-section" data-for="section" data-number="0"><a class="courseindex-link courseindex-section-title" data-for="section_title">General</a>
  <ul><li data-for="cm"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=501">Programa</a></li></ul></div>
<div class="courseindex-section" data-for="section" data-number="1"><a class="courseindex-link courseindex-section-title" data-for="section_title">S&#259;pt&#259;m&#226;na 1</a>
  <ul><li data-for="cm"><a class="courseindex-link" data-for="cm_name" href="/mod/scorm/view.php?id=511">Curs 5. Func&#539;ii</a></li>
  <li data-for="cm"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=512">Exerci&#539;ii &amp; teme</a></li>
  <li data-for="cm"><a class="courseindex-link" data-for="cm_name" href="/mod/forum/view.php?id=513">Anun&#539;uri</a></li></ul></div>
<div class="courseindex-section" data-for="section" data-number="3"><a class="courseindex-link courseindex-section-title" data-for="section_title">S&#259;pt&#259;m&#226;na 3</a>
  <ul><li data-for="cm"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=531">Complementar</a></li></ul></div>
</div>`,
  "101": `<div id="region-main"><ul>
  <li data-for="section" data-number="0" data-sectionname="General"><ul>
    <li class="activity modtype_subsection" data-for="cmitem"><ul>
      <li data-for="section" data-number="2" data-sectionname="Tema"><ul>
        <li class="activity modtype_resource" data-for="cmitem">
          <a class="aalink" href="/mod/resource/view.php?id=601"><span class="instancename">Tema 1<span class="accesshide"> Fișier</span></span></a>
        </li>
      </ul></li>
    </ul></li>
  </ul></li>
</ul></div>`,
};

const REDIRECTING_RESOURCES: Readonly<Record<string, string>> = { "501": "Programa.pdf", "531": "Complementar.pdf", "601": "Tema1.pdf" };

/** Simulates authenticated Moodle course listings, activities, and a SCORM slide deck. */
export class FakeMoodle {
  static start(options: FakeMoodleOptions): Promise<LocalServer> {
    return LocalServer.start((request, response) => FakeMoodle.handle(options, request, response));
  }

  private static handle(options: FakeMoodleOptions, request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? "/", "http://fake.local");
    const path = url.pathname;
    if (path === "/login/index.php") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<html><title>Conectați-vă la site</title><body class='notloggedin'></body></html>");
      return;
    }
    if (request.headers.cookie !== `MoodleSession=${options.validCookie}`) {
      response.writeHead(303, { location: "/login/index.php" });
      response.end();
      return;
    }

    if (path === "/my/courses.php") return FakeMoodle.html(response, coursesPage(SESSKEY));
    if (path === "/lib/ajax/service.php") return FakeMoodle.service(url, response);
    if (path === "/course/section.php" || path === "/course/view.php") {
      const index = INDEXES[url.searchParams.get("id") ?? ""];
      return index === undefined ? FakeMoodle.send(response, 404) : FakeMoodle.html(response, index);
    }
    if (path === "/mod/resource/view.php") return FakeMoodle.resource(options, url, response);
    if (path === "/mod/scorm/view.php") return FakeMoodle.html(response, FakeMoodle.scormForm());
    if (path === "/mod/scorm/loadSCO.php") return FakeMoodle.loadSco(options, url, response);
    if (path.startsWith("/pluginfile.php/55/mod_resource/")) {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(PDF);
      return;
    }
    FakeMoodle.scormContent(options, path, response);
  }

  private static service(url: URL, response: ServerResponse): void {
    response.writeHead(200, { "content-type": "application/json" });
    if (url.searchParams.get("sesskey") !== SESSKEY) {
      response.end(JSON.stringify([{ error: true, exception: { errorcode: "invalidsesskey", message: "sesskey" } }]));
      return;
    }
    response.end(coursesJson(COURSES));
  }

  private static resource(options: FakeMoodleOptions, url: URL, response: ServerResponse): void {
    const id = url.searchParams.get("id") ?? "";
    if (options.failItems?.includes(id)) return FakeMoodle.send(response, 404);
    const file = REDIRECTING_RESOURCES[id];
    if (file !== undefined) {
      response.writeHead(303, { location: `/pluginfile.php/55/mod_resource/content/1/${file}` });
      response.end();
      return;
    }
    FakeMoodle.html(response, `<html><body><object id="resourceobject" data="/pluginfile.php/55/mod_resource/content/1/Exercitii.pdf"></object></body></html>`);
  }

  private static scormForm(): string {
    return `<html><body><form action="/mod/scorm/player.php"><input name="mode" value="normal"><input name="scoid" value="6"><input name="cm" value="511"><input name="currentorg" value="ORG-1"></form></body></html>`;
  }

  private static loadSco(options: FakeMoodleOptions, url: URL, response: ServerResponse): void {
    const expected = "id=511&scoid=6&currentorg=ORG-1&mode=normal&attempt=1";
    if (url.searchParams.toString() !== expected) return FakeMoodle.send(response, 404);
    response.writeHead(302, { location: `/pluginfile.php/${options.scormId}/mod_scorm/content/${options.revision}/index.html` });
    response.end();
  }

  private static scormContent(options: FakeMoodleOptions, path: string, response: ServerResponse): void {
    const match = CONTENT_PATH.exec(path);
    if (!match) return FakeMoodle.send(response, 404);
    const [, id, revision, file] = match;
    if (Number(id) !== options.scormId || Number(revision) !== options.revision) return FakeMoodle.send(response, 404);

    if (file === "index.html") {
      const slides = Array.from({ length: options.slideCount }, (_, index) => ({
        src: `slides/slide-${String(index + 1).padStart(2, "0")}.jpg`,
        title: `Slide ${index + 1}`,
      }));
      return FakeMoodle.html(response, buildDeckHtml({ title: options.title, slides }));
    }
    if (/^slides\/slide-\d\d\.jpg$/.test(file!)) {
      response.writeHead(200, { "content-type": "image/jpeg" });
      response.end(Buffer.from(makeJpeg({ width: 1280, height: 720 })));
      return;
    }
    FakeMoodle.send(response, 404);
  }

  private static html(response: ServerResponse, body: string): void {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(body);
  }

  private static send(response: ServerResponse, status: number): void {
    response.writeHead(status);
    response.end();
  }
}
