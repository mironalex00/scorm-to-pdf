import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CourseItem, Section } from "../../src/domain/catalog.ts";
import { en } from "../../src/i18n/en.ts";
import { FrameLayout } from "../../src/tui/FrameLayout.ts";
import { ItemSelectionScreen } from "../../src/tui/screens/ItemSelectionScreen.ts";
import { ListScreen } from "../../src/tui/screens/ListScreen.ts";
import { ReviewScreen } from "../../src/tui/screens/ReviewScreen.ts";
import { TextPromptScreen } from "../../src/tui/screens/TextPromptScreen.ts";
import type { KeyPress, ScreenResult } from "../../src/tui/Terminal.ts";
import { chars, key } from "../support/ScriptedTerminal.ts";

const size = { columns: 40, rows: 12 };
const layout = new FrameLayout({ colors: false });

function press<T>(screen: { press(k: KeyPress): ScreenResult<T> }, ...keys: KeyPress[]): ScreenResult<T> {
  let last: ScreenResult<T> = { kind: "stay" };
  for (const k of keys) last = screen.press(k);
  return last;
}

describe("FrameLayout", () => {
  it("composes the header, body, and footer and fills the available body rows", () => {
    const frame = layout.compose({ title: "Título", subtitle: "sub", body: ["uno", "dos"], footer: "pie", size });
    assert.equal(frame.length, 12 - 5 + 5);
    assert.deepEqual([frame[0], frame[1]], ["Título", "sub"]);
    assert.equal(frame.at(-1), "pie");
    assert.ok(frame[2]!.startsWith("─") && frame.at(-2)!.startsWith("─"));
  });

  it("truncates long lines and limits the body to the available height", () => {
    const long = "x".repeat(100);
    const frame = layout.compose({ title: long, body: Array.from({ length: 50 }, (_, i) => `fila ${i}`), footer: "", size });
    assert.equal(frame[0], `${"x".repeat(38)}…`);
    assert.equal(frame.length, 12);
  });

  it("applies reverse video and bold when color is enabled", () => {
    const colored = new FrameLayout({ colors: true });
    assert.equal(colored.highlight("a"), "\x1b[7ma\x1b[0m");
    assert.equal(colored.bold("a"), "\x1b[1ma\x1b[0m");
    assert.equal(layout.highlight("a"), "a");
    assert.equal(layout.bold("a"), "a");
  });
});

describe("ListScreen", () => {
  const items = ["Alfa", "Beta", "Gama", "Delta", "Épsilon", "Zeta", "Eta", "Theta", "Iota", "Kappa"].map((label) => ({ label, value: label }));
  const make = () => new ListScreen({ title: "Cursos", footer: "pie", items, emptyMessage: "vacío", layout });

  it("highlights the current row and returns its value on Enter", () => {
    const screen = make();
    assert.match(screen.render(size).join("\n"), /> Alfa/);
    assert.deepEqual(press(screen, key("down"), key("down"), key("enter")), { kind: "done", value: "Gama" });
  });

  it("stays within the list bounds and handles page and endpoint navigation", () => {
    const screen = make();
    press(screen, key("up"));
    assert.match(screen.render(size).join("\n"), /> Alfa/);
    press(screen, key("end"));
    assert.match(screen.render(size).join("\n"), /> Kappa/);
    press(screen, key("down"));
    assert.match(screen.render(size).join("\n"), /> Kappa/);
    press(screen, key("home"));
    assert.match(screen.render(size).join("\n"), /> Alfa/);
    press(screen, key("pagedown"));
    assert.match(screen.render(size).join("\n"), /> Theta/);
    press(screen, key("pageup"));
    assert.match(screen.render(size).join("\n"), /> Alfa/);
  });

  it("scrolls to keep the current row visible", () => {
    const screen = make();
    press(screen, key("end"));
    const text = screen.render(size).join("\n");
    assert.ok(text.includes("Kappa") && !text.includes("Alfa"));
  });

  it("goes back on Escape or q and cancels on Ctrl+C", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), ...chars("q")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), ...chars("z"), key("left")).kind, "stay");
  });

  it("shows the empty-list message and ignores Enter", () => {
    const screen = new ListScreen<string>({ title: "t", footer: "f", items: [], emptyMessage: "No hay nada", layout });
    assert.match(screen.render(size).join("\n"), /No hay nada/);
    assert.equal(press(screen, key("enter")).kind, "stay");
  });
});

