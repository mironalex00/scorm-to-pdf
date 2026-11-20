import type { CourseContents, CourseItem, Section } from "../../domain/catalog.ts";
import type { HtmlElement, HtmlParser } from "../../html/HtmlParser.ts";

export interface IndexStats {
  readonly sections: number;
  readonly items: number;
  /** Ignored activities grouped by Moodle module type. */
  readonly skippedModules: Record<string, number>;
  /** Reasons for skipping candidate sections or activities. */
  readonly dropped: Record<"unnamed" | "noHref" | "noId" | "invalidHref" | "duplicate" | "invalidSections", number>;
  /** Count of elements by data-for value. */
  readonly markers: Record<string, number>;
}

export interface ParsedIndex {
  readonly contents: CourseContents;
  readonly stats: IndexStats;
}

const MODULE_VIEW = /(?:^|\/)mod\/[a-z_]+\/view\.php(?:[?#]|$)/;

function isSection(element: HtmlElement): boolean {
  return element.hasClass("courseindex-section") || element.attr("data-for") === "section";
}

/** Subsections have their own titles and activities. */
function* sectionDescendants(element: HtmlElement): IterableIterator<HtmlElement> {
  for (const child of element.children) {
    if (typeof child === "string" || isSection(child)) continue;
    yield child;
    yield* sectionDescendants(child);
  }
}

function activityNameText(element: HtmlElement): string {
  let text = "";
  for (const child of element.children) {
    if (typeof child === "string") text += child;
    else if (!child.hasClass("accesshide")) text += activityNameText(child);
  }
  return text;
}

/** Reads Moodle sections and activities. Course body placement takes precedence over the sidebar. */
export class CourseIndexParser {
  private readonly html: HtmlParser;

  constructor(deps: { html: HtmlParser }) {
    this.html = deps.html;
  }

  parse(html: string, base: URL): ParsedIndex {
    const document = this.html.parse(html);
    const sectionsByNumber = new Map<number, Section>();
    const items: CourseItem[] = [];
    const skippedModules: Record<string, number> = {};
    const dropped = { unnamed: 0, noHref: 0, noId: 0, invalidHref: 0, duplicate: 0, invalidSections: 0 };
    const markers: Record<string, number> = {};
    const seen = new Set<string>();

    const bodySections: HtmlElement[] = [];
    const indexSections: HtmlElement[] = [];
    for (const element of document.findAll(() => true)) {
      const marker = element.attr("data-for");
      if (marker) markers[marker] = (markers[marker] ?? 0) + 1;
      if (!isSection(element)) continue;
      if (element.tag === "li" && !element.hasClass("courseindex-section")) bodySections.push(element);
      else indexSections.push(element);
    }

    for (const element of [...bodySections, ...indexSections]) {
      const raw = element.attr("data-number") ?? "";
      if (!/^\d+$/.test(raw)) {
        dropped.invalidSections += 1;
        continue;
      }
      const number = Number(raw);
      const descendants = [...sectionDescendants(element)];
      const title = this.titleOf(element, descendants);
      const existing = sectionsByNumber.get(number);
      if (existing === undefined || (title !== "" && (existing.title === "" || element.hasClass("courseindex-section")))) {
        sectionsByNumber.set(number, { number, title });
      }

      for (const child of descendants) {
        const marker = child.attr("data-for");
        let link: HtmlElement;
        let name: string;
        if (marker === "cm_name") {
          link = child;
          name = link.text();
        } else if (marker === "cmitem") {
          const activityLink = this.activityLink(child);
          if (activityLink === undefined) continue;
          link = activityLink;
          const instance = link.find((node) => node.hasClass("instancename")) ?? link;
          name = activityNameText(instance).replace(/\s+/g, " ").trim();
        } else {
          continue;
        }
        const item = this.toItem(link, name, number, base, dropped, skippedModules);
        if (item === undefined) continue;
        if (seen.has(item.id)) {
          dropped.duplicate += 1;
          continue;
        }
        seen.add(item.id);
        items.push(item);
      }
    }

    const sections = [...sectionsByNumber.values()];
    return {
      contents: { sections, items },
      stats: { sections: sections.length, items: items.length, skippedModules, dropped, markers },
    };
  }

  private titleOf(section: HtmlElement, descendants: readonly HtmlElement[]): string {
    const byAttribute = descendants.find((child) => child.attr("data-for") === "section_title")?.text();
    if (byAttribute) return byAttribute;
    const name = section.attr("data-sectionname")?.trim();
    if (name) return name;
    const byClass = descendants.find((child) => child.hasClass("courseindex-section-title"));
    return byClass?.text() ?? "";
  }

  private activityLink(activity: HtmlElement): HtmlElement | undefined {
    let first: HtmlElement | undefined;
    for (const child of sectionDescendants(activity)) {
      if (child.tag !== "a" || !MODULE_VIEW.test(child.attr("href") ?? "")) continue;
      if (child.hasClass("aalink")) return child;
      first ??= child;
    }
    return first;
  }

  private toItem(
    link: HtmlElement,
    name: string,
    sectionNumber: number,
    base: URL,
    dropped: IndexStats["dropped"],
    skippedModules: Record<string, number>,
  ): CourseItem | undefined {
    if (name === "") return this.drop(dropped, "unnamed");
    const href = link.attr("href");
    if (!href) return this.drop(dropped, "noHref");

    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      return this.drop(dropped, "invalidHref");
    }

    const module = /\/mod\/([a-z_]+)\//.exec(url.pathname)?.[1] ?? "other";
    if (module !== "resource" && module !== "scorm") {
      skippedModules[module] = (skippedModules[module] ?? 0) + 1;
      return undefined;
    }
    const id = url.searchParams.get("id");
    if (!id) return this.drop(dropped, "noId");
    return { id, kind: module, name, url: url.href, sectionNumber };
  }

  private drop(dropped: IndexStats["dropped"], reason: keyof IndexStats["dropped"]): undefined {
    dropped[reason] += 1;
    return undefined;
  }
}
