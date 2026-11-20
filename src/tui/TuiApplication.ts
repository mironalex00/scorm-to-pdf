import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import type { BatchReport } from "../application/BatchDownloader.ts";
import type { CatalogService } from "../application/CatalogService.ts";
import type { FileNamer } from "../application/FileNamer.ts";
import type { ProgressUpdate } from "../application/ports.ts";
import type { ReportPrinter } from "../application/ReportPrinter.ts";
import type { CourseContents, CourseItem, CourseSummary, Section } from "../domain/catalog.ts";
import { errorMessage } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { OutputStream } from "../infra/ConsoleLogger.ts";
import type { FrameLayout } from "./FrameLayout.ts";
import { ScreenRunner } from "./ScreenRunner.ts";
import { CourseSelectionScreen } from "./screens/CourseSelectionScreen.ts";
import { ItemSelectionScreen } from "./screens/ItemSelectionScreen.ts";
import { ListScreen } from "./screens/ListScreen.ts";
import { ReviewScreen } from "./screens/ReviewScreen.ts";
import { TextPromptScreen } from "./screens/TextPromptScreen.ts";
import type { Terminal } from "./Terminal.ts";
import type { TuiLogger } from "./TuiLogger.ts";

export interface ItemBatch {
  run(items: readonly CourseItem[], destRoot: string, sections: readonly Section[]): Promise<BatchReport>;
}

type Step = "course" | "items" | "confirm" | "destination";
interface CourseSelection {
  readonly course: CourseSummary;
  readonly sections: readonly Section[];
  readonly items: readonly CourseItem[];
}
type Outcome = { kind: "cancelled" } | { kind: "finished"; report: BatchReport; dest: string };
type Destination = { kind: "cancelled" } | { kind: "back" } | { kind: "path"; path: string };

const CANCELLED_EXIT_CODE = 130;
const BAR_WIDTH = 30;
const CAT_EARS = [
  "          /\\                        /\\",
  "         /  \\__                  __/  \\",
  "        / /\\   \\________________/   /\\ \\",
  "       / /  '.                    .'  \\ \\",
  "      | /     '.                .'     \\ |",
  "      |/                                \\|",
  "      /                                  \\",
];
const CAT_MUZZLE = [
  "  ---+----             (__)            ----+---",
  "   --+---              /  \\             ---+--",
  "      \\          ._   /    \\   _.          /",
  "       '.          '--'    '--'          .'",
  "         '-._                         _.-'",
  "             '-------._______.-------'",
];
const CAT_EYES = [
  [
    "     |        .-\"\"\"-.        .-\"\"\"-.      |",
    "     |        (  o  )        (  o  )      |",
    "     |         '-.-'    /\\    '-.-'       |",
  ],
  [
    "     |        .-----.        .-\"\"\"-.      |",
    "     |        ( _._ )        (  o  )      |",
    "     |                  /\\    '-.-'       |",
  ],
  [
    "     |        _     _        .-\"\"\"-.      |",
    "     |         >---<         (  o  )      |",
    "     |                  /\\    '-.-'       |",
  ],
];

/**
 * Selección de cursos y de contenidos por curso, seguida de una confirmación y un destino comunes.
 */
