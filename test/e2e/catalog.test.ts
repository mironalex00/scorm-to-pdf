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

describe("Course and section listings", () => {
  it("lists course IDs and names alphabetically", async () => {
    const { code, stdout } = await run(await server(), ["courses"]);
    assert.equal(code, 0);
    assert.equal(stdout, "102\tAlgoritmi fundamentali\n101\tStructuri de date\n");
  });

  it("emits parseable JSON for courses --json", async () => {
    const { stdout } = await run(await server(), ["courses", "--json"]);
    assert.deepEqual((JSON.parse(stdout) as Array<{ id: string }>).map((c) => c.id), ["102", "101"]);
  });

  it("lists sections numerically and includes only downloadable items", async () => {
    const { code, stdout } = await run(await server(), ["items", "algoritmi"]);
    assert.equal(code, 0);
    assert.deepEqual(stdout.trimEnd().split("\n"), [
      "Section 0 - General",
      "  [resource] 501  Programa",
      "Section 1 - Săptămâna 1",
      "  [scorm] 511  Curs 5. Funcții",
      "  [resource] 512  Exerciții & teme",
      "Section 3 - Săptămâna 3",
      "  [resource] 531  Complementar",
    ]);
  });

  it("returns item JSON and reports missing or ambiguous course selections", async () => {
    const moodle = await server();
    const json = JSON.parse((await run(moodle, ["items", "102", "--json"])).stdout) as { weeks: unknown[] };
    assert.equal(json.weeks.length, 3);

    const missing = await run(moodle, ["items", "missing"]);
    assert.equal(missing.code, 2);
    assert.ok(!missing.stderr.includes("Trace saved"), "usage errors leave no trace");
    assert.deepEqual((await readdir(work)).filter((n) => n.startsWith("scorm-trace-")), []);
    assert.match(missing.stderr, /No course matches "missing"/);

    const ambiguous = await run(moodle, ["items", "d"]);
    assert.equal(ambiguous.code, 2);
    assert.match(ambiguous.stderr, /matches multiple courses.*102 \(Algoritmi fundamentali\); 101/);
  });

  it("labels a section with no downloadable content", async () => {
    const empty = await run(await server(), ["items", "101"]);
    assert.match(empty.stdout, /Section 2 - Tema\n {2}\[resource\] 601 {2}Tema 1/);
  });
});

