import type { CatalogService } from "../application/CatalogService.ts";
import type { Logger } from "../application/ports.ts";
import { jsonOutput, plainLine } from "../infra/plainText.ts";
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
      this.logger.result(jsonOutput(courses));
    } else {
      for (const course of courses) this.logger.result(`${course.id}\t${plainLine(course.name)}`);
    }
    return 0;
  }
}
