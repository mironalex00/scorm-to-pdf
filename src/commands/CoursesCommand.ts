import type { CatalogService } from "../application/CatalogService.ts";
import type { Logger } from "../application/ports.ts";
import type { Command } from "./Command.ts";

export class CoursesCommand implements Command {
  private readonly catalog: CatalogService;
  private readonly logger: Logger;
  private readonly json: boolean;

  constructor(deps: { catalog: CatalogService; logger: Logger; json: boolean }) {
    this.catalog = deps.catalog;
    this.logger = deps.logger;
    this.json = deps.json;
  }

  async run(): Promise<number> {
    const courses = await this.catalog.courses();
    if (this.json) {
      this.logger.result(JSON.stringify(courses, null, 2));
    } else {
      for (const course of courses) this.logger.result(`${course.id}\t${course.name}`);
    }
    return 0;
  }
}
