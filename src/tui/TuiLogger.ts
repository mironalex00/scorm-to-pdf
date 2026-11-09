import type { Logger, ProgressUpdate } from "../application/ports.ts";

/** Registrador de la TUI: nada se imprime (la pantalla es de la TUI); el progreso se reenvía y los avisos se guardan. */
export class TuiLogger implements Logger {
  readonly warnings: string[] = [];
  private listener: ((update: ProgressUpdate) => void) | undefined;

  onProgress(listener: (update: ProgressUpdate) => void): void {
    this.listener = listener;
  }

  info(_message: string): void {}
  result(_message: string): void {}

  warn(message: string): void {
    this.warnings.push(message);
  }

  progress(update: ProgressUpdate): void {
    this.listener?.(update);
  }
}
