import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { BatchReport } from "../../src/application/BatchDownloader.ts";
import { CatalogService } from "../../src/application/CatalogService.ts";
import { FileNamer } from "../../src/application/FileNamer.ts";
import type { ItemOutcome } from "../../src/application/ItemDownloader.ts";
import { ReportPrinter } from "../../src/application/ReportPrinter.ts";
import { AuthenticationError, DownloadError } from "../../src/domain/errors.ts";
import type { CourseContents, CourseItem } from "../../src/domain/catalog.ts";
import { es } from "../../src/i18n/es.ts";
import { CompressedStore } from "../../src/store/CompressedStore.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { CookiePrompt } from "../../src/tui/CookiePrompt.ts";
import { FrameLayout } from "../../src/tui/FrameLayout.ts";
import { TuiApplication } from "../../src/tui/TuiApplication.ts";
import { TuiLogger } from "../../src/tui/TuiLogger.ts";
import { FakePlatform } from "../support/FakePlatform.ts";
import { MemoryLogger } from "../support/fakes.ts";
import { ScriptedTerminal, chars, key } from "../support/ScriptedTerminal.ts";
import type { KeyPress } from "../../src/tui/Terminal.ts";
import { CapturedStream } from "../support/streams.ts";

const item = (id: string, name: string, sectionNumber: number, kind: "resource" | "scorm" = "resource"): CourseItem => ({ id, kind, name, url: "u", sectionNumber });
const alfa: CourseContents = { sections: [{ number: 3, title: "Tres" }, { number: 1, title: "Uno" }], items: [item("a", "Tema A", 1), item("b", "Tema B", 1, "scorm"), item("c", "Tema C", 3)] };

function make(keys: KeyPress[], options: { contents?: Record<string, CourseContents | Error>; report?: (items: readonly CourseItem[], logger: TuiLogger) => BatchReport | Promise<BatchReport>; courses?: Array<{ id: string; name: string }>; animate?: boolean } = {}) {
  const platform = new FakePlatform();
  platform.courses = options.courses ?? [{ id: "2", name: "Beta" }, { id: "1", name: "Alfa" }];
  platform.contents = options.contents ?? { "1": alfa, "2": { sections: [], items: [] } };
  const catalog = new CatalogService({ platform, store: new CompressedStore({ redactor: new Redactor() }), locale: "es", tracer: new NullTracer() });
  const terminal = new ScriptedTerminal(keys);
  const logger = new TuiLogger();
  const stdout = new CapturedStream(options.animate);
  const stderr = new CapturedStream();
  const calls: Array<{ items: string[]; dest: string }> = [];
  const batch = {
    run: async (items: readonly CourseItem[], dest: string) => {
      calls.push({ items: items.map((i) => i.id), dest });
      return options.report ? options.report(items, logger) : ok(items);
    },
  };
  const app = new TuiApplication({
    terminal, catalog, batch, logger, messages: es, stdout, stderr, cwd: "carpeta-actual",
    namer: new FileNamer({ fallbackName: "archivo", maxNameBytes: 100 }),
    printer: new ReportPrinter({ logger: new MemoryLogger(), messages: es }),
    layout: new FrameLayout({ colors: false }),
  });
  return { app, terminal, stdout, stderr, calls, platform };
}
const outcomes = (items: readonly CourseItem[]): ItemOutcome[] => items.map((it) => ({ item: it, status: "downloaded", path: `p/${it.id}`, bytes: 1 }));
const ok = (items: readonly CourseItem[]): BatchReport => ({ outcomes: outcomes(items), downloaded: items.length, skipped: 0, failed: 0, aborted: false });

