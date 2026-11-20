import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { es } from "../../src/i18n/es.ts";
import { CliParser } from "../../src/cli/CliParser.ts";
import { HelpFormatter } from "../../src/cli/HelpFormatter.ts";
import { UsageError } from "../../src/domain/errors.ts";
import type { CliCommand } from "../../src/cli/commands.ts";

function makeParser(env: Record<string, string | undefined> = {}): CliParser {
  return new CliParser({
    version: "1.2.3",
    env,
    messages: es,
    help: new HelpFormatter({ programName: "scorm-to-pdf", messages: es }),
  });
}

/** Vista plana de la orden heredada (SCORM por ID) para conservar las aserciones históricas. */
function parseRun(argv: string[], env: Record<string, string | undefined> = {}) {
  const command: CliCommand = makeParser(env).parse(argv);
  assert.equal(command.kind, "scorm");
  const scorm = command as Extract<CliCommand, { kind: "scorm" }>;
  return { ...scorm.scorm, ...scorm.global };
}

function parseKind<K extends CliCommand["kind"]>(argv: string[], kind: K, env: Record<string, string | undefined> = {}) {
  const command = makeParser(env).parse(argv);
  assert.equal(command.kind, kind);
  return command as Extract<CliCommand, { kind: K }>;
}

function assertUsageError(argv: string[], pattern: RegExp, env: Record<string, string | undefined> = {}): void {
  assert.throws(
    () => makeParser(env).parse(argv),
    (error: unknown) => error instanceof UsageError && pattern.test(error.message),
    `argv ${JSON.stringify(argv)} debería fallar con ${pattern}`,
  );
}

describe("CliParser · ejecución válida", () => {
  it("solo con el ID aplica todos los valores por defecto", () => {
    const options = parseRun(["10067"]);
    assert.deepEqual(options, {
      scormId: 10067,
      entry: "index.html",
      revision: undefined,
      outPath: undefined,
      outDir: ".",
      platform: undefined,
      baseUrl: undefined,
      lang: undefined,
      concurrency: 6,
      trace: false,
      traceDir: undefined,
      quiet: false,
    });
  });

  it("acepta opciones largas con espacio o con '=' y cortas", () => {
    const options = parseRun(["10067", "--out", "a.pdf", "--concurrency=3", "-q", "--revision", "4", "--entry=deck/start.html"]);
    assert.equal(options.outPath, "a.pdf");
    assert.equal(options.concurrency, 3);
    assert.equal(options.quiet, true);
    assert.equal(options.revision, 4);
    assert.equal(options.entry, "deck/start.html");
  });

  it("acepta flags cortas agrupadas y el ID después de las opciones", () => {
    const options = parseRun(["-qo", "salida.pdf", "10067"]);
    assert.equal(options.quiet, true);
    assert.equal(options.outPath, "salida.pdf");
    assert.equal(options.scormId, 10067);
  });

  it("acepta --out-dir para el nombre automático", () => {
    assert.equal(parseRun(["10067", "-d", "pdfs"]).outDir, "pdfs");
  });

  it("el terminador -- permite pasar el ID como posicional", () => {
    assert.equal(parseRun(["--", "10067"]).scormId, 10067);
  });

  it("MOODLE_BASE_URL cambia la base y --base-url tiene prioridad sobre el entorno", () => {
    const env = { MOODLE_BASE_URL: "https://moodle.example.org/lms" };
    assert.equal(parseRun(["1"], env).baseUrl!.href, "https://moodle.example.org/lms/");
    assert.equal(parseRun(["1", "--base-url", "https://otro.example.org"], env).baseUrl!.href, "https://otro.example.org/");
  });

  it("permite http únicamente en localhost y 127.0.0.1", () => {
    assert.equal(parseRun(["1", "--base-url", "http://localhost:8080"]).baseUrl!.origin, "http://localhost:8080");
    assert.equal(parseRun(["1", "--base-url=http://127.0.0.1:9"]).baseUrl!.origin, "http://127.0.0.1:9");
  });

  it("extrae ID, base, revisión y entrada de una URL de pluginfile", () => {
    const options = parseRun(["https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html"]);
    assert.equal(options.scormId, 10067);
    assert.equal(options.baseUrl!.href, "https://kb.cunbm.utcluj.ro/");
    assert.equal(options.revision, 3);
    assert.equal(options.entry, "index.html");
  });

  it("respeta el prefijo de instalación de Moodle en la URL", () => {
    const options = parseRun(["https://host.example/moodle/pluginfile.php/55/mod_scorm/content/2/deck/start.html"]);
    assert.equal(options.baseUrl!.href, "https://host.example/moodle/");
    assert.equal(options.entry, "deck/start.html");
  });

  it("las opciones explícitas tienen prioridad sobre lo deducido de la URL", () => {
    const options = parseRun([
      "https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html",
      "--revision", "9", "--entry", "otro.html", "--base-url", "https://b.example",
    ]);
    assert.equal(options.revision, 9);
    assert.equal(options.entry, "otro.html");
    assert.equal(options.baseUrl!.origin, "https://b.example");
  });
});