export class TuiApplication {
  private readonly terminal: Terminal;
  private readonly runner: ScreenRunner;
  private readonly catalog: CatalogService;
  private readonly batch: ItemBatch;
  private readonly namer: FileNamer;
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
    namer: FileNamer;
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
    this.namer = deps.namer;
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
      if (outcome.kind === "finished" && outcome.report.failed === 0 && !outcome.report.aborted) {
        await this.farewell();
      }
    } finally {
      this.terminal.close();
    }
    return this.finish(outcome);
  }

  private async flow(): Promise<Outcome> {
    const { tui } = this.messages;
    const courses = await this.loading(tui.loadingCourses(), () => this.catalog.courses());
    const folders = this.namer.directoryNames(courses.map((course) => [course.id, course.name]));
    const markedCourses = new Set<string>();
    const selections = new Map<string, CourseSelection>();
    let step: Step = "course";
    let chosen: readonly CourseSummary[] = [];
    let courseIndex = 0;
    let selected: CourseSelection[] = [];

    for (;;) {
      if (step === "course") {
        const result = await this.runner.run(new CourseSelectionScreen({
          courses, marked: markedCourses, layout: this.layout, messages: this.messages,
        }));
        if (result.kind !== "done") return { kind: "cancelled" };
        chosen = result.value;
        courseIndex = 0;
        step = "items";
      } else if (step === "items") {
        const course = chosen[courseIndex]!;
        const contents = await this.loading(tui.loadingContents({ course: course.name }), () => this.catalog.contents(course));
        const previous = selections.get(course.id)?.items ?? [];
        const marked = new Set(previous.map((item) => item.id));
        const position = chosen.length > 1
          ? tui.coursePosition({ current: String(courseIndex + 1), total: String(chosen.length) })
          : undefined;
        const screen = this.itemsScreen(course, contents, marked, position);
        const result = await this.runner.run(screen);
        if (result.kind === "cancel") return { kind: "cancelled" };
        selections.set(course.id, {
          course,
          sections: this.catalog.sectionsOf(contents),
          items: result.kind === "back" ? screen.selection() : result.value,
        });
        if (result.kind === "back") {
          if (courseIndex === 0) step = "course";
          else courseIndex -= 1;
        } else {
          if (courseIndex < chosen.length - 1) {
            courseIndex += 1;
          } else {
            selected = chosen.map(({ id }) => selections.get(id)!).filter(({ items }) => items.length > 0);
            step = selected.length === 0 ? "course" : "confirm";
          }
        }
      } else if (step === "confirm") {
        const result = await this.runner.run(this.confirmScreen(selected));
        if (result.kind === "cancel") return { kind: "cancelled" };
        step = result.kind === "back" ? "items" : "destination";
      } else {
        const destination = await this.chooseDestination();
        if (destination.kind === "cancelled") return destination;
        if (destination.kind === "back") step = "confirm";
        else return this.download(selected, destination.path, folders);
      }
    }
  }

  private itemsScreen(course: CourseSummary, contents: CourseContents, marked: ReadonlySet<string>, position: string | undefined): ItemSelectionScreen {
    const weeks = this.catalog
      .sectionsOf(contents)
      .map((section) => ({ section, items: this.catalog.itemsIn(contents, section.number) }));
    return new ItemSelectionScreen({
      title: this.messages.tui.itemsTitle({ course: course.name }),
      weeks,
      marked,
      skipEmpty: position !== undefined,
      position,
      layout: this.layout,
      messages: this.messages,
    });
  }

  private confirmScreen(selected: readonly CourseSelection[]): ReviewScreen {
    const { tui, commands } = this.messages;
    const lines: string[] = [];
    for (const { course, sections, items } of selected) {
      lines.push(course.name);
      for (const section of sections) {
        const sectionItems = items.filter((item) => item.sectionNumber === section.number);
        if (sectionItems.length === 0) continue;
        lines.push(commands.weekHeading({ number: String(section.number), title: section.title }));
        for (const item of sectionItems) lines.push(`  ${item.name}`);
      }
    }
    return new ReviewScreen({
      title: tui.confirmTitle({ count: String(this.totalItems(selected)) }),
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

  private totalItems(selected: readonly CourseSelection[]): number {
    return selected.reduce((total, selection) => total + selection.items.length, 0);
  }

  private async download(selected: readonly CourseSelection[], dest: string, folders: ReadonlyMap<string, string>): Promise<Outcome> {
    const total = this.totalItems(selected);
    const outcomes: BatchReport["outcomes"] = [];
    let downloaded = 0;
    let skipped = 0;
    let failed = 0;
    let aborted = false;
    this.logger.onProgress((update) => this.showProgress({ ...update, done: outcomes.length + update.done, total }));
    this.showProgress({ done: 0, total, label: "" });
    for (const { course, sections, items } of selected) {
      const result = await this.batch.run(items, join(dest, folders.get(course.id)!), sections);
      outcomes.push(...result.outcomes);
      downloaded += result.downloaded;
      skipped += result.skipped;
      failed += result.failed;
      aborted = result.aborted;
      if (aborted) break;
    }
    const report = { outcomes, downloaded, skipped, failed, aborted };
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

  private async farewell(): Promise<void> {
    for (const [index, eyes] of CAT_EYES.entries()) {
      const frame = [...CAT_EARS, ...eyes, ...CAT_MUZZLE];
      const size = this.terminal.size();
      const rows = this.layout.bodyHeight(size);
      const columns = Math.max(2, size.columns - 1);
      const width = Math.max(...frame.map((line) => line.length));
      const top = Math.max(0, Math.floor((rows - frame.length) / 2));
      const cropRow = Math.max(0, Math.floor((frame.length - rows) / 2));
      const cropColumn = Math.max(0, Math.floor((width - columns) / 2));
      const indent = " ".repeat(Math.max(0, Math.floor((columns - width) / 2)));
      this.terminal.render(this.layout.compose({
        title: this.messages.tui.farewell(),
        body: [
          ...Array<string>(top).fill(""),
          ...frame.slice(cropRow, cropRow + rows).map((line) => indent + line.slice(cropColumn, cropColumn + columns)),
        ],
        footer: "",
        size,
      }));
      await setTimeout(index === CAT_EYES.length - 1 ? 760 : 175);
    }
  }
}
