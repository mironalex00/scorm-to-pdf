import { UsageError } from "../domain/errors.ts";
import type { CourseSummary } from "../domain/catalog.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { CatalogService } from "./CatalogService.ts";

/** Traduce lo que escribe el usuario («algoritmi» o «101») en un curso concreto, o explica por qué no puede. */
export class CourseResolver {
  private readonly catalog: CatalogService;
  private readonly messages: Messages;

  constructor(deps: { catalog: CatalogService; messages: Messages }) {
    this.catalog = deps.catalog;
    this.messages = deps.messages;
  }

  async resolve(query: string): Promise<CourseSummary> {
    const matches = await this.catalog.find(query);
    if (matches.length === 0) throw new UsageError(this.messages.cli.courseNotFound({ query }));
    if (matches.length > 1) {
      const listed = matches.map((course) => `${course.id} (${course.name})`).join("; ");
      throw new UsageError(this.messages.cli.courseAmbiguous({ query, matches: listed }));
    }
    return matches[0]!;
  }
}