describe("Course downloads", () => {
  const dest = () => join(work, "material");

  it("saves direct files and converted SCORM PDFs under their section folders", async () => {
    const { code, stdout, stderr } = await run(await server(), ["get", "algoritmi", "--all", "--dest", dest(), "-q"]);
    assert.equal(code, 0, stderr);
    assert.deepEqual(await files(dest()), ["General/Programa.pdf", "Săptămâna 1/Curs 5. Funcții.pdf", "Săptămâna 1/Exerciții & teme.pdf", "Săptămâna 3/Complementar.pdf"]);
    for (const file of await files(dest())) {
      assert.equal((await readFile(join(dest(), file))).subarray(0, 4).toString("latin1"), "%PDF");
    }
    assert.equal(stdout.trimEnd().split("\n").length, 4, "quiet mode prints only paths");
    // Each of the two SCORM slides becomes a PDF page.
    assert.match((await readFile(join(dest(), "Săptămâna 1/Curs 5. Funcții.pdf"))).toString("latin1"), /\/Count 2 >>/);
  });

  it("preserves files from a previous run", async () => {
    const moodle = await server();
    await run(moodle, ["get", "algoritmi", "--all", "--dest", dest(), "-q"]);
    const again = await run(moodle, ["get", "algoritmi", "--all", "--dest", dest()]);
    assert.equal(again.code, 0);
    assert.equal((again.stdout.match(/Skipped \(already exists\)/g) ?? []).length, 4);
    assert.match(again.stdout, /Downloaded: 0 \| Skipped: 4 \| Failed: 0/);
  });

  it("downloads only the requested sections or items", async () => {
    const moodle = await server();
    await run(moodle, ["get", "algoritmi", "--week", "3", "--dest", dest(), "-q"]);
    assert.deepEqual(await files(dest()), ["Săptămâna 3/Complementar.pdf"]);
    await run(moodle, ["get", "algoritmi", "--item", "501", "--dest", dest(), "-q"]);
    assert.deepEqual(await files(dest()), ["General/Programa.pdf", "Săptămâna 3/Complementar.pdf"]);
  });

  it("returns a usage error when the selection is empty", async () => {
    const { code, stderr } = await run(await server(), ["get", "algoritmi", "--week", "9", "--dest", dest()]);
    assert.equal(code, 2);
    assert.match(stderr, /Nothing to download/);
  });

  it("continues after a failed download and writes a trace only on request", async () => {
    const moodle = await server({ failItems: ["531"] });
    const args = ["get", "algoritmi", "--all", "--dest", dest()];
    const { code, stdout, stderr } = await run(moodle, args);
    assert.equal(code, 1);
    assert.match(stdout, /Downloaded: 3 \| Skipped: 0 \| Failed: 1/);
    assert.match(stderr, /Failed to download "Complementar"/);
    assert.match(stderr, /Run again with --trace/);
    assert.deepEqual((await readdir(work)).filter((name) => name.startsWith("scorm-trace-")), []);

    const traced = await run(moodle, [...args, "--trace"]);
    assert.equal(traced.code, 1);
    assert.match(traced.stderr, /Trace saved to .*scorm-trace-[0-9a-f]{8}/);

    const traceDir = (await readdir(work)).find((name) => name.startsWith("scorm-trace-"))!;
    const lines = (await readFile(join(work, traceDir, "trace.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);
    const failure = lines.find((e) => e.name === "item.fail" && (e.ctx as { item: string }).item === "531")!;
    assert.equal(failure.scope, "download");
    assert.ok(typeof failure.ms === "number" && typeof failure.t === "string");
    assert.match(String((failure.error as { chain: string[] }).chain[0]), /NotFoundError|Resource not found/);
  });

  it("returns exit status 3 for an expired session", async () => {
    const { code, stderr } = await run(await server(), ["courses"], { MOODLE_COOKIE: "caducada-000000" });
    assert.equal(code, 3);
    assert.match(stderr, /Cookies sent \(names only\): MoodleSession/);
    assert.ok(!stderr.includes("caducada-000000"));
  });
});

describe("Platform, locale, and diagnostics", () => {
  it("loads the course page directly with the UTCN profile", async () => {
    const moodle = await server();
    const traceDir = join(work, "t");
    const { code } = await run(moodle, ["items", "102", "--platform", "ro.utcluj.kb", "--trace", "--trace-dir", traceDir]);
    assert.equal(code, 0);
    const events = (await readFile(join(traceDir, "trace.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as { name: string; data?: Record<string, unknown> });
    const outcomes = events.filter((e) => e.name === "contents.attempt").map((e) => `${e.data!.path}→${e.data!.outcome}`);
    assert.deepEqual(outcomes, ["course/view.php?id={courseId}→ok"]);
  });

  it("saves diagnostic events and redacts the cookie and session key", async () => {
    const traceDir = join(work, "trace");
    const { code, stderr } = await run(await server(), ["courses", "--trace", "--trace-dir", traceDir]);
    assert.equal(code, 0);
    assert.match(stderr, /Trace saved to/);

    const names = await readdir(traceDir, { recursive: true });
    assert.ok(names.some((n) => String(n).includes("courses-page")) && names.some((n) => String(n).includes("courses-json")));
    for (const name of names.map(String).filter((n) => n.endsWith(".txt") || n.endsWith(".jsonl"))) {
      const content = await readFile(join(traceDir, name), "utf8");
      assert.ok(!content.includes(COOKIE) && !content.includes(SESSKEY), `Secret leaked in ${name}`);
    }
    assert.match(await readFile(join(traceDir, "trace.jsonl"), "utf8"), /"name":"run.start"/);
  });

  it("runs the diagnosis, reports each step, and saves a trace", async () => {
    const traceDir = join(work, "diag");
    const { code, stdout } = await run(await server(), ["diagnose", "--trace-dir", traceDir]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /OK  List courses: Courses found: 2/);
    assert.match(stdout, /OK  Read course contents: Sections: 3, items: 4/);
    assert.match(stdout, /OK  Resolve a resource: "Programa"/);
    assert.match(stdout, /OK  Resolve a SCORM: "Curs 5\. Funcții"/);
    assert.match(stdout, new RegExp(`Full trace saved to ${traceDir}`));
    assert.ok((await readdir(join(traceDir, "snapshots"))).length > 3);
  });

  it("stops diagnosis at the first step when the session has expired", async () => {
    const { code, stdout } = await run(await server(), ["diagnose", "--trace-dir", join(work, "d2")], { MOODLE_COOKIE: "caducada-000000" });
    assert.equal(code, 3);
    assert.match(stdout, /FAIL  List courses/);
    assert.ok(!stdout.includes("Read course contents"));
  });

  it("rejects an unknown platform or an unsupported locale", async () => {
    const moodle = await server();
    const platform = await run(moodle, ["courses", "--platform", "com.otro.app"]);
    assert.equal(platform.code, 2);
    assert.match(platform.stderr, /Unknown platform.*ro\.utcluj\.kb/);
    assert.ok(!platform.stderr.includes("Trace saved"));
    const lang = await run(moodle, ["courses", "--lang", "xx"]);
    assert.equal(lang.code, 2);
    assert.match(lang.stderr, /Unsupported language/);
    assert.deepEqual((await readdir(work)).filter((n) => n.startsWith("scorm-trace-")), [], "usage errors leave no trace");
  });

  it("accepts both --lang forms and uses English in a Spanish environment", async () => {
    const moodle = await server();
    assert.equal((await run(moodle, ["courses", "--lang=en"])).code, 0);
    assert.equal((await run(moodle, ["courses", "--lang", "en"])).code, 0);
    const fallback = await run(moodle, ["items", "102"], { LANG: "es_ES.UTF-8", SCORM_LANG: "es" });
    assert.equal(fallback.code, 0, fallback.stderr);
    assert.match(fallback.stdout, /^Section 0 - General\n/);
  });
});
