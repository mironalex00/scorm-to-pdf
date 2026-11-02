import { PlatformError } from "../../domain/errors.ts";
import type { CourseItem, FetchedItem } from "../../domain/catalog.ts";
import { decodeEntities } from "../../html/HtmlParser.ts";
import type { HtmlParser } from "../../html/HtmlParser.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { MoodleSession } from "../../application/MoodleSession.ts";
import type { Tracer } from "../../tracing/Tracer.ts";
import type { MoodleProfile } from "./MoodleProfile.ts";
import type { PluginfileLocator } from "./PluginfileLocator.ts";

const SCOPE = "moodle.scorm";
const FORM_FIELDS: ReadonlySet<string> = new Set(["a", "cm", "scoid", "currentorg", "mode", "attempt"]);
const PLAYER_LINK = /player\.php\?([^"'<>\s]+)/;
const CONTENT_PATH = /\/pluginfile\.php\/\d+\/mod_scorm\/content\/\d+\/[^\s"'<>)]+/;

interface LaunchParams {
  readonly a: string | undefined;
  readonly cm: string | undefined;
  readonly scoid: string;
  readonly currentorg: string;
  readonly mode: string;
  readonly attempt: string;
}

/**
 * Resuelve un SCORM al documento de entrada de su contenido. Los datos de lanzamiento (a, scoid,
 * currentorg, mode, attempt) salen de la URL player.php, de un enlace o del formulario de la página
 * view.php; la URL real del contenido la entrega loadSCO.php, ya sea por redirección o en su cuerpo.
 */
export class ScormFetcher {
  private readonly session: MoodleSession;
  private readonly profile: MoodleProfile;
  private readonly tracer: Tracer;
  private readonly messages: Messages;
  private readonly html: HtmlParser;
  private readonly locator: PluginfileLocator;

  constructor(deps: {
    session: MoodleSession;
    profile: MoodleProfile;
    tracer: Tracer;
    messages: Messages;
    html: HtmlParser;
    locator: PluginfileLocator;
  }) {
    this.locator = deps.locator;
    this.session = deps.session;
    this.profile = deps.profile;
    this.tracer = deps.tracer;
    this.messages = deps.messages;
    this.html = deps.html;
  }

  async fetch(item: CourseItem): Promise<FetchedItem> {
    const tracer = this.tracer.with({ item: item.id });
    const params = await this.findLaunchParams(item);
    tracer.event("debug", SCOPE, "launch.params", { ...params });

    const load = new URL("mod/scorm/loadSCO.php", this.profile.baseUrl);
    load.searchParams.set(params.a !== undefined ? "a" : "id", params.a ?? params.cm ?? item.id);
    load.searchParams.set("scoid", params.scoid);
    load.searchParams.set("currentorg", params.currentorg);
    load.searchParams.set("mode", params.mode);
    load.searchParams.set("attempt", params.attempt);

    const loaded = await this.session.getText(load, `scorm-load-${item.id}`);
    tracer.event("debug", SCOPE, "load.fetched", { finalPath: loaded.finalUrl.pathname, chars: loaded.text.length });
    if (loaded.finalUrl.pathname.includes("/mod_scorm/content/")) return this.slides(loaded.finalUrl, loaded.text);

    const reference = this.locator.locate(loaded.text.replace(/\\\//g, "/"), CONTENT_PATH);
    if (reference === undefined) {
      throw new PlatformError(
        this.messages.platform.scormEntryNotFound({
          name: item.name,
          detail: this.hints(loaded.text, "pluginfile: 0"),
        }),
      );
    }
    tracer.event("debug", SCOPE, "entry.reference", { reference });
    const entry = await this.session.getText(new URL(reference, this.profile.baseUrl), `scorm-entry-${item.id}`);
    return this.slides(entry.finalUrl, entry.text);
  }

  private async findLaunchParams(item: CourseItem): Promise<LaunchParams> {
    const url = new URL(item.url);
    if (url.pathname.endsWith("/player.php")) return this.fromQuery(url.searchParams, item, "");

    const page = await this.session.getText(url, `scorm-view-${item.id}`);
    if (page.finalUrl.pathname.endsWith("/player.php")) return this.fromQuery(page.finalUrl.searchParams, item, page.text);

    const link = PLAYER_LINK.exec(page.text);
    if (link) return this.fromQuery(new URLSearchParams(decodeEntities(link[1]!)), item, page.text);

    const form = this.fromForm(page.text);
    if (form) return this.fromQuery(form, item, page.text);

    const playerLinks = (page.text.match(/player\.php/g) ?? []).length;
    throw new PlatformError(
      this.messages.platform.scormLaunchNotFound({
        name: item.name,
        detail: this.hints(page.text, `player.php: ${playerLinks}; inputs: 0`),
      }),
    );
  }

  private fromQuery(query: URLSearchParams, item: CourseItem, page: string): LaunchParams {
    const scoid = query.get("scoid");
    if (!scoid) {
      throw new PlatformError(
        this.messages.platform.scormLaunchNotFound({ name: item.name, detail: this.hints(page, "scoid: 0") }),
      );
    }
    return {
      a: query.get("a") ?? undefined,
      cm: query.get("cm") ?? undefined,
      scoid,
      currentorg: query.get("currentorg") ?? "",
      mode: query.get("mode") ?? "",
      attempt: query.get("attempt") ?? "1",
    };
  }

  private fromForm(page: string): URLSearchParams | undefined {
    const inputs = this.html
      .parse(page)
      .findAll((element) => element.tag === "input" && FORM_FIELDS.has(element.attr("name") ?? ""));
    if (!inputs.some((input) => input.attr("name") === "scoid")) return undefined;
    return new URLSearchParams(inputs.map((input): [string, string] => [input.attr("name")!, input.attr("value") ?? ""]));
  }

  private slides(entryUrl: URL, html: string): FetchedItem {
    return { kind: "slides", entryUrl, html };
  }

  private hints(page: string, details: string): string {
    const title = this.html.parse(page).find((element) => element.tag === "title")?.text() || this.messages.common.untitled();
    return this.messages.platform.pageHints({ title, details });
  }
}
