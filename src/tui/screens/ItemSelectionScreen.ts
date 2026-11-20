import type { CourseItem, Section } from "../../domain/catalog.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { FrameLayout } from "../FrameLayout.ts";
import { ScrollWindow } from "../ScrollWindow.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";

export interface Week {
  readonly section: Section;
  readonly items: readonly CourseItem[];
}

const DEFAULT_PAGE = 5;

/** Selects materials grouped by course section. */
export class ItemSelectionScreen implements Screen<CourseItem[]> {
  private readonly title: string;
  private readonly weeks: readonly Week[];
  private readonly flat: readonly CourseItem[];
  private readonly rows: readonly (string | number)[];
  private readonly itemRows: readonly number[];
  private readonly marked: Set<string>;
  private readonly layout: FrameLayout;
  private readonly messages: Messages;
  private readonly skipEmpty: boolean;
  private readonly position: string | undefined;
  private readonly scroll = new ScrollWindow();
  private cursor = 0;
  private page = DEFAULT_PAGE;
  private notice: string | undefined;

  constructor(deps: { title: string; weeks: readonly Week[]; marked: ReadonlySet<string>; layout: FrameLayout; messages: Messages; skipEmpty?: boolean; position?: string }) {
    this.title = deps.title;
    this.weeks = deps.weeks.filter((week) => week.items.length > 0);
    const flat: CourseItem[] = [];
    const rows: (string | number)[] = [];
    const itemRows: number[] = [];
    for (const { section, items } of this.weeks) {
      rows.push(deps.messages.commands.weekHeading({ number: String(section.number), title: section.title }));
      for (const item of items) {
        itemRows.push(rows.length);
        rows.push(flat.length);
        flat.push(item);
      }
    }
    this.flat = flat;
    this.rows = rows;
    this.itemRows = itemRows;
    this.marked = new Set(deps.marked);
    this.layout = deps.layout;
    this.messages = deps.messages;
    this.skipEmpty = deps.skipEmpty ?? false;
    this.position = deps.position;
  }

  selection(): CourseItem[] {
    return this.flat.filter((item) => this.marked.has(item.id));
  }

  render(size: TerminalSize): string[] {
    this.page = this.layout.bodyHeight(size);
    const { tui, commands } = this.messages;
    if (this.flat.length === 0) {
      const footer = this.skipEmpty ? tui.keysEmptyCourse() : tui.keysList();
      return this.layout.compose({ title: this.title, subtitle: this.position, body: [tui.noItems()], footer, size });
    }

    const { start, end } = this.scroll.window(this.itemRows[this.cursor]!, this.rows.length, this.page);
    const body = this.rows.slice(start, end).map((row) => {
      if (typeof row === "string") return this.layout.row(row, size, false);
      const item = this.flat[row]!;
      const selected = row === this.cursor;
      const kind = item.kind === "scorm" ? commands.kindScorm() : commands.kindResource();
      return this.layout.row(`${selected ? ">" : " "} [${this.marked.has(item.id) ? "x" : " "}] ${item.name}  (${kind})`, size, selected);
    });
    const status = this.notice ?? tui.selectedCount({ count: String(this.marked.size) });
    const subtitle = this.position === undefined ? status : `${this.position} · ${status}`;
    return this.layout.compose({ title: this.title, subtitle, body, footer: tui.keysItems(), size });
  }

  press(key: KeyPress): ScreenResult<CourseItem[]> {
    if (key.name === "ctrl-c") return { kind: "cancel" };
    if (key.name === "escape" || (key.name === "char" && key.char === "q")) return { kind: "back" };
    if (this.flat.length === 0) {
      return this.skipEmpty && key.name === "enter" ? { kind: "done", value: [] } : { kind: "stay" };
    }

    this.notice = undefined;
    const last = this.flat.length - 1;
    switch (key.name) {
      case "up":
        this.cursor = Math.max(0, this.cursor - 1);
        break;
      case "down":
        this.cursor = Math.min(last, this.cursor + 1);
        break;
      case "home":
        this.cursor = 0;
        break;
      case "end":
        this.cursor = last;
        break;
      case "pageup":
        this.cursor = Math.max(0, this.cursor - this.page);
        break;
      case "pagedown":
        this.cursor = Math.min(last, this.cursor + this.page);
        break;
      case "space":
        this.toggle([this.flat[this.cursor]!]);
        break;
      case "char":
        if (key.char === "a") this.toggle(this.weekOf(this.flat[this.cursor]!));
        if (key.char === "A") this.toggle(this.flat);
        break;
      case "enter":
        return this.confirm();
      default:
        break;
    }
    return { kind: "stay" };
  }

  private confirm(): ScreenResult<CourseItem[]> {
    const chosen = this.selection();
    if (chosen.length === 0) {
      this.notice = this.messages.tui.nothingMarked();
      return { kind: "stay" };
    }
    return { kind: "done", value: chosen };
  }

  private weekOf(item: CourseItem): readonly CourseItem[] {
    return this.weeks.find((week) => week.items.includes(item))!.items;
  }

  /** Clears a fully selected group or selects every item in it. */
  private toggle(items: readonly CourseItem[]): void {
    const allMarked = items.every((item) => this.marked.has(item.id));
    for (const item of items) {
      if (allMarked) this.marked.delete(item.id);
      else this.marked.add(item.id);
    }
  }
}