describe("TuiApplication · camino feliz", () => {
  it("curso → contenidos por semana → confirmación → destino actual → descarga → éxito inmediato", async () => {
    const { app, terminal, stdout, stderr, calls } = make([
      key("enter"), // Alfa (primero alfabéticamente)
      key("space"), key("down"), key("space"), // marca Tema A y Tema B
      key("enter"), key("enter"), key("enter"), // continuar, confirmar, carpeta actual
    ]);
    assert.equal(await app.run(), 0);
    assert.deepEqual(calls, [{ items: ["a", "b"], dest: "carpeta-actual/Alfa" }]);
    assert.equal(stdout.output, "✓ Descarga completada: 2 archivos nuevos, 0 ya existían — carpeta-actual\nMulțumesc!\n:)\n");
    assert.equal(stderr.output, "");
    assert.deepEqual([terminal.opened, terminal.closed, terminal.remainingKeys], [1, 1, 0]);

    const frames = terminal.allFrames();
    assert.match(frames, /Cargando cursos…/);
    assert.match(frames, /> \[ \] Alfa\n  \[ \] Beta/);
    assert.match(frames, /Cargando el contenido de «Alfa»…/);
    assert.ok(frames.indexOf("Semana 1 — Uno") < frames.indexOf("Semana 3 — Tres"));
    assert.match(frames, /Confirmar la descarga de 2 contenidos/);
    assert.match(frames, /En la carpeta actual \(/);
    assert.match(frames, /Descargando 0\/2/);
  });

  it("el progreso por contenido se dibuja con el nombre y una barra", async () => {
    const { app, terminal } = make([key("enter"), ...chars("A"), key("enter"), key("enter"), key("enter")], {
      report: (items, logger) => {
        logger.progress({ done: 1, total: items.length, label: "Tema A" });
        return ok(items);
      },
    });
    await app.run();
    assert.match(terminal.allFrames(), /Descargando 1\/3: Tema A\n[\s\S]*█+░+ 1\/3/);
  });

  it("un destino distinto se escribe en una línea y se usa tal cual", async () => {
    const { app, calls } = make([key("enter"), key("space"), key("enter"), key("enter"), key("down"), key("enter"), ...chars("mi material"), key("enter")]);
    assert.equal(await app.run(), 0);
    assert.equal(calls[0]!.dest, "mi material/Alfa");
  });

  it("muestra cuántos se omitieron por existir ya", async () => {
    const { app, stdout } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter")], {
      report: (items) => ({ outcomes: [{ item: items[0]!, status: "skipped", path: "p" }], downloaded: 0, skipped: 1, failed: 0, aborted: false }),
    });
    assert.equal(await app.run(), 0);
    assert.match(stdout.output, /0 archivos nuevos, 1 ya existían/);
  });

  it("anima la sonrisa en la terminal después del agradecimiento", async () => {
    const { app, terminal, stdout } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter")], { animate: true });
    assert.equal(await app.run(), 0);
    assert.equal(terminal.closed, 1);
    const frames = stdout.output.split("Mulțumesc!\n")[1]!.split("\x1b[4A");
    assert.equal(frames.length, 3);
    assert.match(frames[0]!, /- -/);
    assert.match(frames[2]!, /\\_\//);
  });

  it("permite continuar si uno de los cursos elegidos carece de materiales", async () => {
    const { app, terminal, calls } = make([
      ...chars("A"), key("enter"), key("space"), key("enter"),
      key("space"), key("enter"), key("enter"), key("enter"),
    ]);
    assert.equal(await app.run(), 0);
    assert.match(terminal.allFrames(), /Este curso no tiene contenido descargable/);
    assert.deepEqual(calls, [{ items: ["a"], dest: "carpeta-actual/Alfa" }]);
  });

  it("vuelve al selector si ninguno de los cursos elegidos tiene materiales", async () => {
    const empty: CourseContents = { sections: [], items: [] };
    const { app, terminal, calls } = make([
      ...chars("A"), key("enter"), key("enter"), key("enter"), key("escape"),
    ], { contents: { "1": empty, "2": empty } });
    assert.equal(await app.run(), 130);
    assert.match(terminal.lastFrame, /Tus cursos[\s\S]*\[x\] Alfa[\s\S]*\[x\] Beta/);
    assert.deepEqual(calls, []);
  });
});

describe("TuiApplication · navegación", () => {
  it("Esc retrocede paso a paso conservando lo marcado", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("enter"), // elige curso, marca A, a confirmar
      key("escape"), // vuelve a los contenidos
      key("down"), key("space"), key("enter"), // marca también B y confirma
      key("enter"), // confirmar
      key("escape"), // desde el destino, vuelve a confirmar
      key("enter"), key("enter"), // confirma de nuevo y elige la carpeta actual
    ]);
    assert.equal(await app.run(), 0);
    assert.deepEqual(calls[0]!.items, ["a", "b"]);
    assert.match(terminal.allFrames(), /\[x\] Tema A/);
  });

  it("Esc en los contenidos vuelve a la lista de cursos y permite elegir otro", async () => {
    const { app, terminal, calls } = make([key("enter"), key("escape"), key("down"), key("enter"), key("escape"), key("escape")], {
      contents: { "1": alfa, "2": { sections: [{ number: 1, title: "Vacía" }], items: [] } },
    });
    assert.equal(await app.run(), 130);
    assert.match(terminal.allFrames(), /no tiene contenido descargable/);
    assert.deepEqual(calls, []);
  });

  it("en el destino, Esc de la ruta vuelve a la lista y Esc de la lista vuelve a confirmar", async () => {
    const { app, calls } = make([
      key("enter"), key("space"), key("enter"), key("enter"),
      key("down"), key("enter"), key("escape"), // abre la ruta y retrocede a la lista de destinos
      key("escape"), // vuelve a confirmar
      key("enter"), key("enter"), // confirma y elige la carpeta actual
    ]);
    assert.equal(await app.run(), 0);
    assert.equal(calls[0]!.dest, "carpeta-actual/Alfa");
  });

  it("tras confirmar una selección y cambiar de curso, los contenidos empiezan sin marcar", async () => {
    const { app, terminal, calls } = make([
      key("enter"), key("space"), key("enter"), // curso Alfa, marca A, pasa a confirmar
      key("escape"), key("escape"), // vuelve a los contenidos (marcas conservadas) y de ahí a los cursos
      key("enter"), key("enter"), // elige otra vez un curso y pulsa Enter sin marcar nada
      key("ctrl-c"),
    ]);
    assert.equal(await app.run(), 130);
    assert.match(terminal.lastFrame, /Marca al menos un contenido/);
    assert.deepEqual(calls, []);
  });

  it("al elegir otro curso se parte sin marcas del anterior", async () => {
    const { app, calls } = make(
      [key("enter"), key("space"), key("escape"), key("down"), key("enter"), key("escape"), key("home"), key("enter"), key("down"), key("space"), key("enter"), key("enter"), key("enter")],
      { contents: { "1": alfa, "2": { sections: [{ number: 1, title: "S" }], items: [item("z", "Z", 1)] } } },
    );
    assert.equal(await app.run(), 0);
    assert.deepEqual(calls[0]!.items, ["b"]);
  });
});

