import type { FrameLayout } from "../FrameLayout.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";

const DEFAULT_PAGE = 5;

/** Scrollable confirmation that accepts Enter or any key, depending on the screen. */
export class ReviewScreen implements Screen<true> {
  private readonly title: string;
  private readonly subtitle: string;
  private readonly footer: string;
  private readonly lines: readonly string[];
  private readonly anyKey: boolean;
  private readonly layout: FrameLayout;
  private offset = 0;
  private page = DEFAULT_PAGE;

  constructor(deps: {
    title: string;
    subtitle?: string;
    footer: string;
    lines: readonly string[];
    anyKey: boolean;
    layout: FrameLayout;
  }) {
    this.title = deps.title;
    this.subtitle = deps.subtitle ?? "";
    this.footer = deps.footer;
    this.lines = deps.lines;
    this.anyKey = deps.anyKey;
    this.layout = deps.layout;
  }

  render(size: TerminalSize): string[] {
    this.page = this.layout.bodyHeight(size);
    const body = this.lines.slice(this.offset, this.offset + this.page).map((line) => this.layout.fit(line, size));
    return this.layout.compose({ title: this.title, subtitle: this.subtitle, body, footer: this.footer, size });
  }

  press(key: KeyPress): ScreenResult<true> {
    if (key.name === "ctrl-c") return { kind: "cancel" };
    const maxOffset = Math.max(0, this.lines.length - this.page);
    switch (key.name) {
      case "up":
        this.offset = Math.max(0, this.offset - 1);
        return { kind: "stay" };
      case "down":
        this.offset = Math.min(maxOffset, this.offset + 1);
        return { kind: "stay" };
      case "pageup":
        this.offset = Math.max(0, this.offset - this.page);
        return { kind: "stay" };
      case "pagedown":
        this.offset = Math.min(maxOffset, this.offset + this.page);
        return { kind: "stay" };
      case "home":
        this.offset = 0;
        return { kind: "stay" };
      case "end":
        this.offset = maxOffset;
        return { kind: "stay" };
      default:
        break;
    }
    if (this.anyKey) return { kind: "done", value: true };
    if (key.name === "enter") return { kind: "done", value: true };
    return key.name === "escape" ? { kind: "back" } : { kind: "stay" };
  }
}
