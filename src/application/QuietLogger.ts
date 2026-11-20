import type { Logger, ProgressUpdate } from "./ports.ts";

/** Forwards warnings from nested work while the outer batch owns progress. */
export class QuietLogger implements Logger {
  private readonly inner: Logger;

  constructor(deps: { inner: Logger }) {
    this.inner = deps.inner;
  }

  info(_message: string): void {}
  result(_message: string): void {}
  progress(_update: ProgressUpdate): void {}

  warn(message: string): void {
    this.inner.warn(message);
  }
}
