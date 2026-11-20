import type { HttpClient } from "../application/ports.ts";
import type { CliInterruptions } from "../cli/CliInterruptions.ts";
import type { AsciiRequest } from "../cli/commands.ts";
import { run } from "../extensions/ascii/index.ts";
import { PortableMediaRuntime } from "../extensions/ascii/runtime.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { OutputStream } from "../infra/ConsoleLogger.ts";
import type { Tracer } from "../tracing/Tracer.ts";
import type { Command } from "./Command.ts";

interface AsciiCommandDeps {
  readonly request: AsciiRequest;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: OutputStream;
  readonly messages: Messages;
  readonly http: HttpClient | undefined;
  readonly interruptions: CliInterruptions;
  readonly tracer: Tracer;
  readonly quiet: boolean;
}

export class AsciiCommand implements Command {
  private readonly deps: AsciiCommandDeps;

  constructor(deps: AsciiCommandDeps) {
    this.deps = deps;
  }

  run(): Promise<number> {
    const { interruptions, request, stdout, cwd, messages, tracer } = this.deps;
    const runtime = new PortableMediaRuntime(this.deps);
    return interruptions.run((signal) => tracer.span("ascii", request.kind, {}, async () => {
      if (request.kind === "prepare") {
        await runtime.prepare(signal);
        if (!this.deps.quiet) stdout.write(messages.ascii.prepared() + "\n");
      } else {
        await run(request.input, { ...request.options, signal }, { cwd, stdout, runtime });
      }
    }));
  }
}
