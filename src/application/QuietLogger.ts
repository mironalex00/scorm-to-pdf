import type { Logger, ProgressUpdate } from "./ports.ts";

/** Deja pasar solo los avisos: para componentes anidados cuyo progreso sería ruido (cada SCORM dentro de un lote). */
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
