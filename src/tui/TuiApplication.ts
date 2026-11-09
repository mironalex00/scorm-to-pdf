import { resolve } from "node:path";
import type { BatchReport } from "../application/BatchDownloader.ts";
import type { CatalogService } from "../application/CatalogService.ts";
import type { ProgressUpdate } from "../application/ports.ts";
import type { ReportPrinter } from "../application/ReportPrinter.ts";
import type { CourseContents, CourseItem, CourseSummary } from "../domain/catalog.ts";
import { errorMessage } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { OutputStream } from "../infra/ConsoleLogger.ts";
import type { FrameLayout } from "./FrameLayout.ts";
import { ScreenRunner } from "./ScreenRunner.ts";
import { ItemSelectionScreen } from "./screens/ItemSelectionScreen.ts";
import { ListScreen } from "./screens/ListScreen.ts";
import { ReviewScreen } from "./screens/ReviewScreen.ts";
import { TextPromptScreen } from "./screens/TextPromptScreen.ts";
import type { Terminal } from "./Terminal.ts";
import type { TuiLogger } from "./TuiLogger.ts";

export interface ItemBatch {
  run(items: readonly CourseItem[], destRoot: string): Promise<BatchReport>;
}

type Step = "course" | "items" | "confirm" | "destination";
type Outcome = { kind: "cancelled" } | { kind: "finished"; report: BatchReport; dest: string };
type Destination = { kind: "cancelled" } | { kind: "back" } | { kind: "path"; path: string };

const CANCELLED_EXIT_CODE = 130;
const BAR_WIDTH = 30;

/**
 * Flujo interactivo: curso → contenidos por semana → confirmación → destino → descarga.
 * Cada Esc retrocede un paso conservando lo marcado; Ctrl+C cancela. Si todo sale bien, la terminal
 * se restaura y solo queda el mensaje de éxito; si algo falla, se muestran los errores antes de salir.
 */
export class TuiApplication {
  private readonly terminal: Terminal;
  private readonly runner: ScreenRunner;
  private readonly catalog: CatalogService;
  private readonly batch: ItemBatch;
  private readonly logger: TuiLogger;
  private readonly printer: ReportPrinter;
  private readonly messages: Messages;
  private readonly layout: FrameLayout;
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;
  private readonly cwd: string;

  constructor(deps: {
    terminal: Terminal;
    catalog: CatalogService;
    batch: ItemBatch;
    logger: TuiLogger;
    printer: ReportPrinter;
    messages: Messages;
    layout: FrameLayout;
    stdout: OutputStream;
    stderr: OutputStream;
    cwd: string;
  }) {
    this.terminal = deps.terminal;
    this.runner = new ScreenRunner({ terminal: deps.terminal });
    this.catalog = deps.catalog;
    this.batch = deps.batch;
    this.logger = deps.logger;
    this.printer = deps.printer;
    this.messages = deps.messages;
    this.layout = deps.layout;
    this.stdout = deps.stdout;
    this.stderr = deps.stderr;
    this.cwd = deps.cwd;
  }

  async run(): Promise<number> {
    this.terminal.open();
    let outcome: Outcome;
    try {
      outcome = await this.flow();
    } finally {
      this.terminal.close();
    }
    return this.finish(outcome);
  }

  private async flow(): Promise<Outcome> {
    const { tui } = this.messages;
    const courses = await this.loading(tui.loadingCourses(), () => this.catalog.courses());
    let step: Step = "course";
    let course: CourseSummary = courses[0]!;
    let contents: CourseContents = { sections: [], items: [] };
    let marked = new Set<string>();
    let selected: CourseItem[] = [];

    for (;;) {
      if (step === "course") {
        const result = await this.runner.run(this.coursesScreen(courses));
        if (result.kind !== "done") return { kind: "cancelled" };
        course = result.value;
        contents = await this.loading(tui.loadingContents({ course: course.name }), () => this.catalog.contents(course));
        marked = new Set();
        step = "items";
      } else if (step === "items") {
        const result = await this.runner.run(this.itemsScreen(course, contents, marked));
        if (result.kind === "cancel") return { kind: "cancelled" };
        if (result.kind === "back") {
          step = "course";
        } else {
          selected = result.value;
          marked = new Set(selected.map((item) => item.id));
          step = "confirm";
        }
      } else if (step === "confirm") {
        const result = await this.runner.run(this.confirmScreen(selected));
        if (result.kind === "cancel") return { kind: "cancelled" };
        step = result.kind === "back" ? "items" : "destination";
      } else {
        const destination = await this.chooseDestination();
        if (destination.kind === "cancelled") return destination;
        if (destination.kind === "back") step = "confirm";
        else return this.download(selected, destination.path);
      }
    }
  }

  private coursesScreen(courses: readonly CourseSummary[]): ListScreen<CourseSummary> {
    const { tui } = this.messages;
    return new ListScreen({
      title: tui.coursesTitle(),
      footer: tui.keysList(),
      items: courses.map((course) => ({ label: course.name, value: course })),
      emptyMessage: tui.noCourses(),
      layout: this.layout,
    });
  }

