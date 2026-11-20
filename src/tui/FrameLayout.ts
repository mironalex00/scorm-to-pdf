import { plainLine } from "../infra/plainText.ts";
import type { TerminalSize } from "./Terminal.ts";

const HEADER_LINES = 3;
const FOOTER_LINES = 2;
const MIN_BODY = 3;

/** Shared layout for the interactive screens. */
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

  /** Fits a row and highlights it when selected. */
  row(text: string, size: TerminalSize, selected: boolean): string {
    const fitted = this.fit(text, size);
    return selected ? this.highlight(fitted) : fitted;
  }

  /** Leaves one column free to avoid automatic line wrapping. */
  fit(text: string, size: TerminalSize): string {
    const limit = Math.max(2, size.columns - 1);
    const plain = plainLine(text);
    return plain.length > limit ? `${plain.slice(0, limit - 1)}…` : plain;
  }

  highlight(text: string): string {
    return this.colors ? `\x1b[7m${text}\x1b[0m` : text;
  }

  bold(text: string): string {
    return this.colors ? `\x1b[1m${text}\x1b[0m` : text;
  }
}
