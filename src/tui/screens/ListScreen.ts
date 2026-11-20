import type { FrameLayout } from "../FrameLayout.ts";
import { ScrollWindow } from "../ScrollWindow.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";

export interface ListItem<T> {
  readonly label: string;
  readonly value: T;
}

const DEFAULT_PAGE = 5;

/** Elección de un elemento entre varios, con desplazamiento. */
export class ListScreen<T> implements Screen<T> {
  private readonly title: string;
  private readonly subtitle: string;
  private readonly footer: string;
  private readonly items: readonly ListItem<T>[];
  private readonly emptyMessage: string;
  private readonly layout: FrameLayout;
  private readonly scroll = new ScrollWindow();
  private cursor = 0;
  private page = DEFAULT_PAGE;

  constructor(deps: {
    title: string;
    subtitle?: string;
    footer: string;
    items: readonly ListItem<T>[];
    emptyMessage: string;
    layout: FrameLayout;
  }) {
    this.title = deps.title;
    this.subtitle = deps.subtitle ?? "";
    this.footer = deps.footer;
    this.items = deps.items;
    this.emptyMessage = deps.emptyMessage;
    this.layout = deps.layout;
  }

  render(size: TerminalSize, subtitle = this.subtitle): string[] {
    this.page = this.layout.bodyHeight(size);
    const body =
      this.items.length === 0
        ? [this.emptyMessage]
        : this.visibleRows(size);
    return this.layout.compose({ title: this.title, subtitle, body, footer: this.footer, size });
  }

  press(key: KeyPress): ScreenResult<T> {
    const last = this.items.length - 1;
    switch (key.name) {
      case "ctrl-c":
        return { kind: "cancel" };
      case "escape":
        return { kind: "back" };
      case "enter":
        return this.items.length === 0 ? { kind: "stay" } : { kind: "done", value: this.items[this.cursor]!.value };
      case "up":
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case "down":
        this.cursor = Math.min(Math.max(0, last), this.cursor + 1);
        break;
      case "home":
        this.cursor = 0;
        break;
      case "end":
        this.cursor = Math.max(0, last);
        break;
      case "pageup":
        this.cursor = Math.max(0, this.cursor - this.page);
        break;
      case "pagedown":
        this.cursor = Math.min(Math.max(0, last), this.cursor + this.page);
        break;
      case "char":
        if (key.char === "q") return { kind: "back" };
        break;
      default:
        break;
    }
    return { kind: "stay" };
  }

  private visibleRows(size: TerminalSize): string[] {
    const { start, end } = this.scroll.window(this.cursor, this.items.length, this.layout.bodyHeight(size));
    return this.items
      .slice(start, end)
      .map((item, offset) => {
        const selected = start + offset === this.cursor;
        return this.layout.row(`${selected ? ">" : " "} ${item.label}`, size, selected);
      });
  }
}
