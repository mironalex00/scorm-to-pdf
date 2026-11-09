import type { TerminalSize } from "./Terminal.ts";

const HEADER_LINES = 3;
const FOOTER_LINES = 2;
const MIN_BODY = 3;

/** Marco común de todas las pantallas: título, subtítulo, regla, cuerpo, regla y pie. */
export class FrameLayout {
  private readonly colors: boolean;

  constructor(deps: { colors: boolean }) {
    this.colors = deps.colors;
  }

  bodyHeight(size: TerminalSize): number {
    return Math.max(MIN_BODY, size.rows - HEADER_LINES - FOOTER_LINES);
  }

  compose(input: { title: string; subtitle?: string; body: readonly string[]; footer: string; size: TerminalSize }): string[] {
    const { size } = input;
    const rule = "─".repeat(Math.max(1, size.columns - 1));
    const height = this.bodyHeight(size);
    const body = Array.from({ length: height }, (_, index) => input.body[index] ?? "");
    return [
      this.bold(this.fit(input.title, size)),
      this.fit(input.subtitle ?? "", size),
      rule,
      ...body,
      rule,
      this.fit(input.footer, size),
    ];
  }

  /** Una fila del cuerpo ya ajustada al ancho y, si está elegida, resaltada. */
  row(text: string, size: TerminalSize, selected: boolean): string {
    const fitted = this.fit(text, size);
    return selected ? this.highlight(fitted) : fitted;
  }

  /** Recorta al ancho útil (una columna menos, para no provocar saltos de línea automáticos). */
  fit(text: string, size: TerminalSize): string {
    const limit = Math.max(2, size.columns - 1);
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }

  highlight(text: string): string {
    return this.colors ? `\x1b[7m${text}\x1b[0m` : text;
  }

  bold(text: string): string {
    return this.colors ? `\x1b[1m${text}\x1b[0m` : text;
  }
}
