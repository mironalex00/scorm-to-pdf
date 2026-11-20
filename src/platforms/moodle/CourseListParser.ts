import { AuthenticationError, PlatformError } from "../../domain/errors.ts";
import type { CourseSummary } from "../../domain/catalog.ts";
import { decodeEntities } from "../../html/HtmlParser.ts";
import type { Messages } from "../../i18n/Messages.ts";
import { describeShape } from "../../tracing/describeShape.ts";

const WHAT = "core_course_get_enrolled_courses_by_timeline_classification";
const AUTH_CODES: ReadonlySet<string> = new Set(["invalidsesskey", "servicerequireslogin", "requireloginerror"]);

export interface ParsedCourses {
  readonly courses: CourseSummary[];
  readonly skipped: number;
}

/** Parses the Moodle course service response and reports its shape on failure. */
export class CourseListParser {
  private readonly messages: Messages;

  constructor(deps: { messages: Messages }) {
    this.messages = deps.messages;
  }

  parse(raw: string): ParsedCourses {
    const json = this.parseJson(raw);
    if (json !== null && typeof json === "object" && !Array.isArray(json)) {
      const failure = json as { error?: unknown; errorcode?: unknown };
      if (typeof failure.errorcode === "string") throw this.serviceFailure(failure.errorcode, String(failure.error));
      throw this.unexpected(json);
    }
    if (!Array.isArray(json) || json.length === 0) throw this.unexpected(json);

    const first = json[0] as unknown;
    if (first === null || typeof first !== "object") throw this.unexpected(json);
    const reply = first as {
      error?: unknown;
      exception?: { errorcode?: unknown; message?: unknown };
      data?: { courses?: unknown };
    };
    if (reply.error === true) {
      throw this.serviceFailure(String(reply.exception?.errorcode ?? "unknown"), String(reply.exception?.message ?? ""));
    }
    if (!Array.isArray(reply.data?.courses)) throw this.unexpected(json);

    const courses: CourseSummary[] = [];
    let skipped = 0;
    for (const entry of reply.data.courses as unknown[]) {
      const candidate = entry as { id?: unknown; fullname?: unknown } | null;
      const id = candidate?.id;
      const name = candidate?.fullname;
      if ((typeof id === "number" || typeof id === "string") && typeof name === "string") {
        courses.push({ id: String(id), name: decodeEntities(name) });
      } else {
        skipped += 1;
      }
    }
    return { courses, skipped };
  }

  private parseJson(raw: string): unknown {
    try {
      return JSON.parse(raw) as unknown;
    } catch (error) {
      throw new PlatformError(this.messages.platform.notJson({ path: "service.php" }), { cause: error });
    }
  }

  private serviceFailure(code: string, detail: string): Error {
    return AUTH_CODES.has(code)
      ? new AuthenticationError(this.messages.platform.invalidSessionKey())
      : new PlatformError(this.messages.platform.serviceError({ code, detail }));
  }

  private unexpected(json: unknown): PlatformError {
    return new PlatformError(this.messages.platform.unexpectedShape({ what: WHAT, shape: describeShape(json) }));
  }
}
