import type { CatalogService } from "../application/CatalogService.ts";
import type { CourseResolver } from "../application/CourseResolver.ts";
import type { Logger } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Command } from "./Command.ts";

export class ItemsCommand implements Command {
  private readonly catalog: CatalogService;
  private readonly resolver: CourseResolver;
  private readonly logger: Logger;
  private readonly messages: Messages;
  private readonly query: string;
  private readonly json: boolean;

  constructor(deps: {
    catalog: CatalogService;
    resolver: CourseResolver;
    logger: Logger;
    messages: Messages;
    query: string;
    json: boolean;
  }) {
    this.catalog = deps.catalog;
    this.resolver = deps.resolver;
    this.logger = deps.logger;
    this.messages = deps.messages;
    this.query = deps.query;
    this.json = deps.json;
  }

  async run(): Promise<number> {
    const course = await this.resolver.resolve(this.query);
    const contents = await this.catalog.contents(course);
    const weeks = this.catalog.sectionsOf(contents).map((section) => ({
      ...section,
      items: this.catalog.itemsIn(contents, section.number),
    }));

    if (this.json) {
      this.logger.result(JSON.stringify({ course, weeks }, null, 2));
      return 0;
    }
    const { commands } = this.messages;
    for (const week of weeks) {
      this.logger.result(commands.weekHeading({ number: String(week.number), title: week.title }));
      if (week.items.length === 0) this.logger.result(commands.emptyWeek());
      for (const item of week.items) {
        const kind = item.kind === "scorm" ? commands.kindScorm() : commands.kindResource();
        this.logger.result(commands.itemLine({ kind, id: item.id, name: item.name }));
      }
    }
    return 0;
  }
}
