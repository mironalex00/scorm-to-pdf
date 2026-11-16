import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliApplication } from "../../src/CliApplication.ts";
import { FakeMoodle } from "../support/FakeMoodle.ts";
import type { FakeMoodleOptions } from "../support/FakeMoodle.ts";
import type { LocalServer } from "../support/LocalServer.ts";
import { CapturedStream } from "../support/streams.ts";
import { SESSKEY } from "../fixtures/moodle.ts";

const COOKIE = "cookie-secret-98765";
const base: FakeMoodleOptions = { scormId: 10067, revision: 3, title: "AFSD · Curs 5. X", slideCount: 2, validCookie: COOKIE };

let work: string;
beforeEach(async () => {
  work = await mkdtemp(join(tmpdir(), "scorm-catalog-"));
});
afterEach(() => rm(work, { recursive: true, force: true }));

const servers: LocalServer[] = [];
async function server(options: Partial<FakeMoodleOptions> = {}): Promise<LocalServer> {
  const started = await FakeMoodle.start({ ...base, ...options });
  servers.push(started);
  return started;
}
after(() => Promise.all(servers.map((s) => s.close())));

async function run(moodle: LocalServer, argv: string[], env: Record<string, string | undefined> = {}) {
  const stdout = new CapturedStream();
  const stderr = new CapturedStream();
  const app = new CliApplication({ env: { MOODLE_COOKIE: COOKIE, ...env }, stdout, stderr, cwd: work });
  const code = await app.run([...argv, "--base-url", moodle.origin]);
  return { code, stdout: stdout.output, stderr: stderr.output };
}
const files = async (dir: string): Promise<string[]> =>
  (await readdir(dir, { recursive: true })).map(String).filter((name) => name.endsWith(".pdf")).sort();

describe("e2e · listar", () => {
  it("courses lista los cursos ordenados alfabéticamente (id y nombre)", async () => {
    const { code, stdout } = await run(await server(), ["courses"]);
    assert.equal(code, 0);
    assert.equal(stdout, "102\tAlgoritmi fundamentali\n101\tStructuri de date\n");
  });

  it("courses --json devuelve JSON utilizable por otros programas", async () => {
    const { stdout } = await run(await server(), ["courses", "--json"]);
    assert.deepEqual((JSON.parse(stdout) as Array<{ id: string }>).map((c) => c.id), ["102", "101"]);
  });

  it("items muestra las semanas de menor a mayor con sus contenidos descargables y omite el resto", async () => {
    const { code, stdout } = await run(await server(), ["items", "algoritmi"]);
    assert.equal(code, 0);
    assert.deepEqual(stdout.trimEnd().split("\n"), [
      "Semana 0 — General",
      "  [recurso] 501  Programa",
      "Semana 1 — Săptămâna 1",
      "  [scorm] 511  Curs 5. Funcții",
      "  [recurso] 512  Exerciții & teme",
      "Semana 3 — Săptămâna 3",
      "  [recurso] 531  Complementar",
    ]);
  });

  it("items --json y los errores de selección de curso", async () => {
    const moodle = await server();
    const json = JSON.parse((await run(moodle, ["items", "102", "--json"])).stdout) as { weeks: unknown[] };
    assert.equal(json.weeks.length, 3);

    const missing = await run(moodle, ["items", "nada"]);
    assert.equal(missing.code, 2);
    assert.ok(!missing.stderr.includes("Traza guardada"), "un error de uso no es un fallo que merezca traza");
    assert.deepEqual((await readdir(work)).filter((n) => n.startsWith("scorm-trace-")), []);
    assert.match(missing.stderr, /No se encontró ningún curso.*«nada»/);

    const ambiguous = await run(moodle, ["items", "d"]);
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /varios cursos.*102 \(Algoritmi fundamentali\); 101/);
  });

  it("una semana sin contenido descargable se indica", async () => {
    const empty = await run(await server(), ["items", "101"]);
    assert.match(empty.stdout, /Semana 2 — Tema\n {2}\[recurso\] 601 {2}Tema 1/);
  });
});

