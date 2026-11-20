import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { SessionCookie } from "./application/SessionCookie.ts";
import type { HttpClient } from "./application/ports.ts";
import { CliParser } from "./cli/CliParser.ts";
import type { CliCommand, GlobalOptions } from "./cli/commands.ts";
import { HelpFormatter } from "./cli/HelpFormatter.ts";
import { CoursesCommand } from "./commands/CoursesCommand.ts";
import type { Command } from "./commands/Command.ts";
import { DiagnoseCommand } from "./commands/DiagnoseCommand.ts";
import { GetCommand } from "./commands/GetCommand.ts";
import { ItemsCommand } from "./commands/ItemsCommand.ts";
import { ScormCommand } from "./commands/ScormCommand.ts";
import { TuiCommand } from "./commands/TuiCommand.ts";
import { ServiceFactory } from "./composition/ServiceFactory.ts";
import type { Services } from "./composition/ServiceFactory.ts";
import { AppError, UsageError, errorMessage } from "./domain/errors.ts";
import { ExtensionRegistry } from "./extensions/ExtensionRegistry.ts";
import type { ResolvedPlatform } from "./extensions/ExtensionRegistry.ts";
import { extension as utcluj } from "./extensions/ro/utcluj/kb/index.ts";
import { LocaleResolver } from "./i18n/LocaleResolver.ts";
import type { Messages } from "./i18n/Messages.ts";
import { es } from "./i18n/es.ts";
import type { OutputStream } from "./infra/ConsoleLogger.ts";
import { CookiePrompt } from "./tui/CookiePrompt.ts";
import { FrameLayout } from "./tui/FrameLayout.ts";
import type { Terminal } from "./tui/Terminal.ts";
import { TuiApplication } from "./tui/TuiApplication.ts";
import { TuiLogger } from "./tui/TuiLogger.ts";
import { FileTraceSink } from "./tracing/FileTraceSink.ts";
import { Redactor } from "./tracing/Redactor.ts";
import { TraceRecorder } from "./tracing/TraceRecorder.ts";
import type { Tracer } from "./tracing/Tracer.ts";
import { PROGRAM_NAME, VERSION } from "./version.ts";

const TRACE_RING_SIZE = 500;
const CANCELLED_EXIT_CODE = 130;

export interface CliApplicationDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  /** Sustituible para pruebas; por defecto, `fetch`. */
  readonly http?: HttpClient | undefined;
  /** Carpeta base de las trazas por defecto; por defecto, la actual. */
  readonly cwd?: string | undefined;
  /** Teclado y pantalla del selector interactivo; sin él (o sin TTY), el selector no está disponible. */
  readonly terminal?: Terminal | undefined;
}

interface RunState {
  messages: Messages;
  locale: string;
  tracer: Tracer | undefined;
  streaming: boolean;
  announceTrace: boolean;
  traceDir: string;
}

/**
 * Raíz de composición: elige idioma, crea la traza, cablea los servicios y despacha la orden.
 * Devuelve el código de salida; no llama a `process.exit`.
 */
export class CliApplication {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;
  private readonly factory: ServiceFactory;
  private readonly cwd: string;
  private readonly terminal: Terminal | undefined;
  private readonly locales = new LocaleResolver({ catalogs: { es }, defaultLocale: "es" });

  constructor(deps: CliApplicationDeps) {
    this.env = deps.env;
    this.stdout = deps.stdout;
    this.stderr = deps.stderr;
    this.cwd = deps.cwd ?? ".";
    this.terminal = deps.terminal;
    this.factory = new ServiceFactory({ http: deps.http, stdout: deps.stdout, stderr: deps.stderr });
  }

  async run(argv: readonly string[]): Promise<number> {
    const state: RunState = { messages: es, locale: "es", tracer: undefined, streaming: false, announceTrace: false, traceDir: "" };
    let code: number;
    try {
      const resolved = this.locales.resolve({ flag: this.peekLang(argv), env: this.env });
      state.messages = resolved.messages;
      state.locale = resolved.locale;
      code = await this.execute(argv, state);
    } catch (error) {
      code = this.report(error, state.messages);
    }
    this.finishTrace(code, state);
    return code;
  }

  private async execute(argv: readonly string[], state: RunState): Promise<number> {
    const { messages } = state;
    const parser = new CliParser({
      version: VERSION,
      env: this.env,
      messages,
      help: new HelpFormatter({ programName: PROGRAM_NAME, messages }),
    });
    const command = parser.parse(argv);
    if (command.kind === "help" || command.kind === "version") {
      this.stdout.write(command.text);
      return 0;
    }

    const { global } = command;
    const redactor = new Redactor();
    const tracer = this.createTracer(global, command.kind === "diagnose", redactor, state);
    const registry = new ExtensionRegistry({ extensions: [utcluj], defaultId: utcluj.id, messages });
    const resolved = registry.resolve({ spec: global.platform, baseUrl: global.baseUrl });
    tracer.event("info", "app", "run.start", {
      version: VERSION,
      runtime: `${process.release.name} ${process.version}; bun ${process.versions.bun ?? "none"}`,
      os: process.platform,
      locale: state.locale,
      command: command.kind,
      platform: resolved.extension.id,
      origin: resolved.baseUrl.origin,
      flags: { quiet: global.quiet, concurrency: global.concurrency, trace: state.streaming },
    });

    if (command.kind === "tui" && !this.terminal?.interactive) throw new UsageError(messages.cli.tuiNeedsTerminal());
    const layout = new FrameLayout({ colors: !this.env.NO_COLOR });
    const cookie = await this.obtainCookie(command, messages, layout);
    for (const value of cookie.secretValues()) tracer.addSecret(value);

    const tuiLogger = command.kind === "tui" ? new TuiLogger() : undefined;
    const services = this.factory.create({
      messages, locale: state.locale, tracer, redactor, global, resolved, cookie, logger: tuiLogger,
    });
    return this.build(command, services, { resolved, messages, tracer, layout, tuiLogger }).run();
  }

