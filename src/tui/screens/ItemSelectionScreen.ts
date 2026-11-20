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

/** Selección múltiple de contenidos agrupados por semana (de menor a mayor). */
export class ItemSelectionScreen implements Screen<CourseItem[]> {
  private readonly title: string;
  private readonly weeks: readonly Week[];
  private readonly flat: readonly CourseItem[];
  private readonly marked: Set<string>;
  private readonly layout: FrameLayout;
  private readonly messages: Messages;
  private readonly skipEmpty: boolean;
  private readonly scroll = new ScrollWindow();
  private cursor = 0;
  private page = DEFAULT_PAGE;
  private notice: string | undefined;

  constructor(deps: { title: string; weeks: readonly Week[]; marked: ReadonlySet<string>; layout: FrameLayout; messages: Messages; skipEmpty?: boolean }) {
    this.title = deps.title;
    this.weeks = deps.weeks.filter((week) => week.items.length > 0);
    this.flat = this.weeks.flatMap((week) => week.items);
    this.marked = new Set(deps.marked);
    this.layout = deps.layout;
    this.messages = deps.messages;
    this.skipEmpty = deps.skipEmpty ?? false;
  }

  render(size: TerminalSize): string[] {
    this.page = this.layout.bodyHeight(size);
    const { tui, commands } = this.messages;
    if (this.flat.length === 0) {
      const footer = this.skipEmpty ? tui.keysEmptyCourse() : tui.keysList();
      return this.layout.compose({ title: this.title, body: [tui.noItems()], footer, size });
    }

    const rows: Array<{ text: string; selected: boolean }> = [];
    let cursorRow = 0;
    let index = 0;
    for (const week of this.weeks) {
      rows.push({ text: commands.weekHeading({ number: String(week.section.number), title: week.section.title }), selected: false });
      for (const item of week.items) {
        const selected = index === this.cursor;
        if (selected) cursorRow = rows.length;
        const kind = item.kind === "scorm" ? commands.kindScorm() : commands.kindResource();
        rows.push({ text: `${selected ? ">" : " "} [${this.marked.has(item.id) ? "x" : " "}] ${item.name}  (${kind})`, selected });
        index += 1;
      }
    }

    const { start, end } = this.scroll.window(cursorRow, rows.length, this.page);
    const body = rows.slice(start, end).map((row) => this.layout.row(row.text, size, row.selected));
    const subtitle = this.notice ?? tui.selectedCount({ count: String(this.marked.size) });
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
    const chosen = this.flat.filter((item) => this.marked.has(item.id));
    if (chosen.length === 0) {
      this.notice = this.messages.tui.nothingMarked();
      return { kind: "stay" };
    }
    return { kind: "done", value: chosen };
  }

  private weekOf(item: CourseItem): readonly CourseItem[] {
    return this.weeks.find((week) => week.items.includes(item))!.items;
  }

  /** Si todos los elementos ya están marcados los desmarca; si no, los marca todos. */
  private toggle(items: readonly CourseItem[]): void {
    const allMarked = items.every((item) => this.marked.has(item.id));
    for (const item of items) {
      if (allMarked) this.marked.delete(item.id);
      else this.marked.add(item.id);
    }
  }
}
