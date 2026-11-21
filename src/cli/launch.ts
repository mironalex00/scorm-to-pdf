import { setImmediate } from "node:timers/promises";
import { CliApplication } from "../CliApplication.ts";
import { RawTerminal } from "../tui/RawTerminal.ts";
import { CliInterruptions, withProcessSignals } from "./CliInterruptions.ts";

export async function launch(argv: readonly string[]): Promise<void> {
  const interruptions = new CliInterruptions();
  const terminal = new RawTerminal({ input: process.stdin, output: process.stdout, interrupt: () => interruptions.request(130) });
  let outputClosed = false;
  let earlyExit: number | undefined;
  const outputError = (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
    outputClosed = true;
    interruptions.request(0);
  };
  process.stdout.on("error", outputError);
  try {
    const application = new CliApplication({
      env: process.env, stdout: process.stdout, stderr: process.stderr, terminal, interruptions,
    });
    const code = await withProcessSignals(() => application.run(argv), (signalCode) => {
      if (!interruptions.request(signalCode)) earlyExit = signalCode;
    });
    if (!process.stdout.destroyed) await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
    await setImmediate();
    process.exitCode = outputClosed ? 0 : (earlyExit ?? code);
  } finally {
    process.stdout.off("error", outputError);
  }
}
