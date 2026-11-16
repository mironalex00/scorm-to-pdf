import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliApplication } from "../../src/CliApplication.ts";
import { VERSION } from "../../src/version.ts";
import type { HttpClient } from "../../src/application/ports.ts";
import { FakeMoodle } from "../support/FakeMoodle.ts";
import type { LocalServer } from "../support/LocalServer.ts";
import { CapturedStream } from "../support/streams.ts";

const COOKIE = "abc123";
let moodle: LocalServer;
let outDir: string;
let traceRoot: string;

before(async () => {
  moodle = await FakeMoodle.start({
    scormId: 10067,
    revision: 3,
    title: "AFSD · Curs 5. Funcții și descompunerea problemelor",
    slideCount: 3,
    validCookie: COOKIE,
  });
});
after(() => moodle.close());
beforeEach(async () => {
  outDir = await mkdtemp(join(tmpdir(), "scorm-e2e-"));
  traceRoot = await mkdtemp(join(tmpdir(), "scorm-e2e-trace-"));
});
afterEach(() => Promise.all([rm(outDir, { recursive: true, force: true }), rm(traceRoot, { recursive: true, force: true })]));

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(argv: string[], env: Record<string, string | undefined> = {}, http?: HttpClient): Promise<RunResult> {
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, ...env }, stdout, stderr, http, cwd: traceRoot });
  const code = await app.run(argv);
  return { code, stdout: stdout.output, stderr: stderr.output };
}

const baseArgs = () => ["10067", "--base-url", moodle.origin, "--out-dir", outDir];

describe("CliApplication · éxito con solo el ID", () => {
  it("detecta la revisión, descarga, genera el PDF con nombre automático y devuelve su ruta", async () => {
    const { code, stdout, stderr } = await run(baseArgs());
    const expected = join(outDir, "AFSD-Curs-5.pdf");

    assert.equal(code, 0, stderr);
    assert.equal(stderr, "");
    assert.deepEqual(await readdir(outDir), ["AFSD-Curs-5.pdf"]);
    const pdf = (await readFile(expected)).toString("latin1");
    assert.ok(pdf.startsWith("%PDF-1.4"));
    assert.match(pdf, /\/Count 3 >>/);

    const lines = stdout.trimEnd().split("\n");
    assert.equal(lines.at(-1), expected);
    assert.match(stdout, /revisión 3/);
    assert.match(stdout, /Listo: 3 páginas/);
  });

  it("también acepta la URL completa de pluginfile.php en lugar del ID", async () => {
    const url = `${moodle.origin}/pluginfile.php/10067/mod_scorm/content/3/index.html`;
    const { code } = await run([url, "-o", join(outDir, "desde-url.pdf"), "-q"]);
    assert.equal(code, 0);
    assert.deepEqual(await readdir(outDir), ["desde-url.pdf"]);
  });

  it("--quiet imprime únicamente la ruta del PDF", async () => {
    const { code, stdout } = await run([...baseArgs(), "-q"]);
    assert.equal(code, 0);
    assert.equal(stdout, `${join(outDir, "AFSD-Curs-5.pdf")}\n`);
  });

  it("MOODLE_BASE_URL sustituye a --base-url", async () => {
    const { code } = await run(["10067", "--out-dir", outDir, "-q"], { MOODLE_BASE_URL: moodle.origin });
    assert.equal(code, 0);
  });
});

describe("CliApplication · ayuda y versión", () => {
  it("--help imprime el uso y sale con 0 sin necesitar cookie", async () => {
    const { code, stdout } = await run(["--help"], { MOODLE_COOKIE: undefined });
    assert.equal(code, 0);
    assert.match(stdout, /^Uso: scorm-to-pdf \[orden\] \[opciones\]/);
  });

  it("--version imprime programa y versión", async () => {
    const { code, stdout } = await run(["--version"]);
    assert.deepEqual([code, stdout], [0, `scorm-to-pdf ${VERSION}\n`]);
  });
});

describe("CliApplication · errores y códigos de salida", () => {
  it("sin argumentos y sin terminal: código 2 que explica cómo usar las órdenes", async () => {
    const { code, stderr } = await run([]);
    assert.equal(code, 2);
    assert.match(stderr, /^ERROR: El selector interactivo necesita una terminal/);
    assert.match(stderr, /--help/);
  });

  it("opción desconocida: código 2 con sugerencia", async () => {
    const { code, stderr } = await run(["10067", "--ot"]);
    assert.equal(code, 2);
    assert.match(stderr, /¿Quisiste decir --out\?/);
  });

  it("sin MOODLE_COOKIE: código 2 que nombra la variable", async () => {
    const { code, stderr } = await run(baseArgs(), { MOODLE_COOKIE: undefined });
    assert.equal(code, 2);
    assert.match(stderr, /MOODLE_COOKIE/);
  });

  it("cookie inválida: código 3, explica cómo obtenerla y no deja PDF ni filtra la cookie", async () => {
    const { code, stderr } = await run(baseArgs(), { MOODLE_COOKIE: "MoodleSession=caducada" });
    assert.equal(code, 3);
    assert.match(stderr, /Cookies enviadas \(solo nombres\): MoodleSession/);
    assert.match(stderr, /DevTools/);
    assert.ok(!stderr.includes("caducada"));
    assert.deepEqual(await readdir(outDir), []);
  });

  it("ID inexistente: código 1 con el rango de revisiones probado", async () => {
    const { code, stderr } = await run(["99999", "--base-url", moodle.origin, "--out-dir", outDir]);
    assert.equal(code, 1);
    assert.match(stderr, /No se encontró index\.html para el SCORM 99999/);
  });

  it("error inesperado: código 1; con DEBUG muestra la traza", async () => {
    const failing: HttpClient = { get: () => Promise.reject(new TypeError("boom")) };
    const plain = await run(baseArgs(), {}, failing);
    assert.equal(plain.code, 1);
    assert.match(plain.stderr, /^ERROR inesperado: boom\nTraza guardada en /);

    const debug = await run(baseArgs(), { DEBUG: "1" }, failing);
    assert.match(debug.stderr, /TypeError: boom\n\s+at /);
    assert.ok((await readdir(traceRoot)).some((name) => name.startsWith("scorm-trace-")), "el fallo deja traza");
  });

  it("un valor lanzado que no es Error también se informa", async () => {
    const failing: HttpClient = { get: () => Promise.reject("texto suelto") };
    const { code, stderr } = await run(baseArgs(), { DEBUG: "1" }, failing);
    assert.equal(code, 1);
    assert.match(stderr, /ERROR inesperado: texto suelto/);
  });
});