  private itemsScreen(course: CourseSummary, contents: CourseContents, marked: ReadonlySet<string>): ItemSelectionScreen {
    const weeks = this.catalog
      .sectionsOf(contents)
      .map((section) => ({ section, items: this.catalog.itemsIn(contents, section.number) }));
    return new ItemSelectionScreen({
      title: this.messages.tui.itemsTitle({ course: course.name }),
      weeks,
      marked,
      layout: this.layout,
      messages: this.messages,
    });
  }

  private confirmScreen(selected: readonly CourseItem[]): ReviewScreen {
    const { tui, commands } = this.messages;
    const lines: string[] = [];
    const numbers = [...new Set(selected.map((item) => item.sectionNumber))].sort((a, b) => a - b);
    for (const number of numbers) {
      lines.push(commands.weekHeading({ number: String(number), title: "" }));
      for (const item of selected.filter((candidate) => candidate.sectionNumber === number)) lines.push(`  ${item.name}`);
    }
    return new ReviewScreen({
      title: tui.confirmTitle({ count: String(selected.length) }),
      footer: tui.keysConfirm(),
      lines,
      anyKey: false,
      layout: this.layout,
    });
  }

  private async chooseDestination(): Promise<Destination> {
    const { tui } = this.messages;
    const list = new ListScreen<"current" | "other">({
      title: tui.destinationTitle(),
      footer: tui.keysPrompt(),
      emptyMessage: "",
      layout: this.layout,
      items: [
        { label: tui.destinationCurrent({ path: resolve(this.cwd) }), value: "current" },
        { label: tui.destinationOther(), value: "other" },
      ],
    });
    for (;;) {
      const choice = await this.runner.run(list);
      if (choice.kind === "cancel") return { kind: "cancelled" };
      if (choice.kind === "back") return { kind: "back" };
      if (choice.value === "current") return { kind: "path", path: this.cwd };

      const typed = await this.runner.run(
        new TextPromptScreen({
          title: tui.pathTitle(),
          lines: [],
          label: tui.pathLabel(),
          mask: false,
          initial: "",
          footer: tui.keysPrompt(),
          layout: this.layout,
        }),
      );
      if (typed.kind === "cancel") return { kind: "cancelled" };
      if (typed.kind === "done") return { kind: "path", path: typed.value };
    }
  }

  private async download(selected: readonly CourseItem[], dest: string): Promise<Outcome> {
    this.logger.onProgress((update) => this.showProgress(update));
    this.showProgress({ done: 0, total: selected.length, label: "" });
    const report = await this.batch.run(selected, dest);
    if (report.failed > 0 || report.aborted) await this.runner.run(this.errorsScreen(report));
    return { kind: "finished", report, dest };
  }

  private showProgress(update: ProgressUpdate): void {
    const size = this.terminal.size();
    const width = Math.min(BAR_WIDTH, Math.max(5, size.columns - 12));
    // La selección nunca está vacía (la pantalla de contenidos lo exige), así que el total es >= 1.
    const filled = Math.floor((update.done / update.total) * width);
    const bar = `${"█".repeat(filled)}${"░".repeat(width - filled)} ${update.done}/${update.total}`;
    this.terminal.render(
      this.layout.compose({
        title: this.messages.tui.downloading({ done: String(update.done), total: String(update.total), label: update.label }),
        body: [bar],
        footer: "",
        size,
      }),
    );
  }

  private errorsScreen(report: BatchReport): ReviewScreen {
    return new ReviewScreen({
      title: this.messages.tui.errorsTitle(),
      footer: this.messages.tui.keysMessage(),
      lines: this.failureLines(report),
      anyKey: true,
      layout: this.layout,
    });
  }

  private failureLines(report: BatchReport): string[] {
    const { commands } = this.messages;
    const lines = report.outcomes.flatMap((outcome) =>
      outcome.status === "failed" ? [commands.failed({ name: outcome.item.name, detail: errorMessage(outcome.error) })] : [],
    );
    if (report.aborted) lines.push(commands.abortedBySession());
    return lines;
  }

  private async loading<T>(message: string, work: () => Promise<T>): Promise<T> {
    this.terminal.render(this.layout.compose({ title: message, body: [], footer: "", size: this.terminal.size() }));
    return work();
  }

  private finish(outcome: Outcome): number {
    const { tui, commands } = this.messages;
    if (outcome.kind === "cancelled") {
      this.stderr.write(`${tui.cancelled()}\n`);
      return CANCELLED_EXIT_CODE;
    }
    const { report, dest } = outcome;
    if (report.failed === 0 && !report.aborted) {
      this.stdout.write(`${tui.success({ downloaded: String(report.downloaded), skipped: String(report.skipped), dest })}\n`);
      return 0;
    }
    for (const line of this.failureLines(report)) this.stderr.write(`${line}\n`);
    this.stderr.write(
      `${commands.summary({ downloaded: String(report.downloaded), skipped: String(report.skipped), failed: String(report.failed) })}\n`,
    );
    return this.printer.exitCode(report);
  }
}
