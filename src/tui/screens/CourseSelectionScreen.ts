import type { CourseSummary } from "../../domain/catalog.ts";
import type { Messages } from "../../i18n/Messages.ts";
import type { FrameLayout } from "../FrameLayout.ts";
import type { KeyPress, Screen, ScreenResult, TerminalSize } from "../Terminal.ts";
import { ListScreen } from "./ListScreen.ts";

export class CourseSelectionScreen implements Screen<readonly CourseSummary[]> {
  private readonly courses: readonly CourseSummary[];
  private readonly marked: Set<string>;
  private readonly withMaterials: ReadonlySet<string>;
  private readonly discardMaterials: (id: string) => void;
  private readonly list: ListScreen<CourseSummary>;
  private readonly messages: Messages["tui"];

  constructor(deps: {
    courses: readonly CourseSummary[];
    marked: Set<string>;
    withMaterials: Set<string>;
    discardMaterials: (id: string) => void;
    layout: FrameLayout;
    messages: Messages;
  }) {
    const { courses, marked, layout, messages: { tui } } = deps;
    this.courses = courses;
    this.marked = marked;
    this.withMaterials = deps.withMaterials;
    this.discardMaterials = (id) => {
      deps.withMaterials.delete(id);
      deps.discardMaterials(id);
    };
    this.messages = tui;
    this.list = new ListScreen({
      title: tui.coursesTitle(),
      footer: tui.keysCourses(),
      items: courses.map((course) => ({
        value: course,
        get label() { return `[${marked.has(course.id) || deps.withMaterials.has(course.id) ? "x" : " "}] ${course.name}`; },
      })),
      emptyMessage: tui.noCourses(),
      layout,
    });
  }

  render(size: TerminalSize): string[] {
    const count = new Set([...this.marked, ...this.withMaterials]).size;
    return this.list.render(size, this.messages.markedCourses({ count: String(count) }));
  }

  press(key: KeyPress): ScreenResult<readonly CourseSummary[]> {
    if (key.name === "space") {
      const focused = this.list.press({ name: "enter" });
      if (focused.kind === "done") {
        const id = focused.value.id;
        if (this.marked.has(id) || this.withMaterials.has(id)) {
          this.marked.delete(id);
          this.discardMaterials(id);
        } else this.marked.add(id);
      }
      return { kind: "stay" };
    }
    if (key.name === "char" && key.char === "A") {
      if (new Set([...this.marked, ...this.withMaterials]).size === this.courses.length) {
        this.marked.clear();
        for (const { id } of this.courses) this.discardMaterials(id);
      } else for (const course of this.courses) this.marked.add(course.id);
      return { kind: "stay" };
    }

    const result = this.list.press(key);
    if (result.kind !== "done") return result;
    const chosen = this.marked.size === 0 ? [result.value] : this.courses.filter((course) => this.marked.has(course.id));
    return { kind: "done", value: chosen };
  }
}
