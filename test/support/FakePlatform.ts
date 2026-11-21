import type { LearningPlatform } from "../../src/application/ports.ts";
import type { CourseContents, CourseItem, CourseSummary, FetchedItem } from "../../src/domain/catalog.ts";

/** Returns configured Moodle data and counts calls. */
export class FakePlatform implements LearningPlatform {
  readonly id = "fake";
  readonly calls = { listCourses: 0, loadContents: [] as string[], fetchItem: [] as string[] };
  courses: CourseSummary[] = [];
  contents: Record<string, CourseContents | Error> = {};
  fetched: Record<string, FetchedItem | Error | (() => Promise<FetchedItem>)> = {};

  async listCourses(): Promise<CourseSummary[]> {
    this.calls.listCourses += 1;
    return this.courses.map((course) => ({ ...course }));
  }

  async loadContents(course: CourseSummary): Promise<CourseContents> {
    this.calls.loadContents.push(course.id);
    const configured = this.contents[course.id]!;
    if (configured instanceof Error) throw configured;
    return structuredClone(configured);
  }

  async fetchItem(item: CourseItem): Promise<FetchedItem> {
    this.calls.fetchItem.push(item.id);
    const result = this.fetched[item.id]!;
    if (result instanceof Error) throw result;
    return typeof result === "function" ? result() : result;
  }
}
