import type { CatalogService } from "../application/CatalogService.ts";
import type { BatchDownloader } from "../application/BatchDownloader.ts";
import type { CourseResolver } from "../application/CourseResolver.ts";
import type { ReportPrinter } from "../application/ReportPrinter.ts";
import { UsageError } from "../domain/errors.ts";
import type { CourseContents, CourseItem } from "../domain/catalog.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Command } from "./Command.ts";

export interface Selection {
  readonly all: boolean;
  readonly weeks: readonly number[] | undefined;
  readonly items: readonly string[] | undefined;
}

/** Descarga los contenidos elegidos de un curso (todo, por semanas o por ids) a <destino>/<sección>/. */
export class GetCommand implements Command {
  private readonly catalog: CatalogService;
  private readonly resolver: CourseResolver;
  private readonly batch: BatchDownloader;
  private readonly printer: ReportPrinter;
  private readonly messages: Messages;
  private readonly query: string;
  private readonly selection: Selection;
  private readonly dest: string;

  constructor(deps: {
    catalog: CatalogService;
    resolver: CourseResolver;
    batch: BatchDownloader;
    printer: ReportPrinter;
    messages: Messages;
    query: string;
    selection: Selection;
    dest: string;
  }) {
    this.catalog = deps.catalog;
    this.resolver = deps.resolver;
    this.batch = deps.batch;
    this.printer = deps.printer;
    this.messages = deps.messages;
    this.query = deps.query;
    this.selection = deps.selection;
    this.dest = deps.dest;
  }

  async run(): Promise<number> {
    const course = await this.resolver.resolve(this.query);
    const contents = await this.catalog.contents(course);
    const selected = this.select(contents);
    if (selected.length === 0) throw new UsageError(this.messages.cli.nothingSelected());
    return this.printer.print(await this.batch.run(selected, this.dest, contents.sections));
  }

  private select(contents: CourseContents): CourseItem[] {
    const ordered = this.catalog
      .sectionsOf(contents)
      .flatMap((section) => this.catalog.itemsIn(contents, section.number));
    if (this.selection.all) return ordered;
    return ordered.filter(
      (item) => this.selection.weeks?.includes(item.sectionNumber) || this.selection.items?.includes(item.id),
    );
  }
}