describe("ItemSelectionScreen", () => {
  const sections: Section[] = [{ number: 0, title: "General" }, { number: 1, title: "Semana uno" }, { number: 2, title: "" }];
  const item = (id: string, name: string, sectionNumber: number, kind: "resource" | "scorm" = "resource"): CourseItem => ({ id, kind, name, url: "u", sectionNumber });
  const weeks = [
    { section: sections[0]!, items: [item("a", "Programa", 0)] },
    { section: sections[1]!, items: [item("b", "Curs 5", 1, "scorm"), item("c", "Ejercicios", 1)] },
    { section: sections[2]!, items: [item("d", "Extra", 2)] },
  ];
  const make = (marked: string[] = []) => new ItemSelectionScreen({ title: "Curso", weeks, marked: new Set(marked), layout, messages: en });
  const text = (screen: ItemSelectionScreen) => screen.render({ columns: 60, rows: 20 }).join("\n");

  it("groups materials by section and shows their types and checkboxes", () => {
    const rendered = text(make(["b"]));
    assert.ok(rendered.indexOf("Section 0 - General") < rendered.indexOf("Section 1 - Semana uno"));
    assert.match(rendered, /^Section 2$/m);
    assert.match(rendered, /\[ \] Programa/);
    assert.match(rendered, /\[x\] Curs 5 {2}\(scorm\)/);
    assert.match(rendered, /\[ \] Ejercicios {2}\(resource\)/);
    assert.match(rendered, /1 selected/);
  });

  it("toggles the current item with Space", () => {
    const screen = make();
    press(screen, key("down"), key("space"));
    assert.match(text(screen), /> \[x\] Curs 5/);
    press(screen, key("space"));
    assert.match(text(screen), /> \[ \] Curs 5/);
  });

  it("toggles all items in the current week with a and all course items with A", () => {
    const screen = make();
    press(screen, key("down"), ...chars("a"));
    assert.match(text(screen), /\[x\] Curs 5[\s\S]*\[x\] Ejercicios/);
    assert.match(text(screen), /\[ \] Programa/);
    press(screen, ...chars("a"));
    assert.match(text(screen), /\[ \] Curs 5[\s\S]*\[ \] Ejercicios/);
    press(screen, ...chars("A"));
    assert.equal((text(screen).match(/\[x\]/g) ?? []).length, 4);
    press(screen, ...chars("A"));
    assert.equal((text(screen).match(/\[x\]/g) ?? []).length, 0);
  });

  it("requires at least one checked item and returns the checked items in order", () => {
    const screen = make();
    assert.equal(press(screen, key("enter")).kind, "stay");
    assert.match(text(screen), /Press Space to select at least one item/);
    const result = press(screen, key("down"), key("down"), key("space"), key("up"), key("space"), key("enter"));
    assert.equal(result.kind, "done");
    assert.deepEqual(result.kind === "done" && result.value.map((i) => i.id), ["b", "c"]);
  });

  it("restores checked items and handles page and endpoint navigation", () => {
    const screen = make(["d"]);
    press(screen, key("end"));
    assert.match(text(screen), /> \[x\] Extra/);
    press(screen, key("home"));
    assert.match(text(screen), /> \[ \] Programa/);
    press(screen, key("pagedown"));
    assert.match(text(screen), /> \[x\] Extra/);
    press(screen, key("pageup"), key("up"));
    assert.match(text(screen), /> \[ \] Programa/);
  });

  it("goes back on Escape or q and cancels on Ctrl+C", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), ...chars("q")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), key("left")).kind, "stay");
  });

  it("shows the empty-course message and allows the user to go back", () => {
    const empty = new ItemSelectionScreen({ title: "Curso", weeks: [], marked: new Set(), layout, messages: en });
    assert.match(text(empty), /has no downloadable materials/);
    assert.deepEqual([press(empty, key("enter")).kind, press(empty, key("space")).kind, press(empty, ...chars("a")).kind], ["stay", "stay", "stay"]);
    assert.equal(press(empty, key("escape")).kind, "back");
  });
});

describe("ReviewScreen", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `línea ${i}`);
  const make = (anyKey: boolean) => new ReviewScreen({ title: "Revisar", footer: "pie", lines, anyKey, layout });

  it("confirms on Enter, goes back on Escape, and handles scrolling and cancellation", () => {
    const screen = make(false);
    assert.ok(!screen.render(size).join("\n").includes("línea 20"));
    press(screen, key("down"), key("pagedown"), key("pagedown"), key("pagedown"), key("pagedown"));
    assert.ok(screen.render(size).join("\n").includes("línea 29"));
    press(screen, key("home"), key("pageup"), key("up"));
    assert.ok(screen.render(size).join("\n").includes("línea 0"));
    press(screen, key("end"));
    assert.ok(screen.render(size).join("\n").includes("línea 29"));
    assert.equal(press(screen, key("enter")).kind, "done");
    assert.equal(press(make(false), key("escape")).kind, "back");
    assert.equal(press(make(false), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(false), key("tab")).kind, "stay");
  });

  it("confirms on a non-scrolling key in any-key mode", () => {
    assert.equal(press(make(true), key("down")).kind, "stay");
    for (const k of [key("enter"), key("escape"), key("space"), ...chars("x")]) assert.equal(press(make(true), k).kind, "done");
    assert.equal(press(make(true), key("ctrl-c")).kind, "cancel");
  });
});

describe("TextPromptScreen", () => {
  const make = (mask = false, initial = "") => new TextPromptScreen({ title: "Ruta", lines: ["instrucciones"], label: "Ruta:", mask, initial, footer: "pie", layout });

  it("accepts text, handles backspace, and trims the submitted value", () => {
    const screen = make();
    press(screen, ...chars("mi carpeta  "), key("backspace"), key("backspace"));
    assert.match(screen.render(size).join("\n"), /Ruta: mi carpeta▌/);
    assert.deepEqual(press(screen, key("enter")), { kind: "done", value: "mi carpeta" });
  });

  it("ignores Enter and Backspace when the field is empty", () => {
    const screen = make();
    assert.equal(press(screen, key("backspace"), key("enter")).kind, "stay");
  });

  it("shows the initial value and instructions", () => {
    const screen = make(false, "./material");
    assert.match(screen.render(size).join("\n"), /instrucciones[\s\S]*Ruta: \.\/material▌/);
  });

  it("masks the entered text and displays its length", () => {
    const screen = make(true);
    press(screen, ...chars("secreto"));
    const rendered = screen.render(size).join("\n");
    assert.ok(!rendered.includes("secreto"));
    assert.match(rendered, /Ruta: •{7}▌/);
    press(screen, ...chars("x".repeat(60)));
    assert.match(screen.render({ columns: 80, rows: 12 }).join("\n"), /Ruta: •{40}… \(67\)▌/);
  });

  it("goes back on Escape, cancels on Ctrl+C, and ignores navigation keys", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), key("up"), key("tab")).kind, "stay");
  });
});
