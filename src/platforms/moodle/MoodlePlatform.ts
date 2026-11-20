import { AuthenticationError, PlatformError } from "../../domain/errors.ts";
import type { CourseContents, CourseItem, CourseSummary, FetchedItem } from "../../domain/catalog.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { MoodleSession } from "../../application/MoodleSession.ts";
import type { LearningPlatform } from "../../application/ports.ts";
import type { Tracer } from "../../tracing/Tracer.ts";
import type { CourseIndexParser } from "./CourseIndexParser.ts";
import type { CourseListParser } from "./CourseListParser.ts";
import type { MoodleProfile } from "./MoodleProfile.ts";
import type { SesskeyExtractor } from "./SesskeyExtractor.ts";

const SCOPE = "moodle.platform";
const COURSES_METHOD = "core_course_get_enrolled_courses_by_timeline_classification";

export interface ItemFetcher {
  fetch(item: CourseItem): Promise<FetchedItem>;
}

/** Moodle 4.x adapter with per-installation settings in MoodleProfile. */
export class MoodlePlatform implements LearningPlatform {
  readonly id: string;
  private readonly profile: MoodleProfile;
  private readonly session: MoodleSession;
  private readonly tracer: Tracer;
  private readonly messages: Messages;
  private readonly sesskeys: SesskeyExtractor;
  private readonly courseList: CourseListParser;
  private readonly courseIndex: CourseIndexParser;
  private readonly resources: ItemFetcher;
  private readonly scorms: ItemFetcher;

  constructor(deps: {
    id: string;
    profile: MoodleProfile;
    session: MoodleSession;
    tracer: Tracer;
    messages: Messages;
    sesskeys: SesskeyExtractor;
    courseList: CourseListParser;
    courseIndex: CourseIndexParser;
    resources: ItemFetcher;
    scorms: ItemFetcher;
  }) {
    this.id = deps.id;
    this.profile = deps.profile;
    this.session = deps.session;
    this.tracer = deps.tracer;
    this.messages = deps.messages;
    this.sesskeys = deps.sesskeys;
    this.courseList = deps.courseList;
    this.courseIndex = deps.courseIndex;
    this.resources = deps.resources;
    this.scorms = deps.scorms;
  }

  listCourses(): Promise<CourseSummary[]> {
    return this.tracer.span(SCOPE, "listCourses", {}, async () => {
      const coursesPage = new URL("my/courses.php", this.profile.baseUrl);
      const page = await this.session.getText(coursesPage, "courses-page");
      const sesskey = this.sesskeys.extract(page.text);
      if (sesskey === undefined) {
        const title = /<title>([^<]*)<\/title>/i.exec(page.text)?.[1]?.trim() || this.messages.common.untitled();
        throw new PlatformError(this.messages.platform.sesskeyNotFound({ title }));
      }
      this.tracer.addSecret(sesskey.reveal());

      const service = new URL("lib/ajax/service.php", this.profile.baseUrl);
      service.searchParams.set("sesskey", sesskey.reveal());
      service.searchParams.set("info", COURSES_METHOD);
      const posted = await this.session.postJson(service, this.coursesRequest(), coursesPage.href);
      this.tracer.snapshot("courses-json", posted.text, { status: posted.status });

      const { courses, skipped } = this.courseList.parse(posted.text);
      this.tracer.event("info", SCOPE, "courses.parsed", { count: courses.length, skipped });
      return courses;
    });
  }

  loadContents(course: CourseSummary): Promise<CourseContents> {
    return this.tracer.span(SCOPE, "loadContents", { course: course.id }, async () => {
      const attempts: string[] = [];
      let emptyCourse: CourseContents | undefined;
      for (const [index, template] of this.profile.contentsPaths.entries()) {
        const url = new URL(template.replace("{courseId}", encodeURIComponent(course.id)), this.profile.baseUrl);
        try {
          const page = await this.session.getText(url, `course-${course.id}-${index}`);
          const { contents, stats } = this.courseIndex.parse(page.text, this.profile.baseUrl);
          const outcome = contents.items.length > 0 ? "ok" : "empty";
          this.tracer.event("info", SCOPE, "contents.attempt", { path: template, outcome, ...stats });
          if (outcome === "ok") return contents;
          if (contents.sections.length > 0) emptyCourse ??= contents;
          attempts.push(`${template} (${outcome})`);
        } catch (error) {
          if (error instanceof AuthenticationError) throw error;
          const detail = (error as Error).message;
          this.tracer.event("warn", SCOPE, "contents.attempt", { path: template, outcome: "error", detail });
          attempts.push(`${template} (${detail})`);
        }
      }
      if (emptyCourse !== undefined) return emptyCourse;
      throw new PlatformError(
        this.messages.platform.contentsUnavailable({ course: course.name, attempts: attempts.join("; ") }),
      );
    });
  }

  fetchItem(item: CourseItem): Promise<FetchedItem> {
    return this.tracer.span(SCOPE, "fetchItem", { item: item.id, kind: item.kind }, () =>
      item.kind === "scorm" ? this.scorms.fetch(item) : this.resources.fetch(item),
    );
  }

  private coursesRequest(): unknown {
    return [
      {
        index: 0,
        methodname: COURSES_METHOD,
        args: {
          offset: 0,
          limit: 0,
          classification: "all",
          sort: "fullname",
          customfieldname: "",
          customfieldvalue: "",
          requiredfields: ["id", "fullname", "shortname", "showcoursecategory", "showshortname", "visible", "enddate"],
        },
      },
    ];
  }
}
