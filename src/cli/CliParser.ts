import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { CliCommand, GlobalOptions, ScormOptions } from "./commands.ts";
import type { HelpFormatter } from "./HelpFormatter.ts";
import { OptionCollector } from "./OptionCollector.ts";
import type { CollectedOptions } from "./OptionCollector.ts";
import { CLI_DEFAULTS, COMMAND_NAMES, COMMAND_OPTIONS, GLOBAL_OPTIONS } from "./optionSpecs.ts";
import type { CommandName, OptionSpec } from "./optionSpecs.ts";

interface TargetHints {
  readonly scormId: number;
  readonly baseUrl?: string;
  readonly revision?: number;
  readonly entry?: string;
}

const MAX_SCORM_ID = 2_147_483_647;
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);
const PLUGINFILE_PATH = /^(.*)\/pluginfile\.php\/(\d+)\/mod_scorm\/content\/(\d+)\/(.+)$/;

/** Para elegir la orden basta con saber qué opciones consumen un valor; sin formas cortas, que chocan. */
const PEEK_SPECS: readonly OptionSpec[] = [
  ...GLOBAL_OPTIONS,
  ...Object.values(COMMAND_OPTIONS).flatMap((specs) => specs.map((spec): OptionSpec => ({ name: spec.name, kind: spec.kind }))),
].filter((spec, index, all) => all.findIndex((other) => other.name === spec.name) === index);

/** Convierte argv en una orden validada. Nunca toca el proceso ni el sistema de archivos. */
export class CliParser {
  private readonly version: string;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly help: HelpFormatter;
  private readonly messages: Messages;
  private readonly collector: OptionCollector;

  constructor(deps: {
    version: string;
    env: Readonly<Record<string, string | undefined>>;
    help: HelpFormatter;
    messages: Messages;
  }) {
    this.version = deps.version;
    this.env = deps.env;
    this.help = deps.help;
    this.messages = deps.messages;
    this.collector = new OptionCollector({ messages: deps.messages });
  }

  parse(argv: readonly string[]): CliCommand {
    const name = this.detectCommand(argv);
    const collected = this.collector.collect(argv, [...GLOBAL_OPTIONS, ...COMMAND_OPTIONS[name]]);
    if (collected.flags.has("help")) return { kind: "help", text: this.help.format() };
    if (collected.flags.has("version")) {
      return { kind: "version", text: `${this.help.programName} ${this.version}\n` };
    }

    const positionals = name === "scorm" ? collected.positionals : collected.positionals.slice(1);
    switch (name) {
      case "scorm":
        return this.buildScorm(collected, positionals);
      case "courses":
        this.expectNone(name, positionals);
        return { kind: "courses", global: this.buildGlobal(collected), json: collected.flags.has("json") };
      case "items":
        return { kind: "items", global: this.buildGlobal(collected), course: this.expectCourse(name, positionals), json: collected.flags.has("json") };
      case "get":
        return this.buildGet(collected, positionals);
      case "diagnose":
        this.expectNone(name, positionals);
        return { kind: "diagnose", global: this.buildGlobal(collected) };
      case "tui":
        this.expectNone(name, positionals);
        return { kind: "tui", global: this.buildGlobal(collected) };
    }
  }

  private detectCommand(argv: readonly string[]): CommandName {
    const first = this.collector.firstPositional(argv, PEEK_SPECS);
    if (first === undefined) return "tui";
    return (COMMAND_NAMES as readonly string[]).includes(first) ? (first as CommandName) : "scorm";
  }

  private expectNone(command: string, positionals: readonly string[]): void {
    if (positionals.length > 0) throw new UsageError(this.messages.cli.unexpectedArguments({ command }));
  }

  private expectCourse(command: string, positionals: readonly string[]): string {
    if (positionals.length === 0) throw new UsageError(this.messages.cli.missingCourse({ command }));
    if (positionals.length > 1) throw new UsageError(this.messages.cli.unexpectedArguments({ command }));
    return positionals[0]!;
  }

  private buildGlobal(collected: CollectedOptions, hintBaseUrl?: string): GlobalOptions {
    const { strings } = collected;
    return {
      platform: strings.get("platform") ?? this.env.SCORM_PLATFORM,
      baseUrl: this.resolveBaseUrl(strings.get("base-url"), hintBaseUrl),
      lang: strings.get("lang"),
      concurrency: this.resolveConcurrency(strings.get("concurrency")),
      trace: collected.flags.has("trace") || this.env.SCORM_TRACE === "1",
      traceDir: strings.get("trace-dir"),
      quiet: collected.flags.has("quiet"),
    };
  }

