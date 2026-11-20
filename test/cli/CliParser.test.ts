import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { en } from "../../src/i18n/en.ts";
import { CliParser } from "../../src/cli/CliParser.ts";
import { HelpFormatter } from "../../src/cli/HelpFormatter.ts";
import { UsageError } from "../../src/domain/errors.ts";
import type { CliCommand } from "../../src/cli/commands.ts";

function makeParser(env: Record<string, string | undefined> = {}): CliParser {
  return new CliParser({
    version: "1.2.3",
    env,
    messages: en,
    help: new HelpFormatter({ programName: "scorm-to-pdf", messages: en }),
  });
}

/** Flatten the legacy SCORM command for the existing assertions. */
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
    `Expected ${JSON.stringify(argv)} to fail with ${pattern}`,
  );
}

describe("CliParser valid inputs", () => {
  it("applies the defaults when given only an ID", () => {
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

  it("accepts short options and long options with a space or equals sign", () => {
    const options = parseRun(["10067", "--out", "a.pdf", "--concurrency=3", "-q", "--revision", "4", "--entry=deck/start.html"]);
    assert.equal(options.outPath, "a.pdf");
    assert.equal(options.concurrency, 3);
    assert.equal(options.quiet, true);
    assert.equal(options.revision, 4);
    assert.equal(options.entry, "deck/start.html");
  });

  it("accepts grouped short flags before the ID", () => {
    const options = parseRun(["-qo", "salida.pdf", "10067"]);
    assert.equal(options.quiet, true);
    assert.equal(options.outPath, "salida.pdf");
    assert.equal(options.scormId, 10067);
  });

  it("accepts --out-dir for automatically named output", () => {
    assert.equal(parseRun(["10067", "-d", "pdfs"]).outDir, "pdfs");
  });

  it("accepts the ID after the option terminator", () => {
    assert.equal(parseRun(["--", "10067"]).scormId, 10067);
  });

  it("reads MOODLE_BASE_URL and gives --base-url priority", () => {
    const env = { MOODLE_BASE_URL: "https://moodle.example.org/lms" };
    assert.equal(parseRun(["1"], env).baseUrl!.href, "https://moodle.example.org/lms/");
    assert.equal(parseRun(["1", "--base-url", "https://otro.example.org"], env).baseUrl!.href, "https://otro.example.org/");
  });

  it("accepts HTTP on loopback hosts", () => {
    assert.equal(parseRun(["1", "--base-url", "http://localhost:8080"]).baseUrl!.origin, "http://localhost:8080");
    assert.equal(parseRun(["1", "--base-url=http://127.0.0.1:9"]).baseUrl!.origin, "http://127.0.0.1:9");
  });

  it("extracts the ID, base URL, revision, and entry from a pluginfile URL", () => {
    const options = parseRun(["https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html"]);
    assert.equal(options.scormId, 10067);
    assert.equal(options.baseUrl!.href, "https://kb.cunbm.utcluj.ro/");
    assert.equal(options.revision, 3);
    assert.equal(options.entry, "index.html");
  });

  it("preserves the Moodle installation path in the URL", () => {
    const options = parseRun(["https://host.example/moodle/pluginfile.php/55/mod_scorm/content/2/deck/start.html"]);
    assert.equal(options.baseUrl!.href, "https://host.example/moodle/");
    assert.equal(options.entry, "deck/start.html");
  });

  it("prefers explicit options to values inferred from the URL", () => {
    const options = parseRun([
      "https://kb.cunbm.utcluj.ro/pluginfile.php/10067/mod_scorm/content/3/index.html",
      "--revision", "9", "--entry", "otro.html", "--base-url", "https://b.example",
    ]);
    assert.equal(options.revision, 9);
    assert.equal(options.entry, "otro.html");
    assert.equal(options.baseUrl!.origin, "https://b.example");
  });
});

describe("CliParser help and version", () => {
  it("shows help with --help or -h without a module ID", () => {
    const expected = new HelpFormatter({ programName: "scorm-to-pdf", messages: en }).format();
    assert.deepEqual(makeParser().parse(["--help"]), { kind: "help", text: expected });
    assert.deepEqual(makeParser().parse(["-h"]), { kind: "help", text: expected });
  });

  it("shows the program name and version with --version or -v", () => {
    assert.deepEqual(makeParser().parse(["--version"]), { kind: "version", text: "scorm-to-pdf 1.2.3\n" });
    assert.deepEqual(makeParser().parse(["-v"]), { kind: "version", text: "scorm-to-pdf 1.2.3\n" });
  });

  it("shows help when both help and version are requested", () => {
    assert.equal(makeParser().parse(["--version", "--help"]).kind, "help");
  });
});

describe("CliParser usage errors", () => {
  const cases: Array<[string, string[], RegExp]> = [
    ["multiple positional arguments", ["1", "2"], /Specify one SCORM ID/],
    ["nonnumeric ID", ["abc"], /is not a numeric ID or a pluginfile/],
    ["ID of zero", ["0"], /ID.*from 1 to 2147483647/],
    ["ID above the limit", ["99999999999"], /ID.*from 1 to 2147483647/],
    ["URL outside the pluginfile endpoint", ["https://example.com/otra/cosa"], /pluginfile\.php/],
    ["unknown option with a suggestion", ["1", "--ot"], /--ot.*Did you mean --out\?/],
    ["option from a different command", ["courses", "--week", "1"], /--week/],
    ["closest suggestion when two options are similar", ["1", "--ouit"], /Did you mean --out\?/],
    ["unknown option without a suggestion", ["1", "--zzzzzz"], /--zzzzzz(?!.*Did you mean)/],
    ["unknown short flag", ["1", "-x"], /-x/],
    ["missing value at the end of the command", ["1", "--out"], /--out.*requires a value/],
    ["value that resembles another option", ["1", "-o", "--quiet"], /--out.*requires a value/],
    ["empty inline value", ["1", "--out="], /--out.*requires a value/],
    ["boolean flag with a value", ["1", "--quiet=si"], /--quiet.*does not take a value/],
    ["concurrency of zero", ["1", "-c", "0"], /--concurrency.*from 1 to 32/],
    ["concurrency above the limit", ["1", "-c", "33"], /--concurrency.*from 1 to 32/],
    ["nonnumeric concurrency", ["1", "-c", "mucha"], /--concurrency.*"mucha"/],
    ["nonnumeric revision", ["1", "--revision=x"], /--revision.*integer/],
    ["combined --out and --out-dir", ["1", "-o", "a.pdf", "-d", "dir"], /either --out or --out-dir/],
    ["repeated option", ["1", "-o", "a", "-o", "b"], /--out.*more than once/],
    ["entry with a parent directory segment", ["1", "--entry", "../x.html"], /--entry/],
    ["absolute entry path", ["1", "--entry", "/etc/passwd"], /--entry/],
    ["entry with a current directory segment", ["1", "--entry", "./a.html"], /--entry/],
    ["entry with a double slash", ["1", "--entry", "a//b"], /--entry/],
    ["entry with a backslash", ["1", "--entry", "a\\b"], /--entry/],
    ["entry with a query string", ["1", "--entry", "a.html?x=1"], /--entry/],
    ["remote HTTP base URL", ["1", "--base-url", "http://moodle.example.org"], /HTTPS/],
    ["invalid base URL", ["1", "--base-url", "not a URL"], /Invalid base URL/],
  ];
  for (const [name, argv, pattern] of cases) {
    it(name, () => assertUsageError(argv, pattern));
  }

  it("names the environment variable when MOODLE_BASE_URL is invalid", () => {
    assertUsageError(["1"], /MOODLE_BASE_URL/, { MOODLE_BASE_URL: "http://moodle.example.org" });
  });
});

describe("CliParser commands", () => {
  it("accepts shared options and aliases before the ascii command", () => {
    const command = parseKind(
      ["-w", "40.0", "-o", "out.json", "ascii", "input.png", "--bg", "--tone=0", "--fps", "12.5", "--chars=", "-q"],
      "ascii",
      { MOODLE_BASE_URL: "incorrecta", SCORM_PLATFORM: "inexistente" },
    );
    assert.equal(command.request.kind, "convert");
    assert.equal(command.global.quiet, true);
    if (command.request.kind !== "convert") assert.fail("Expected an ASCII conversion");
    const { input, options } = command.request;
    assert.deepEqual([input, options.cols, options.out, options.bg, options.tone, options.fps, options.chars],
      ["input.png", 40, "out.json", true, 0, 12.5, ""]);
    assert.equal(parseKind(["ascii", "--prepare"], "ascii").request.kind, "prepare");
    assert.match(parseKind(["ascii", "--help"], "help").text, /ascii <input>.*--prepare/s);
  });

  it("validates ASCII arguments and uses the common option errors", () => {
    assertUsageError(["ascii"], /Specify an image or video/);
    assertUsageError(["ascii", "a.png", "b.png"], /accepts one image or video/);
    assertUsageError(["ascii", "--prepare", "a.png"], /Use --prepare by itself/);
    assertUsageError(["ascii", "--prepare", "--loop"], /Use --prepare by itself/);
    assertUsageError(["ascii", "a.png", "--gamma", "Infinity"], /--gamma/);
    assertUsageError(["ascii", "a.png", "--fps", "61"], /--fps/);
    assertUsageError(["ascii", "a.png", "--tone=-1"], /--tone/);
    assertUsageError(["ascii", "a.png", "--cols"], /--cols requires a value/);
    assertUsageError(["ascii", "a.png", "--cols=1.5"], /integer from 1 to 500/);
    assertUsageError(["ascii", "a.png", "--cols=30", "-w", "40"], /--cols was specified more than once/);
    assertUsageError(["ascii", "a.png", "--colx=30"], /Did you mean --cols/);
  });

  it("opens the interactive selector with no arguments or only global options", () => {
    assert.equal(parseKind([], "tui").global.quiet, false);
    assert.equal(parseKind(["-q"], "tui").global.quiet, true);
    assert.equal(parseKind(["--trace"], "tui").global.trace, true);
    assert.equal(parseKind(["tui"], "tui").kind, "tui");
  });

  it("rejects positional arguments for courses and diagnose and accepts courses --json", () => {
    assert.equal(parseKind(["courses"], "courses").json, false);
    assert.equal(parseKind(["courses", "--json"], "courses").json, true);
    assert.equal(parseKind(["diagnose"], "diagnose").kind, "diagnose");
    assertUsageError(["courses", "extra"], /Unexpected arguments for courses/);
    assertUsageError(["diagnose", "extra"], /Unexpected arguments for diagnose/);
  });

  it("requires exactly one course for items", () => {
    assert.equal(parseKind(["items", "algoritmi"], "items").course, "algoritmi");
    assert.equal(parseKind(["items", "101", "--json"], "items").json, true);
    assertUsageError(["items"], /Specify a course ID.*items/);
    assertUsageError(["items", "a", "b"], /Unexpected arguments for items/);
  });

  it("accepts sorted unique sections, item IDs, or --all for get", () => {
    const byWeek = parseKind(["get", "algoritmi", "--week", "3,1,3"], "get");
    assert.deepEqual([byWeek.course, byWeek.weeks, byWeek.items, byWeek.all, byWeek.dest], ["algoritmi", [1, 3], undefined, false, "."]);
    assert.deepEqual(parseKind(["get", "x", "--item", "531, 7"], "get").items, ["7", "531"]);
    assert.equal(parseKind(["get", "x", "--all", "-d", "material"], "get").dest, "material");
    assert.equal(parseKind(["get", "x", "--all", "--dest=otra"], "get").dest, "otra");
    assert.equal(parseKind(["get", "x", "--week", "0"], "get").weeks![0], 0);
  });

  it("validates the get selection", () => {
    assertUsageError(["get", "x"], /Nothing to download/);
    assertUsageError(["get", "x", "--all", "--week", "1"], /--all.*--week/);
    assertUsageError(["get", "x", "--all", "--item", "1"], /--all/);
    assertUsageError(["get"], /Specify a course ID.*get/);
    assertUsageError(["get", "x", "--week", "1,,3"], /--week.*comma-separated list of integers/);
    assertUsageError(["get", "x", "--week", "a"], /--week/);
    assertUsageError(["get", "x", "--item", "1,x"], /--item/);
  });

  it("accepts global options before or after the command", () => {
    const command = parseKind(["-q", "courses", "--platform", "ro.utcluj.kb", "--lang", "en", "-c", "3", "--trace-dir", "t"], "courses");
    assert.deepEqual(command.global, {
      platform: "ro.utcluj.kb", baseUrl: undefined, lang: "en", concurrency: 3, trace: false, traceDir: "t", quiet: true,
    });
  });

  it("reads platform, trace, and base URL from the environment and gives options priority", () => {
    const env = { SCORM_PLATFORM: "ro.utcluj.kb", SCORM_TRACE: "1", MOODLE_BASE_URL: "https://m.example.org" };
    const fromEnv = parseKind(["courses"], "courses", env).global;
    assert.deepEqual([fromEnv.platform, fromEnv.trace, fromEnv.baseUrl!.origin], ["ro.utcluj.kb", true, "https://m.example.org"]);
    assert.equal(parseKind(["courses", "--platform", "https://x.example.org"], "courses", env).global.platform, "https://x.example.org");
    assert.equal(parseKind(["courses"], "courses", { SCORM_TRACE: "0" }).global.trace, false);
  });
});
