import type { Logger, ProgressUpdate } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";
import { plainLine, plainOutput } from "./plainText.ts";

export interface OutputStream {
  write(text: string): unknown;
  readonly isTTY?: boolean;
  readonly columns?: number;
  readonly rows?: number;
}

const CLEAR_LINE = "\r\x1b[2K";
const MIN_LABEL_WIDTH = 10;

/** Redraws progress in place on a terminal and prints separate progress lines in a pipe. */
export class ConsoleLogger implements Logger {
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;
  private readonly quiet: boolean;
  private readonly interactive: boolean;
  private readonly messages: Messages;
  private progressLineOpen = false;

  constructor(deps: { stdout: OutputStream; stderr: OutputStream; quiet: boolean; messages: Messages }) {
    this.messages = deps.messages;
    this.stdout = deps.stdout;
    this.stderr = deps.stderr;
    this.quiet = deps.quiet;
    this.interactive = deps.stdout.isTTY === true;
  }

  info(message: string): void {
    if (this.quiet) return;
    this.stdout.write(`${this.takeLine()}${plainLine(message)}\n`);
  }

  result(message: string): void {
    this.stdout.write(`${this.takeLine()}${plainOutput(message)}\n`);
  }

  warn(message: string): void {
    this.stderr.write(`${this.takeLine()}${this.messages.logger.warningPrefix()} ${plainLine(message)}\n`);
  }

  progress(update: ProgressUpdate): void {
    if (this.quiet) return;
    const counter = `[${String(update.done).padStart(String(update.total).length)}/${update.total}]`;
    const label = plainLine(update.label);

    if (!this.interactive) {
      this.stdout.write(`${counter} ${label}\n`);
      return;
    }
    const finished = update.done === update.total;
    this.stdout.write(`${CLEAR_LINE}${counter} ${this.fit(label, counter.length + 1)}${finished ? "\n" : ""}`);
    this.progressLineOpen = !finished;
  }

  /** Clears the progress line before printing a message. */
  private takeLine(): string {
    if (!this.progressLineOpen) return "";
    this.progressLineOpen = false;
    return CLEAR_LINE;
  }

  private fit(label: string, prefixLength: number): string {
    const columns = this.stdout.columns;
    if (columns === undefined) return label;
    const room = Math.max(MIN_LABEL_WIDTH, columns - prefixLength - 2);
    return label.length > room ? `${label.slice(0, room - 1)}…` : label;
  }
}