describe("e2e · descargar", () => {
  const dest = () => join(work, "material");

  it("get --all crea <destino>/<semana>/<nombre><ext>: archivos tal cual y SCORM convertido a PDF", async () => {
    const { code, stdout, stderr } = await run(await server(), ["get", "algoritmi", "--all", "--dest", dest(), "-q"]);
    assert.equal(code, 0, stderr);
    assert.deepEqual(await files(dest()), ["0/Programa.pdf", "1/Curs 5. Funcții.pdf", "1/Exerciții & teme.pdf", "3/Complementar.pdf"]);
    for (const file of await files(dest())) {
      assert.equal((await readFile(join(dest(), file))).subarray(0, 4).toString("latin1"), "%PDF");
    }
    assert.equal(stdout.trimEnd().split("\n").length, 4, "con -q solo se imprimen las rutas");
    // el SCORM pasa por la conversión de imágenes: 2 diapositivas → 2 páginas
    assert.match((await readFile(join(dest(), "1/Curs 5. Funcții.pdf"))).toString("latin1"), /\/Count 2 >>/);
  });

  it("una segunda ejecución omite lo que ya existe sin sobrescribirlo", async () => {
    const moodle = await server();
    await run(moodle, ["get", "algoritmi", "--all", "--dest", dest(), "-q"]);
    const again = await run(moodle, ["get", "algoritmi", "--all", "--dest", dest()]);
    assert.equal(again.code, 0);
    assert.equal((again.stdout.match(/Omitido \(ya existe\)/g) ?? []).length, 4);
    assert.match(again.stdout, /Descargados: 0 · Omitidos: 4 · Fallidos: 0/);
  });

  it("--week y --item eligen solo lo pedido", async () => {
    const moodle = await server();
    await run(moodle, ["get", "algoritmi", "--week", "3", "--dest", dest(), "-q"]);
    assert.deepEqual(await files(dest()), ["3/Complementar.pdf"]);
    await run(moodle, ["get", "algoritmi", "--item", "501", "--dest", dest(), "-q"]);
    assert.deepEqual(await files(dest()), ["0/Programa.pdf", "3/Complementar.pdf"]);
  });

  it("una selección vacía (semana inexistente) es un error de uso", async () => {
    const { code, stderr } = await run(await server(), ["get", "algoritmi", "--week", "9", "--dest", dest()]);
    assert.equal(code, 2);
    assert.match(stderr, /nada que descargar/);
  });

  it("un fallo parcial no impide descargar el resto y deja traza donde localizarlo", async () => {
    const moodle = await server({ failItems: ["531"] });
    const { code, stdout, stderr } = await run(moodle, ["get", "algoritmi", "--all", "--dest", dest()]);
    assert.equal(code, 1);
    assert.match(stdout, /Descargados: 3 · Omitidos: 0 · Fallidos: 1/);
    assert.match(stderr, /Fallo en «Complementar»/);
    assert.match(stderr, /Traza guardada en .*scorm-trace-[0-9a-f]{8}\. Repite con --trace/);

    const traceDir = (await readdir(work)).find((name) => name.startsWith("scorm-trace-"))!;
    const lines = (await readFile(join(work, traceDir, "trace.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const failure = lines.find((e) => e.name === "item.fail" && (e.ctx as { item: string }).item === "531")!;
    assert.equal(failure.scope, "download");
    assert.ok(typeof failure.ms === "number" && typeof failure.t === "string");
    assert.match(String((failure.error as { chain: string[] }).chain[0]), /NotFoundError|No existe/);
  });

  it("una sesión caducada devuelve el código 3", async () => {
    const { code, stderr } = await run(await server(), ["courses"], { MOODLE_COOKIE: "caducada-000000" });
    assert.equal(code, 3);
    assert.match(stderr, /Cookies enviadas \(solo nombres\): MoodleSession/);
    assert.ok(!stderr.includes("caducada-000000"));
  });
});

describe("e2e · plataforma, idioma y trazabilidad", () => {
  it("con la extensión ro.utcluj.kb carga el curso completo directamente", async () => {
    const moodle = await server();
    const traceDir = join(work, "t");
    const { code } = await run(moodle, ["items", "102", "--platform", "ro.utcluj.kb", "--trace", "--trace-dir", traceDir]);
    assert.equal(code, 0);
    const events = (await readFile(join(traceDir, "trace.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { name: string; data?: Record<string, unknown> });
    const outcomes = events.filter((e) => e.name === "contents.attempt").map((e) => `${e.data!.path}→${e.data!.outcome}`);
    assert.deepEqual(outcomes, ["course/view.php?id={courseId}→ok"]);
  });

  it("--trace guarda la traza y capturas redactadas: ni la cookie ni el sesskey salen de la memoria", async () => {
    const traceDir = join(work, "trace");
    const { code, stderr } = await run(await server(), ["courses", "--trace", "--trace-dir", traceDir]);
    assert.equal(code, 0);
    assert.match(stderr, /Traza guardada en/);

    const names = await readdir(traceDir, { recursive: true });
    assert.ok(names.some((n) => String(n).includes("courses-page")) && names.some((n) => String(n).includes("courses-json")));
    for (const name of names.map(String).filter((n) => n.endsWith(".txt") || n.endsWith(".jsonl"))) {
      const content = await readFile(join(traceDir, name), "utf8");
      assert.ok(!content.includes(COOKIE) && !content.includes(SESSKEY), `filtración en ${name}`);
    }
    assert.match(await readFile(join(traceDir, "trace.jsonl"), "utf8"), /"name":"run.start"/);
  });

  it("diagnose recorre la cadena completa, marca cada paso y guarda la traza", async () => {
    const traceDir = join(work, "diag");
    const { code, stdout } = await run(await server(), ["diagnose", "--trace-dir", traceDir]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /✓ Lista de cursos: 2 cursos/);
    assert.match(stdout, /✓ Contenido de un curso: 3 secciones, 4 contenidos/);
    assert.match(stdout, /✓ Resolver un recurso: «Programa»/);
    assert.match(stdout, /✓ Resolver un SCORM: «Curs 5\. Funcții»/);
    assert.match(stdout, new RegExp(`Traza completa en: ${traceDir}`));
    assert.ok((await readdir(join(traceDir, "snapshots"))).length > 3);
  });

  it("diagnose con la sesión caducada falla el primer paso, omite el resto y sale con 3", async () => {
    const { code, stdout } = await run(await server(), ["diagnose", "--trace-dir", join(work, "d2")], { MOODLE_COOKIE: "caducada-000000" });
    assert.equal(code, 3);
    assert.match(stdout, /✗ Lista de cursos/);
    assert.ok(!stdout.includes("Contenido de un curso"));
  });

  it("una plataforma desconocida o un idioma no soportado son errores de uso", async () => {
    const moodle = await server();
    const platform = await run(moodle, ["courses", "--platform", "com.otro.app"]);
    assert.equal(platform.code, 2);
    assert.match(platform.stderr, /Plataforma desconocida.*ro\.utcluj\.kb/);
    assert.ok(!platform.stderr.includes("Traza guardada"));
    const lang = await run(moodle, ["courses", "--lang", "xx"]);
    assert.equal(lang.code, 2);
    assert.match(lang.stderr, /Idioma no soportado/);
    assert.deepEqual((await readdir(work)).filter((n) => n.startsWith("scorm-trace-")), [], "los errores de uso no dejan traza");
  });

  it("--lang se lee tanto con espacio como con =, y LANG del entorno no soportado cae al español", async () => {
    const moodle = await server();
    assert.equal((await run(moodle, ["courses", "--lang=es"])).code, 0);
    assert.equal((await run(moodle, ["courses", "--lang", "es"])).code, 0);
    assert.equal((await run(moodle, ["courses"], { LANG: "fr_FR.UTF-8" })).code, 0);
  });
});
