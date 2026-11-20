import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { SessionCookie } from "./application/SessionCookie.ts";
import type { HttpClient } from "./application/ports.ts";
import { CliParser } from "./cli/CliParser.ts";
import type { CommonOptions, MoodleCommand } from "./cli/commands.ts";
import { CliInterruptions } from "./cli/CliInterruptions.ts";
import { HelpFormatter } from "./cli/HelpFormatter.ts";
import { CoursesCommand } from "./commands/CoursesCommand.ts";
import { AsciiCommand } from "./commands/AsciiCommand.ts";
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
import { en } from "./i18n/en.ts";
import type { OutputStream } from "./infra/ConsoleLogger.ts";
import { plainLine, plainOutput } from "./infra/plainText.ts";
import { CookiePrompt } from "./tui/CookiePrompt.ts";
import { FrameLayout } from "./tui/FrameLayout.ts";
import type { Terminal } from "./tui/Terminal.ts";
import { TuiApplication } from "./tui/TuiApplication.ts";
import { TuiLogger } from "./tui/TuiLogger.ts";
import { FileTraceSink } from "./tracing/FileTraceSink.ts";
import { NullTracer } from "./tracing/NullTracer.ts";
import { Redactor } from "./tracing/Redactor.ts";
import { TraceRecorder } from "./tracing/TraceRecorder.ts";
import type { Tracer } from "./tracing/Tracer.ts";
import { PROGRAM_NAME, VERSION } from "./version.ts";

export interface CliApplicationDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly stderr: OutputStream;
  /** Uses fetch unless a test client is supplied. */
  readonly http?: HttpClient | undefined;
  /** Parent directory for default trace paths. */
  readonly cwd?: string | undefined;
  /** Interactive input and output for the course selector. */
  readonly terminal?: Terminal | undefined;
  readonly interruptions?: CliInterruptions;
}

interface RunState {
  messages: Messages;
  locale: string;
  redactor: Redactor;
  tracer?: Tracer;
  diagnosed?: boolean;
}

/** Parses and dispatches commands and returns their exit status. */
export class CliApplication {
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly stdout: OutputStream;
  private readonly stderr: OutputStream;
  private readonly factory: ServiceFactory;
  private readonly http: HttpClient | undefined;
  private readonly interruptions: CliInterruptions;
  private readonly cwd: string;
  private readonly terminal: Terminal | undefined;
  private readonly locales = new LocaleResolver({ catalogs: { en }, defaultLocale: "en" });

  constructor(deps: CliApplicationDeps) {
    this.env = deps.env;
    this.stdout = deps.stdout;
    this.stderr = deps.stderr;
    this.cwd = deps.cwd ?? ".";
    this.terminal = deps.terminal;
    this.http = deps.http;
    this.interruptions = deps.interruptions ?? new CliInterruptions();
    this.factory = new ServiceFactory({ http: deps.http, stdout: deps.stdout, stderr: deps.stderr });
  }

