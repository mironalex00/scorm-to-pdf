import type { FrameLayout } from "../FrameLayout.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";

const MAX_MASKED = 40;

/** Reads a single line and masks the value for session cookies. */
export class TextPromptScreen implements Screen<string> {
  private readonly title: string;
  private readonly lines: readonly string[];
  private readonly label: string;
  private readonly mask: boolean;
  private readonly footer: string;
  private readonly layout: FrameLayout;
  private value: string;

  constructor(deps: {
    title: string;
    lines: readonly string[];
    label: string;
    mask: boolean;
    initial: string;
    footer: string;
    layout: FrameLayout;
  }) {
    this.title = deps.title;
    this.lines = deps.lines;
    this.label = deps.label;
    this.mask = deps.mask;
    this.footer = deps.footer;
    this.layout = deps.layout;
    this.value = deps.initial;
  }

  render(size: TerminalSize): string[] {
    const body = [...this.lines.map((line) => this.layout.fit(line, size)), "", this.layout.fit(`${this.label} ${this.shown()}▌`, size)];
    return this.layout.compose({ title: this.title, body, footer: this.footer, size });
  }

  press(key: KeyPress): ScreenResult<string> {
    switch (key.name) {
      case "ctrl-c":
        return { kind: "cancel" };
      case "escape":
        return { kind: "back" };
      case "enter":
        return this.value.trim() === "" ? { kind: "stay" } : { kind: "done", value: this.value.trim() };
      case "backspace":
        this.value = this.value.slice(0, -1);
        break;
      case "space":
        this.value += " ";
        break;
      case "char":
        this.value += key.char!;
        break;
      default:
        break;
    }
    return { kind: "stay" };
  }

  private shown(): string {
    if (!this.mask) return this.value;
    const length = this.value.length;
    return length <= MAX_MASKED ? "•".repeat(length) : `${"•".repeat(MAX_MASKED)}… (${length})`;
  }
}