describe("TuiApplication · cancelación y errores", () => {
  it("Esc o Ctrl+C en cualquier pantalla cancelan con el código 130 y restauran la terminal", async () => {
    for (const script of [[key("escape")], [key("ctrl-c")], [key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("enter"), key("ctrl-c")], [key("enter"), key("space"), key("enter"), key("enter"), key("down"), key("enter"), key("ctrl-c")]]) {
      const { app, terminal, stderr } = make(script);
      assert.equal(await app.run(), 130, JSON.stringify(script));
      assert.equal(stderr.output, "Cancelado.\n");
      assert.equal(terminal.closed, 1);
    }
  });

  it("sin cursos lo dice y Esc sale", async () => {
    const { app, terminal } = make([key("enter"), key("escape")], { courses: [] });
    assert.equal(await app.run(), 130);
    assert.match(terminal.allFrames(), /No hay cursos para mostrar/);
  });

  it("un error al cargar se propaga y la terminal queda restaurada", async () => {
    const { app, terminal } = make([key("enter")], { contents: { "1": new AuthenticationError("sesión"), "2": alfa } });
    await assert.rejects(app.run(), AuthenticationError);
    assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
  });

  it("los fallos se muestran en una pantalla, se imprimen al salir y dan código 1", async () => {
    const failing = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [
        { item: items[0]!, status: "downloaded", path: "p", bytes: 1 },
        { item: items[1]!, status: "failed", error: new DownloadError("sin red"), authentication: false },
      ],
      downloaded: 1, skipped: 0, failed: 1, aborted: false,
    });
    const { app, terminal, stdout, stderr } = make([key("enter"), ...chars("A"), key("enter"), key("enter"), key("enter"), key("space")], { report: failing });
    assert.equal(await app.run(), 1);
    assert.match(terminal.allFrames(), /Hubo errores en la descarga[\s\S]*Fallo en «Tema B»: sin red/);
    assert.match(stderr.output, /Fallo en «Tema B»: sin red[\s\S]*Descargados: 1 · Omitidos: 0 · Fallidos: 1/);
    assert.equal(stdout.output, "");
    assert.equal(terminal.remainingKeys, 0);
  });

  it("una sesión caducada a mitad de lote da código 3 y lo explica", async () => {
    const aborted = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [{ item: items[0]!, status: "failed", error: new AuthenticationError("sesión"), authentication: true }],
      downloaded: 0, skipped: 0, failed: 1, aborted: true,
    });
    const { app, stderr } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter"), key("enter")], { report: aborted });
    assert.equal(await app.run(), 3);
    assert.match(stderr.output, /La sesión caducó/);
  });

  it("Ctrl+C en la pantalla de errores no impide terminar con el código del lote", async () => {
    const failing = (items: readonly CourseItem[]): BatchReport => ({
      outcomes: [{ item: items[0]!, status: "failed", error: new DownloadError("x"), authentication: false }],
      downloaded: 0, skipped: 0, failed: 1, aborted: false,
    });
    const { app } = make([key("enter"), key("space"), key("enter"), key("enter"), key("enter"), key("ctrl-c")], { report: failing });
    assert.equal(await app.run(), 1);
  });
});

describe("CookiePrompt", () => {
  const make2 = (keys: KeyPress[]) => {
    const terminal = new ScriptedTerminal(keys);
    return { terminal, prompt: new CookiePrompt({ terminal, messages: es, layout: new FrameLayout({ colors: false }) }) };
  };

  it("pide la cookie con la entrada oculta, la devuelve y restaura la terminal", async () => {
    const { terminal, prompt } = make2([...chars("MoodleSession=abc123"), key("enter")]);
    assert.equal(await prompt.ask(), "MoodleSession=abc123");
    assert.ok(!terminal.allFrames().includes("abc123"));
    assert.match(terminal.allFrames(), /Falta la cookie de sesión de Moodle[\s\S]*Cookie: •{20}▌/);
    assert.deepEqual([terminal.opened, terminal.closed], [1, 1]);
  });

  it("Esc o Ctrl+C devuelven undefined", async () => {
    assert.equal(await make2([key("escape")]).prompt.ask(), undefined);
    assert.equal(await make2([key("ctrl-c")]).prompt.ask(), undefined);
  });
});
