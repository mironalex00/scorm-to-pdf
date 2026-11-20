import type { CourseContents, CourseItem, CourseSummary, Section } from "../domain/catalog.ts";
import type { CompressedStore } from "../store/CompressedStore.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { LearningPlatform } from "./ports.ts";

const COURSES_KEY = "courses";

/** Loads course contents on demand and keeps a compressed cache in memory. */
export class CatalogService {
  private readonly platform: LearningPlatform;
  private readonly store: CompressedStore<unknown>;
  private readonly tracer: Tracer;
  private readonly collator: Intl.Collator;

  constructor(deps: { platform: LearningPlatform; store: CompressedStore<unknown>; locale: string; tracer: Tracer }) {
    this.platform = deps.platform;
    this.store = deps.store;
    this.tracer = deps.tracer;
    this.collator = new Intl.Collator(deps.locale, { sensitivity: "base", numeric: true });
  }

  async courses(): Promise<CourseSummary[]> {
    const cached = this.store.get(COURSES_KEY) as CourseSummary[] | undefined;
    this.tracer.event("debug", "catalog", "courses.cache", { hit: cached !== undefined });
    if (cached) return cached;

    const sorted = (await this.platform.listCourses()).sort((a, b) => this.collator.compare(a.name, b.name));
    this.store.set(COURSES_KEY, sorted);
    return sorted;
  }

  async contents(course: CourseSummary): Promise<CourseContents> {
    const key = `contents:${course.id}`;
    const cached = this.store.get(key) as CourseContents | undefined;
    this.tracer.event("debug", "catalog", "contents.cache", { course: course.id, hit: cached !== undefined });
    if (cached) return cached;

    const loaded = await this.platform.loadContents(course);
    this.store.set(key, loaded);
    return loaded;
  }

  sectionsOf(contents: CourseContents): Section[] {
    return [...contents.sections].sort((a, b) => a.number - b.number);
  }

  itemsIn(contents: CourseContents, sectionNumber: number): CourseItem[] {
    return contents.items.filter((item) => item.sectionNumber === sectionNumber);
  }

  weeks(contents: CourseContents): { section: Section; items: CourseItem[] }[] {
    const itemsBySection = new Map<number, CourseItem[]>();
    for (const item of contents.items) {
      const items = itemsBySection.get(item.sectionNumber);
      if (items) items.push(item);
      else itemsBySection.set(item.sectionNumber, [item]);
    }
    return this.sectionsOf(contents).map((section) => ({ section, items: itemsBySection.get(section.number) ?? [] }));
  }

  /** Matches an exact ID or a name fragment, ignoring case and accents. */
  async find(query: string): Promise<CourseSummary[]> {
    const all = await this.courses();
    const exact = all.filter((course) => course.id === query);
    if (exact.length > 0) return exact;
    const needle = this.plain(query);
    return all.filter((course) => this.plain(course.name).includes(needle));
  }

  clear(): void {
    this.store.clear();
  }

  private plain(text: string): string {
    return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  }
}
