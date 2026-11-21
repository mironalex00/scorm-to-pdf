import type { CommandPlugin, PluginCommandContext } from "../../cli/CommandPlugin.ts";
import { ASCII_OPTIONS } from "./options.ts";
import { parseAsciiRequest } from "./parse.ts";
import type { AsciiRequest } from "./parse.ts";

async function runRequest(request: AsciiRequest, context: PluginCommandContext): Promise<void> {
  const { cwd, messages, stdout, signal, quiet } = context;
  const { PortableMediaRuntime } = await import("./runtime.ts");
  const runtime = new PortableMediaRuntime(context);
  if (request.kind === "prepare") {
    await runtime.prepare(signal);
    if (!quiet) stdout.write(messages.ascii.prepared() + "\n");
    return;
  }

  const { run } = await import("./index.ts");
  await run(request.input, { ...request.options, signal }, { cwd, stdout, runtime, messages });
}

export const asciiFirePlugin: CommandPlugin = {
  id: "ascii-fire",
  command: "ascii",
  options: ASCII_OPTIONS,
  environmentKeys: ["SCORM_ASCII_CACHE"],
  describe: ({ help }, program) => ({
    listing: help.asciiCommandLine({ program }),
    intro: help.asciiIntro({ program }),
    heading: help.asciiHeading(),
    footer: help.asciiEnvironment(),
  }),
  parse: (options, positionals, messages) => {
    const request = parseAsciiRequest(options, positionals, messages);
    return { action: request.kind, run: (context) => runRequest(request, context) };
  },
};
