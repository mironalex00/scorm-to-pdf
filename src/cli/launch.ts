import { CliApplication } from "../CliApplication.ts";
import { RawTerminal } from "../tui/RawTerminal.ts";
import { CliInterruptions } from "./CliInterruptions.ts";
import type { InterruptCode } from "./CliInterruptions.ts";

export async function launch(argv: readonly string[]): Promise<void> {
  const terminal = new RawTerminal({ input: process.stdin, output: process.stdout });
  const interruptions = new CliInterruptions();
  const stop = (code: Exclude<InterruptCode, 0>) => {
    if (interruptions.request(code)) return;
    terminal.close();
    process.exit(code);
  };
  const handlers = [
    ["SIGHUP", () => stop(129)],
    ["SIGINT", () => stop(130)],
    ["SIGTERM", () => stop(143)],
  ] as const;
  const outputError = (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
    if (!interruptions.request(0)) process.exit(0);
  };
  for (const [signal, handler] of handlers) process.on(signal, handler);
  process.stdout.on("error", outputError);
  try {
    const application = new CliApplication({
      env: process.env, stdout: process.stdout, stderr: process.stderr, terminal, interruptions,
    });
    process.exitCode = await application.run(argv);
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}
