import type { Logger, ProgressUpdate } from "../application/ports.ts";

/** Forwards progress to the active screen. */
export class TuiLogger implements Logger {
  private listener: ((update: ProgressUpdate) => void) | undefined;

  onProgress(listener: ((update: ProgressUpdate) => void) | undefined): void {
    this.listener = listener;
  }

  info(_message: string): void {}
  result(_message: string): void {}

  warn(_message: string): void {}

  progress(update: ProgressUpdate): void {
    this.listener?.(update);
  }
}
