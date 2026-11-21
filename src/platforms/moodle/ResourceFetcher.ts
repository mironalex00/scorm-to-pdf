import { PlatformError } from "../../domain/errors.ts";
import type { CourseItem, FetchedItem } from "../../domain/catalog.ts";
import type { HtmlParser } from "../../html/HtmlParser.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { FetchedBytes, MoodleSession } from "../../application/MoodleSession.ts";
import type { SourceFileNameResolver } from "../../application/SourceFileNameResolver.ts";
import type { Tracer } from "../../tracing/Tracer.ts";
import type { MoodleProfile } from "./MoodleProfile.ts";
import type { PluginfileLocator } from "./PluginfileLocator.ts";

const SCOPE = "moodle.resource";
const PLUGINFILE_PATH = /\/pluginfile\.php\/[^\s"'<>)]+/;

/** Resolves direct downloads and Moodle viewer pages that link to pluginfile.php. */
export class ResourceFetcher {
  private readonly session: MoodleSession;
  private readonly profile: MoodleProfile;
  private readonly tracer: Tracer;
  private readonly messages: Messages;
  private readonly fileNames: SourceFileNameResolver;
  private readonly html: HtmlParser;
  private readonly locator: PluginfileLocator;

  constructor(deps: {
    session: MoodleSession;
    profile: MoodleProfile;
    tracer: Tracer;
    messages: Messages;
    fileNames: SourceFileNameResolver;
    html: HtmlParser;
    locator: PluginfileLocator;
  }) {
    this.locator = deps.locator;
    this.session = deps.session;
    this.profile = deps.profile;
    this.tracer = deps.tracer;
    this.messages = deps.messages;
    this.fileNames = deps.fileNames;
    this.html = deps.html;
  }

  async fetch(item: CourseItem): Promise<FetchedItem> {
    const tracer = this.tracer.with({ item: item.id });
    const view = new URL(item.url);
    view.searchParams.set("redirect", "1");

    const first = await this.session.getBytes(view, this.profile.maxFileBytes);
    tracer.event("debug", SCOPE, "view.fetched", {
      contentType: first.contentType,
      finalPath: first.finalUrl.pathname,
      bytes: first.bytes.length,
    });
    const page = this.viewerPage(first);
    if (page === undefined) return this.asFile(first);
    tracer.snapshot(`resource-viewer-${item.id}`, page, { path: first.finalUrl.pathname });
    const reference = this.findReference(page);
    if (reference === undefined) throw this.unresolved(item, page);

    const fileUrl = new URL(reference, first.finalUrl);
    tracer.event("debug", SCOPE, "file.reference", { path: fileUrl.pathname });
    const second = await this.session.getBytes(fileUrl, this.profile.maxFileBytes);
    const secondPage = this.viewerPage(second);
    if (secondPage !== undefined) throw this.unresolved(item, secondPage);
    return this.asFile(second);
  }

  private findReference(page: string): string | undefined {
    const document = this.html.parse(page);
    const viewer = document.find((element) => element.attr("id") === "resourceobject");
    const direct = viewer?.attr("data") ?? viewer?.attr("src");
    if (direct) return direct;

    const link = document.find((element) => element.tag === "a" && (element.attr("href") ?? "").includes("/pluginfile.php/"));
    if (link) return link.attr("href");
    return this.locator.locate(page.replace(/\\\//g, "/"), PLUGINFILE_PATH);
  }

  private asFile(fetched: FetchedBytes): FetchedItem {
    return {
      kind: "file",
      bytes: fetched.bytes,
      fileName: this.fileNames.resolve({ url: fetched.finalUrl, contentDisposition: fetched.contentDisposition }),
      contentType: fetched.contentType,
    };
  }

  private viewerPage({ contentType, contentDisposition, bytes, finalUrl }: FetchedBytes): string | undefined {
    if (!/text\/html|application\/xhtml/i.test(contentType) || /^\s*attachment\b/i.test(contentDisposition ?? "")) return undefined;
    const page = new TextDecoder().decode(bytes);
    this.session.assertAuthenticated(page, finalUrl);
    return /\/pluginfile\.php\/.*\.(?:html?|xhtml)$/i.test(finalUrl.pathname) ? undefined : page;
  }

  private unresolved(item: CourseItem, page: string): PlatformError {
    const document = this.html.parse(page);
    const title = document.find((element) => element.tag === "title")?.text() || this.messages.common.untitled();
    const viewers = document.findAll((element) => element.attr("id") === "resourceobject").length;
    const links = (page.match(/\/pluginfile\.php\//g) ?? []).length;
    return new PlatformError(
      this.messages.platform.resourceNotResolved({
        name: item.name,
        detail: this.messages.platform.pageHints({ title, details: `resourceobject: ${viewers}; pluginfile: ${links}` }),
      }),
    );
  }
}
