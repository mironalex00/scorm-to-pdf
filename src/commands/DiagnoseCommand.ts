import { AuthenticationError, errorMessage } from "../domain/errors.ts";
import type { CatalogService } from "../application/CatalogService.ts";
import type { LearningPlatform, Logger } from "../application/ports.ts";
import type { CourseContents, CourseItem, CourseSummary } from "../domain/catalog.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { Command } from "./Command.ts";

const MAX_COURSES_TO_PROBE = 5;

interface StepResult {
  readonly ok: boolean;
  readonly detail: string;
  readonly authentication?: boolean;
}

/** Checks course listing, course contents, and representative resource and SCORM downloads. */
export class DiagnoseCommand implements Command {
  private readonly platform: LearningPlatform;
  private readonly catalog: CatalogService;
  private readonly logger: Logger;
  private readonly messages: Messages;
  private readonly tracer: Tracer;

  constructor(deps: {
    platform: LearningPlatform;
    catalog: CatalogService;
    logger: Logger;
    messages: Messages;
    tracer: Tracer;
  }) {
    this.platform = deps.platform;
    this.catalog = deps.catalog;
    this.logger = deps.logger;
    this.messages = deps.messages;
    this.tracer = deps.tracer;
  }

  async run(): Promise<number> {
    const { commands } = this.messages;
    let courses: CourseSummary[] = [];
    const found: { contents?: CourseContents; resource?: CourseItem; scorm?: CourseItem } = {};
    let sessionLost = false;
    let failed = false;

    const step = async (label: string, name: string, work: () => Promise<string>): Promise<void> => {
      if (sessionLost) return;
      const result = await this.attempt(name, work);
      this.logger.result(
        result.ok ? commands.diagnoseOk({ step: label, detail: result.detail }) : commands.diagnoseFailed({ step: label, detail: result.detail }),
      );
      failed ||= !result.ok;
      sessionLost = result.authentication === true;
    };

    await step(commands.stepCourses(), "courses", async () => {
      courses = await this.catalog.courses();
      return commands.detailCourses({ count: String(courses.length) });
    });
    await step(commands.stepContents(), "contents", async () => {
      if (courses.length === 0) throw new Error(commands.detailNothingToTry());
      found.contents = await this.catalog.contents(courses[0]!);
      return commands.detailContents({ sections: String(found.contents.sections.length), items: String(found.contents.items.length) });
    });
    await this.locateSamples(courses, found);
    await step(commands.stepResource(), "resource", async () => {
      if (!found.resource) return commands.detailNothingToTry();
      const fetched = await this.platform.fetchItem(found.resource);
      return commands.detailResource({ name: found.resource.name, bytes: String(fetched.kind === "file" ? fetched.bytes.length : 0) });
    });
    await step(commands.stepScorm(), "scorm", async () => {
      if (!found.scorm) return commands.detailNothingToTry();
      await this.platform.fetchItem(found.scorm);
      return commands.detailScorm({ name: found.scorm.name });
    });

    const trace = this.tracer.flush();
    if (trace !== undefined) this.logger.result(commands.diagnoseTrace({ path: trace }));
    if (!failed) return 0;
    return sessionLost ? 3 : 1;
  }

  /** Looks for a resource and a SCORM sample in the first few courses. */
  private async locateSamples(
    courses: readonly CourseSummary[],
    found: { contents?: CourseContents; resource?: CourseItem; scorm?: CourseItem },
  ): Promise<void> {
    try {
      for (const course of courses.slice(0, MAX_COURSES_TO_PROBE)) {
        const contents = await this.catalog.contents(course);
        found.resource ??= contents.items.find((item) => item.kind === "resource");
        found.scorm ??= contents.items.find((item) => item.kind === "scorm");
        if (found.resource && found.scorm) return;
      }
    } catch (error) {
      this.tracer.event("warn", "diagnose", "samples.failed", { detail: errorMessage(error) });
    }
  }

  private async attempt(name: string, work: () => Promise<string>): Promise<StepResult> {
    try {
      return { ok: true, detail: await this.tracer.span("diagnose", name, {}, work) };
    } catch (error) {
      return { ok: false, detail: errorMessage(error), authentication: error instanceof AuthenticationError };
    }
  }
}