  async run(argv: readonly string[]): Promise<number> {
    const state: RunState = { messages: en, locale: "en", redactor: new Redactor() };
    let code: number;
    try {
      const resolved = this.locales.resolve({ flag: this.peekLang(argv), env: this.env });
      state.messages = resolved.messages;
      state.locale = resolved.locale;
      code = await this.execute(argv, state);
    } catch (error) {
      code = this.report(error, state);
    }
    const path = state.tracer?.flush();
    if (path !== undefined && !state.diagnosed) this.stderr.write(`${state.messages.trace.saved({ path: plainLine(path) })}\n`);
    else if (path === undefined && state.tracer !== undefined) {
      this.stderr.write(`${state.messages.trace.unavailable()}\n`);
      if (state.diagnosed && code === 0) code = 1;
    }
    else if (path === undefined && code === 1) this.stderr.write(`${state.messages.trace.enableHint()}\n`);
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

    const { redactor } = state;
    const tracer = this.createTracer(command.global, command.kind === "diagnose", state);
    if (command.kind === "ascii") {
      tracer.event("info", "app", "run.start", { command: command.kind, action: command.request.kind });
      return new AsciiCommand({
        request: command.request, cwd: this.cwd, env: this.env, stdout: this.stdout,
        messages, http: this.http, interruptions: this.interruptions, tracer, quiet: command.global.quiet,
      }).run();
    }
    const { global } = command;
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
      flags: { quiet: global.quiet, concurrency: global.concurrency, trace: state.tracer !== undefined },
    });

    if (command.kind === "tui" && !this.terminal?.interactive) throw new UsageError(messages.cli.tuiNeedsTerminal());
    return this.interruptions.run(async (signal) => {
      const layout = new FrameLayout({ colors: !this.env.NO_COLOR });
      const cookie = await this.obtainCookie(command, messages, layout, signal);
      for (const value of cookie.secretValues()) tracer.addSecret(value);

      const tuiLogger = command.kind === "tui" ? new TuiLogger() : undefined;
      const services = this.factory.create({
        messages, locale: state.locale, tracer, redactor, global, resolved, cookie, logger: tuiLogger, signal,
      });
      return this.build(command, services, { resolved, messages, tracer, layout, tuiLogger, signal }).run();
    });
  }

  /** Only interactive sessions can prompt for a missing cookie. */
  private async obtainCookie(command: MoodleCommand, messages: Messages, layout: FrameLayout, signal: AbortSignal): Promise<SessionCookie> {
    const fromEnv = this.env.MOODLE_COOKIE;
    if (command.kind !== "tui" || (fromEnv ?? "").trim() !== "") return SessionCookie.parse(fromEnv, messages);
    const typed = await new CookiePrompt({ terminal: this.terminal!, messages, layout, signal }).ask();
    return SessionCookie.parse(typed, messages);
  }

  private build(
    command: MoodleCommand,
    services: Services,
    context: { resolved: ResolvedPlatform; messages: Messages; tracer: Tracer; layout: FrameLayout; tuiLogger: TuiLogger | undefined; signal: AbortSignal },
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
            signal: context.signal,
          }),
        });
    }
  }

  private createTracer(global: CommonOptions, forced: boolean, state: RunState): Tracer {
    if (!global.trace && !forced && global.traceDir === undefined) return new NullTracer(state.redactor);
    const runId = randomBytes(4).toString("hex");
    const traceDir = global.traceDir ?? join(this.cwd, `scorm-trace-${runId}`);
    state.diagnosed = forced;
    state.tracer = TraceRecorder.create({
      runId,
      clock: Date.now,
      redactor: state.redactor,
      sink: new FileTraceSink({ dir: traceDir }),
      streaming: true,
      captureBodies: true,
      ringSize: 0,
    });
    return state.tracer;
  }

  private peekLang(argv: readonly string[]): string | undefined {
    const terminator = argv.indexOf("--");
    const index = argv.findIndex((arg) => arg === "--lang" || arg.startsWith("--lang="));
    if (index === -1 || (terminator !== -1 && index > terminator)) return undefined;
    const arg = argv[index]!;
    return arg.startsWith("--lang=") ? arg.slice("--lang=".length) : argv[index + 1];
  }

  private report(error: unknown, { messages, redactor }: RunState): number {
    if (error instanceof AppError) {
      const hint = error instanceof UsageError ? `\n${messages.app.usageHint()}` : "";
      this.stderr.write(`${messages.app.errorPrefix()} ${plainLine(redactor.redact(error.message))}${hint}\n`);
      return error.exitCode;
    }
    const trace = this.env.DEBUG && error instanceof Error && error.stack ? `\n${plainOutput(redactor.redact(error.stack))}` : "";
    const detail = plainLine(redactor.redact(errorMessage(error)));
    this.stderr.write(`${messages.app.unexpectedError({ detail })}${trace}\n`);
    return 1;
  }
}