describe("CliParser · ayuda y versión", () => {
  it("--help y -h devuelven el texto del formateador sin exigir el ID", () => {
    const expected = new HelpFormatter({ programName: "scorm-to-pdf", messages: es }).format();
    assert.deepEqual(makeParser().parse(["--help"]), { kind: "help", text: expected });
    assert.deepEqual(makeParser().parse(["-h"]), { kind: "help", text: expected });
  });

  it("--version y -v devuelven programa y versión", () => {
    assert.deepEqual(makeParser().parse(["--version"]), { kind: "version", text: "scorm-to-pdf 1.2.3\n" });
    assert.deepEqual(makeParser().parse(["-v"]), { kind: "version", text: "scorm-to-pdf 1.2.3\n" });
  });

  it("la ayuda tiene prioridad sobre la versión cuando se piden ambas", () => {
    assert.equal(makeParser().parse(["--version", "--help"]).kind, "help");
  });
});

describe("CliParser · errores de uso", () => {
  const cases: Array<[string, string[], RegExp]> = [
    ["más de un posicional", ["1", "2"], /Solo se admite un ID/],
    ["ID no numérico", ["abc"], /ni un ID numérico ni una URL/],
    ["ID cero", ["0"], /ID.*entre 1 y 2147483647/],
    ["ID demasiado grande", ["99999999999"], /ID.*entre 1 y 2147483647/],
    ["URL que no es de pluginfile", ["https://example.com/otra/cosa"], /pluginfile\.php/],
    ["opción desconocida con sugerencia", ["1", "--ot"], /--ot.*¿Quisiste decir --out\?/],
    ["opción de otra orden", ["courses", "--week", "1"], /--week/],
    ["con dos candidatos cercanos sugiere el más parecido", ["1", "--ouit"], /¿Quisiste decir --out\?/],
    ["opción desconocida sin sugerencia", ["1", "--zzzzzz"], /--zzzzzz(?!.*Quisiste)/],
    ["flag corta desconocida", ["1", "-x"], /-x/],
    ["valor ausente al final", ["1", "--out"], /--out.*requiere un valor/],
    ["valor que parece otra opción", ["1", "-o", "--quiet"], /--out.*requiere un valor/],
    ["valor vacío inline", ["1", "--out="], /--out.*requiere un valor/],
    ["flag booleana con valor", ["1", "--quiet=si"], /--quiet.*no admite un valor/],
    ["concurrencia cero", ["1", "-c", "0"], /--concurrency.*entre 1 y 32/],
    ["concurrencia excesiva", ["1", "-c", "33"], /--concurrency.*entre 1 y 32/],
    ["concurrencia no numérica", ["1", "-c", "mucha"], /--concurrency.*«mucha»/],
    ["revisión no numérica", ["1", "--revision=x"], /--revision.*entero/],
    ["--out con --out-dir", ["1", "-o", "a.pdf", "-d", "dir"], /--out.*--out-dir.*a la vez/],
    ["opción repetida", ["1", "-o", "a", "-o", "b"], /--out.*más de una vez/],
    ["entrada con ..", ["1", "--entry", "../x.html"], /--entry/],
    ["entrada absoluta", ["1", "--entry", "/etc/passwd"], /--entry/],
    ["entrada con segmento .", ["1", "--entry", "./a.html"], /--entry/],
    ["entrada con barra doble", ["1", "--entry", "a//b"], /--entry/],
    ["entrada con barra invertida", ["1", "--entry", "a\\b"], /--entry/],
    ["entrada con query", ["1", "--entry", "a.html?x=1"], /--entry/],
    ["base http remota", ["1", "--base-url", "http://moodle.example.org"], /https/],
    ["base que no es URL", ["1", "--base-url", "no es url"], /URL base no válida/],
  ];
  for (const [name, argv, pattern] of cases) {
    it(name, () => assertUsageError(argv, pattern));
  }

  it("un MOODLE_BASE_URL inválido nombra la variable de entorno", () => {
    assertUsageError(["1"], /MOODLE_BASE_URL/, { MOODLE_BASE_URL: "http://moodle.example.org" });
  });
});

