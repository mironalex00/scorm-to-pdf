import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CourseItem, Section } from "../../src/domain/catalog.ts";
import { es } from "../../src/i18n/es.ts";
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
  it("compone título, subtítulo, cuerpo y pie con el cuerpo rellenado hasta la altura disponible", () => {
    const frame = layout.compose({ title: "Título", subtitle: "sub", body: ["uno", "dos"], footer: "pie", size });
    assert.equal(frame.length, 12 - 5 + 5);
    assert.deepEqual([frame[0], frame[1]], ["Título", "sub"]);
    assert.equal(frame.at(-1), "pie");
    assert.ok(frame[2]!.startsWith("─") && frame.at(-2)!.startsWith("─"));
  });

  it("trunca las líneas largas al ancho con puntos suspensivos y descarta lo que no cabe en el cuerpo", () => {
    const long = "x".repeat(100);
    const frame = layout.compose({ title: long, body: Array.from({ length: 50 }, (_, i) => `fila ${i}`), footer: "", size });
    assert.equal(frame[0], `${"x".repeat(38)}…`);
    assert.equal(frame.length, 12);
  });

  it("con color resalta la fila elegida en vídeo inverso y el título en negrita; sin color no añade secuencias", () => {
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

  it("marca la fila actual y entrega su valor con Enter", () => {
    const screen = make();
    assert.match(screen.render(size).join("\n"), /> Alfa/);
    assert.deepEqual(press(screen, key("down"), key("down"), key("enter")), { kind: "done", value: "Gama" });
  });

  it("no pasa de los extremos y salta con Re Pág, Av Pág, Inicio y Fin", () => {
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

  it("desplaza la ventana para que la fila actual siempre sea visible", () => {
    const screen = make();
    press(screen, key("end"));
    const text = screen.render(size).join("\n");
    assert.ok(text.includes("Kappa") && !text.includes("Alfa"));
  });

  it("Esc y q vuelven; Ctrl+C cancela; otras teclas se ignoran", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), ...chars("q")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), ...chars("z"), key("left")).kind, "stay");
  });

  it("una lista vacía muestra su aviso y Enter no hace nada", () => {
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
  const make = (marked: string[] = []) => new ItemSelectionScreen({ title: "Curso", weeks, marked: new Set(marked), layout, messages: es });
  const text = (screen: ItemSelectionScreen) => screen.render({ columns: 60, rows: 20 }).join("\n");

  it("agrupa los contenidos por semana, de menor a mayor, con su tipo y casillas", () => {
    const rendered = text(make(["b"]));
    assert.ok(rendered.indexOf("Semana 0 — General") < rendered.indexOf("Semana 1 — Semana uno"));
    assert.ok(rendered.includes("Semana 2\n") || rendered.includes("Semana 2 "));
    assert.match(rendered, /\[ \] Programa/);
    assert.match(rendered, /\[x\] Curs 5 {2}\(scorm\)/);
    assert.match(rendered, /\[ \] Ejercicios {2}\(recurso\)/);
    assert.match(rendered, /1 seleccionados/);
  });

  it("Espacio marca y desmarca el contenido bajo el cursor", () => {
    const screen = make();
    press(screen, key("down"), key("space"));
    assert.match(text(screen), /> \[x\] Curs 5/);
    press(screen, key("space"));
    assert.match(text(screen), /> \[ \] Curs 5/);
  });

  it("a marca toda la semana del cursor y, si ya estaba completa, la desmarca; A hace lo mismo con todo", () => {
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

  it("Enter sin nada marcado avisa y se queda; con selección entrega los contenidos en orden", () => {
    const screen = make();
    assert.equal(press(screen, key("enter")).kind, "stay");
    assert.match(text(screen), /Marca al menos un contenido/);
    const result = press(screen, key("down"), key("down"), key("space"), key("up"), key("space"), key("enter"));
    assert.equal(result.kind, "done");
    assert.deepEqual(result.kind === "done" && result.value.map((i) => i.id), ["b", "c"]);
  });

  it("recuerda la selección previa y navega por extremos y páginas", () => {
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

  it("Esc y q vuelven, Ctrl+C cancela, el resto se ignora", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), ...chars("q")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), key("left")).kind, "stay");
  });

  it("un curso sin contenido lo dice y solo permite volver", () => {
    const empty = new ItemSelectionScreen({ title: "Curso", weeks: [], marked: new Set(), layout, messages: es });
    assert.match(text(empty), /no tiene contenido descargable/);
    assert.deepEqual([press(empty, key("enter")).kind, press(empty, key("space")).kind, press(empty, ...chars("a")).kind], ["stay", "stay", "stay"]);
    assert.equal(press(empty, key("escape")).kind, "back");
  });
});

describe("ReviewScreen", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `línea ${i}`);
  const make = (anyKey: boolean) => new ReviewScreen({ title: "Revisar", footer: "pie", lines, anyKey, layout });

  it("Enter acepta, Esc vuelve, Ctrl+C cancela, y se desplaza con las flechas y las páginas", () => {
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

  it("en modo cualquier tecla, cualquiera que no sea de desplazamiento termina", () => {
    assert.equal(press(make(true), key("down")).kind, "stay");
    for (const k of [key("enter"), key("escape"), key("space"), ...chars("x")]) assert.equal(press(make(true), k).kind, "done");
    assert.equal(press(make(true), key("ctrl-c")).kind, "cancel");
  });
});

describe("TextPromptScreen", () => {
  const make = (mask = false, initial = "") => new TextPromptScreen({ title: "Ruta", lines: ["instrucciones"], label: "Ruta:", mask, initial, footer: "pie", layout });

  it("escribe, borra y entrega el texto recortado con Enter", () => {
    const screen = make();
    press(screen, ...chars("mi carpeta  "), key("backspace"), key("backspace"));
    assert.match(screen.render(size).join("\n"), /Ruta: mi carpeta▌/);
    assert.deepEqual(press(screen, key("enter")), { kind: "done", value: "mi carpeta" });
  });

  it("Enter con el campo vacío no acepta; Backspace sobre vacío no falla", () => {
    const screen = make();
    assert.equal(press(screen, key("backspace"), key("enter")).kind, "stay");
  });

  it("parte del valor inicial y muestra las instrucciones", () => {
    const screen = make(false, "./material");
    assert.match(screen.render(size).join("\n"), /instrucciones[\s\S]*Ruta: \.\/material▌/);
  });

  it("con máscara oculta lo escrito y solo muestra cuántos caracteres hay", () => {
    const screen = make(true);
    press(screen, ...chars("secreto"));
    const rendered = screen.render(size).join("\n");
    assert.ok(!rendered.includes("secreto"));
    assert.match(rendered, /Ruta: •{7}▌/);
    press(screen, ...chars("x".repeat(60)));
    assert.match(screen.render({ columns: 80, rows: 12 }).join("\n"), /Ruta: •{40}… \(67\)▌/);
  });

  it("Esc vuelve, Ctrl+C cancela y las teclas de navegación se ignoran", () => {
    assert.equal(press(make(), key("escape")).kind, "back");
    assert.equal(press(make(), key("ctrl-c")).kind, "cancel");
    assert.equal(press(make(), key("up"), key("tab")).kind, "stay");
  });
});
