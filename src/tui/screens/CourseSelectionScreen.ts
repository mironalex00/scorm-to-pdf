import type { CourseSummary } from "../../domain/catalog.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { FrameLayout } from "../FrameLayout.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";
import { ListScreen } from "./ListScreen.ts";

export class CourseSelectionScreen implements Screen<readonly CourseSummary[]> {
  private readonly courses: readonly CourseSummary[];
  private readonly marked: Set<string>;
  private readonly list: ListScreen<CourseSummary>;

  constructor(deps: { courses: readonly CourseSummary[]; marked: Set<string>; layout: FrameLayout; messages: Messages }) {
    const { courses, marked, layout, messages: { tui } } = deps;
    this.courses = courses;
    this.marked = marked;
    this.list = new ListScreen({
      title: tui.coursesTitle(),
      footer: tui.keysCourses(),
      items: courses.map((course) => ({
        value: course,
        get label() { return `[${marked.has(course.id) ? "x" : " "}] ${course.name}`; },
      })),
      emptyMessage: tui.noCourses(),
      layout,
    });
  }

  render(size: TerminalSize): string[] {
    return this.list.render(size);
  }

  press(key: KeyPress): ScreenResult<readonly CourseSummary[]> {
    if (key.name === "space") {
      const focused = this.list.press({ name: "enter" });
      if (focused.kind === "done") {
        const id = focused.value.id;
        if (this.marked.has(id)) this.marked.delete(id);
        else this.marked.add(id);
      }
      return { kind: "stay" };
    }
    if (key.name === "char" && key.char === "A") {
      if (this.marked.size === this.courses.length) this.marked.clear();
      else for (const course of this.courses) this.marked.add(course.id);
      return { kind: "stay" };
    }

    const result = this.list.press(key);
    if (result.kind !== "done") return result;
    const chosen = this.marked.size === 0 ? [result.value] : this.courses.filter((course) => this.marked.has(course.id));
    return { kind: "done", value: chosen };
  }
}