  /** La cookie viene del entorno; solo el selector interactivo puede pedirla si falta. */
  private async obtainCookie(command: CliCommand, messages: Messages, layout: FrameLayout): Promise<SessionCookie> {
    const fromEnv = this.env.MOODLE_COOKIE;
    if (command.kind !== "tui" || (fromEnv ?? "").trim() !== "") return SessionCookie.parse(fromEnv, messages);
    const typed = await new CookiePrompt({ terminal: this.terminal!, messages, layout }).ask();
    return SessionCookie.parse(typed, messages);
  }

  private build(
    command: Exclude<CliCommand, { kind: "help" | "version" }>,
    services: Services,
    context: { resolved: ResolvedPlatform; messages: Messages; tracer: Tracer; layout: FrameLayout; tuiLogger: TuiLogger | undefined },
  ): Command {
    const { resolved, messages, tracer } = context;
    const { logger, catalog, resolver } = services;
    switch (command.kind) {
      case "scorm":
        return new ScormCommand({
          convert: services.convert,
          logger,
          messages,
          request: { baseUrl: resolved.baseUrl, ...command.scorm },
        });
      case "courses":
        return new CoursesCommand({ catalog, logger, json: command.json });
      case "items":
        return new ItemsCommand({ catalog, resolver, logger, messages, query: command.course, json: command.json });
      case "get":
        return new GetCommand({
          catalog,
          resolver,
          messages,
          batch: services.batch,
          printer: services.printer,
          query: command.course,
          dest: command.dest,
          selection: { all: command.all, weeks: command.weeks, items: command.items },
        });
      case "diagnose":
        return new DiagnoseCommand({ platform: services.platform, catalog, logger, messages, tracer });
      case "tui":
        return new TuiCommand({
          app: new TuiApplication({
            terminal: this.terminal!,
            catalog,
            batch: services.batch,
            namer: services.namer,
            logger: context.tuiLogger!,
            printer: services.printer,
            messages,
            layout: context.layout,
            stdout: this.stdout,
            stderr: this.stderr,
            cwd: this.cwd,
          }),
        });
    }
  }

  private createTracer(global: GlobalOptions, forced: boolean, redactor: Redactor, state: RunState): Tracer {
    const runId = randomBytes(4).toString("hex");
    state.streaming = global.trace || forced;
    state.announceTrace = global.trace && !forced;
    state.traceDir = global.traceDir ?? join(this.cwd, `scorm-trace-${runId}`);
    const tracer = TraceRecorder.create({
      runId,
      clock: Date.now,
      redactor,
      sink: new FileTraceSink({ dir: state.traceDir }),
      streaming: state.streaming,
      captureBodies: state.streaming,
      ringSize: TRACE_RING_SIZE,
    });
    state.tracer = tracer;
    return tracer;
  }

  /** Deja la traza donde se pueda encontrar: siempre con --trace; si no, solo cuando algo falla de verdad. */
  private finishTrace(code: number, state: RunState): void {
    const { tracer, messages } = state;
    if (tracer === undefined) return;
    if (state.streaming) {
      tracer.flush();
      if (state.announceTrace) this.stderr.write(`${messages.trace.saved({ path: state.traceDir })}\n`);
    } else if (code !== 0 && code !== 2 && code !== CANCELLED_EXIT_CODE) {
      this.stderr.write(`${messages.trace.savedHint({ path: tracer.flush() ?? state.traceDir })}\n`);
    }
  }

  private peekLang(argv: readonly string[]): string | undefined {
    const index = argv.findIndex((arg) => arg === "--lang" || arg.startsWith("--lang="));
    if (index === -1) return undefined;
    const arg = argv[index]!;
    return arg.startsWith("--lang=") ? arg.slice("--lang=".length) : argv[index + 1];
  }

  private report(error: unknown, messages: Messages): number {
    if (error instanceof AppError) {
      const hint = error instanceof UsageError ? `\n${messages.app.usageHint()}` : "";
      this.stderr.write(`${messages.app.errorPrefix()} ${error.message}${hint}\n`);
      return error.exitCode;
    }
    const trace = this.env.DEBUG && error instanceof Error ? `\n${error.stack}` : "";
    this.stderr.write(`${messages.app.unexpectedError({ detail: errorMessage(error) })}${trace}\n`);
    return 1;
  }
}