describe("CliParser · órdenes", () => {
  it("ascii usa el parser común, incluidos los alias antes de la orden", () => {
    const command = parseKind(
      ["-w", "40.0", "-o", "out.json", "ascii", "input.png", "--bg", "--tone=0", "--fps", "12.5", "--chars=", "-q"],
      "ascii",
      { MOODLE_BASE_URL: "incorrecta", SCORM_PLATFORM: "inexistente" },
    );
    assert.equal(command.request.kind, "convert");
    assert.equal(command.global.quiet, true);
    if (command.request.kind !== "convert") assert.fail("se esperaba una conversión");
    const { input, options } = command.request;
    assert.deepEqual([input, options.cols, options.out, options.bg, options.tone, options.fps, options.chars],
      ["input.png", 40, "out.json", true, 0, 12.5, ""]);
    assert.equal(parseKind(["ascii", "--prepare"], "ascii").request.kind, "prepare");
    assert.match(parseKind(["ascii", "--help"], "help").text, /ascii <entrada>.*--prepare/s);
  });

  it("ascii valida sus argumentos y usa los mismos diagnósticos de opciones", () => {
    assertUsageError(["ascii"], /Falta la imagen/);
    assertUsageError(["ascii", "a.png", "b.png"], /una sola/);
    assertUsageError(["ascii", "--prepare", "a.png"], /--prepare se usa sin entrada/);
    assertUsageError(["ascii", "--prepare", "--loop"], /--prepare se usa sin entrada/);
    assertUsageError(["ascii", "a.png", "--gamma", "Infinity"], /--gamma/);
    assertUsageError(["ascii", "a.png", "--fps", "61"], /--fps/);
    assertUsageError(["ascii", "a.png", "--tone=-1"], /--tone/);
    assertUsageError(["ascii", "a.png", "--cols"], /--cols requiere un valor/);
    assertUsageError(["ascii", "a.png", "--cols=1.5"], /entero entre 1 y 500/);
    assertUsageError(["ascii", "a.png", "--cols=30", "-w", "40"], /--cols se indicó más de una vez/);
    assertUsageError(["ascii", "a.png", "--colx=30"], /¿Quisiste decir --cols/);
  });

  it("sin argumentos o solo con opciones generales abre el selector interactivo", () => {
    assert.equal(parseKind([], "tui").global.quiet, false);
    assert.equal(parseKind(["-q"], "tui").global.quiet, true);
    assert.equal(parseKind(["--trace"], "tui").global.trace, true);
    assert.equal(parseKind(["tui"], "tui").kind, "tui");
  });

  it("courses y diagnose no admiten argumentos; courses acepta --json", () => {
    assert.equal(parseKind(["courses"], "courses").json, false);
    assert.equal(parseKind(["courses", "--json"], "courses").json, true);
    assert.equal(parseKind(["diagnose"], "diagnose").kind, "diagnose");
    assertUsageError(["courses", "extra"], /courses.*no admite argumentos/);
    assertUsageError(["diagnose", "extra"], /diagnose.*no admite argumentos/);
  });

  it("items exige exactamente un curso", () => {
    assert.equal(parseKind(["items", "algoritmi"], "items").course, "algoritmi");
    assert.equal(parseKind(["items", "101", "--json"], "items").json, true);
    assertUsageError(["items"], /Falta el curso.*items/);
    assertUsageError(["items", "a", "b"], /items.*no admite argumentos/);
  });

  it("get selecciona por semanas (ordenadas y sin repetir), por ids o con --all", () => {
    const byWeek = parseKind(["get", "algoritmi", "--week", "3,1,3"], "get");
    assert.deepEqual([byWeek.course, byWeek.weeks, byWeek.items, byWeek.all, byWeek.dest], ["algoritmi", [1, 3], undefined, false, "."]);
    assert.deepEqual(parseKind(["get", "x", "--item", "531, 7"], "get").items, ["7", "531"]);
    assert.equal(parseKind(["get", "x", "--all", "-d", "material"], "get").dest, "material");
    assert.equal(parseKind(["get", "x", "--all", "--dest=otra"], "get").dest, "otra");
    assert.equal(parseKind(["get", "x", "--week", "0"], "get").weeks![0], 0);
  });

  it("get valida la selección", () => {
    assertUsageError(["get", "x"], /nada que descargar/);
    assertUsageError(["get", "x", "--all", "--week", "1"], /--all.*--week/);
    assertUsageError(["get", "x", "--all", "--item", "1"], /--all/);
    assertUsageError(["get"], /Falta el curso.*get/);
    assertUsageError(["get", "x", "--week", "1,,3"], /--week.*lista de números/);
    assertUsageError(["get", "x", "--week", "a"], /--week/);
    assertUsageError(["get", "x", "--item", "1,x"], /--item/);
  });

  it("las opciones generales se leen antes o después de la orden", () => {
    const command = parseKind(["-q", "courses", "--platform", "ro.utcluj.kb", "--lang", "es", "-c", "3", "--trace-dir", "t"], "courses");
    assert.deepEqual(command.global, {
      platform: "ro.utcluj.kb", baseUrl: undefined, lang: "es", concurrency: 3, trace: false, traceDir: "t", quiet: true,
    });
  });

  it("el entorno aporta SCORM_PLATFORM, SCORM_TRACE y MOODLE_BASE_URL; las opciones tienen prioridad", () => {
    const env = { SCORM_PLATFORM: "ro.utcluj.kb", SCORM_TRACE: "1", MOODLE_BASE_URL: "https://m.example.org" };
    const fromEnv = parseKind(["courses"], "courses", env).global;
    assert.deepEqual([fromEnv.platform, fromEnv.trace, fromEnv.baseUrl!.origin], ["ro.utcluj.kb", true, "https://m.example.org"]);
    assert.equal(parseKind(["courses", "--platform", "https://x.example.org"], "courses", env).global.platform, "https://x.example.org");
    assert.equal(parseKind(["courses"], "courses", { SCORM_TRACE: "0" }).global.trace, false);
  });
});