  private buildScorm(collected: CollectedOptions, positionals: readonly string[]): CliCommand {
    const target = this.parseTarget(positionals);
    const { strings } = collected;
    const outPath = strings.get("out");
    const outDir = strings.get("out-dir");
    if (outPath !== undefined && outDir !== undefined) throw new UsageError(this.messages.cli.outAndOutDir());

    const scorm: ScormOptions = {
      scormId: target.scormId,
      entry: this.resolveEntry(strings.get("entry"), target.entry),
      revision: this.resolveRevision(strings.get("revision"), target.revision),
      outPath,
      outDir: outDir ?? CLI_DEFAULTS.outDir,
    };
    return { kind: "scorm", global: this.buildGlobal(collected, target.baseUrl), scorm };
  }

  private buildGet(collected: CollectedOptions, positionals: readonly string[]): CliCommand {
    const { strings, flags } = collected;
    const course = this.expectCourse("get", positionals);
    const weeksRaw = strings.get("week");
    const itemsRaw = strings.get("item");
    const all = flags.has("all");
    if (all && (weeksRaw !== undefined || itemsRaw !== undefined)) throw new UsageError(this.messages.cli.allConflicts());
    if (!all && weeksRaw === undefined && itemsRaw === undefined) throw new UsageError(this.messages.cli.nothingSelected());

    return {
      kind: "get",
      global: this.buildGlobal(collected),
      course,
      weeks: weeksRaw === undefined ? undefined : this.parseNumberList("week", weeksRaw),
      items: itemsRaw === undefined ? undefined : this.parseNumberList("item", itemsRaw).map(String),
      all,
      dest: strings.get("dest") ?? CLI_DEFAULTS.dest,
    };
  }

  private parseNumberList(name: string, raw: string): number[] {
    const parts = raw.split(",").map((part) => part.trim());
    if (!parts.every((part) => /^\d+$/.test(part))) {
      throw new UsageError(this.messages.cli.listInvalid({ name, raw }));
    }
    return [...new Set(parts.map(Number))].sort((a, b) => a - b);
  }

  private parseTarget(positionals: readonly string[]): TargetHints {
    if (positionals.length > 1) throw new UsageError(this.messages.cli.tooManyTargets());

    const raw = positionals[0]!;
    if (/^\d+$/.test(raw)) return { scormId: this.parseScormId(raw) };

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UsageError(this.messages.cli.notIdNorUrl({ raw }));
    }
    const match = PLUGINFILE_PATH.exec(url.pathname);
    if (!match) throw new UsageError(this.messages.cli.badPluginfileUrl({ raw }));
    return {
      scormId: this.parseScormId(match[2]!),
      baseUrl: `${url.origin}${match[1]}`,
      revision: Number(match[3]),
      entry: match[4]!,
    };
  }

  private parseScormId(raw: string): number {
    return this.parseInteger(this.messages.cli.scormIdLabel(), raw, 1, MAX_SCORM_ID);
  }

  private parseInteger(label: string, raw: string, min: number, max: number): number {
    const value = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
    if (!(value >= min && value <= max)) {
      throw new UsageError(this.messages.cli.integerRange({ label, min: String(min), max: String(max), raw }));
    }
    return value;
  }

  private resolveConcurrency(flag: string | undefined): number {
    if (flag === undefined) return CLI_DEFAULTS.concurrency;
    return this.parseInteger("--concurrency", flag, 1, 32);
  }

  private resolveRevision(flag: string | undefined, fromTarget: number | undefined): number | undefined {
    if (flag === undefined) return fromTarget;
    return this.parseInteger("--revision", flag, 0, 9999);
  }

  private resolveEntry(flag: string | undefined, fromTarget: string | undefined): string {
    if (flag !== undefined) return this.validateEntry("--entry", flag);
    if (fromTarget !== undefined) return this.validateEntry(this.messages.cli.entryLabelUrl(), fromTarget);
    return CLI_DEFAULTS.entry;
  }

  private validateEntry(label: string, raw: string): string {
    const segments = raw.split("/");
    const unsafe = /[\\?#]/.test(raw) || segments.some((s) => s === "" || s === "." || s === "..");
    if (unsafe) throw new UsageError(this.messages.cli.unsafeEntry({ label, raw }));
    return raw;
  }

  private resolveBaseUrl(flag: string | undefined, fromTarget: string | undefined): URL | undefined {
    if (flag !== undefined) return this.parseBaseUrl(flag, "--base-url");
    if (fromTarget !== undefined) return this.parseBaseUrl(fromTarget, this.messages.cli.sourceUrlGiven());
    const fromEnv = this.env.MOODLE_BASE_URL;
    return fromEnv ? this.parseBaseUrl(fromEnv, "MOODLE_BASE_URL") : undefined;
  }

  private parseBaseUrl(raw: string, source: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UsageError(this.messages.cli.baseUrlInvalid({ source, raw }));
    }
    const secure = url.protocol === "https:" || (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname));
    if (!secure) throw new UsageError(this.messages.cli.baseUrlInsecure({ source, raw }));
    url.search = "";
    url.hash = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
    return url;
  }
}
