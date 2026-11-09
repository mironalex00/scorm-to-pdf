import { CliApplication } from "./CliApplication.ts";
import { RawTerminal } from "./tui/RawTerminal.ts";

// Un rechazo sin capturar es un bug: que falle con ruido en lugar de seguir en silencio.
process.on("unhandledRejection", (reason) => {
  throw reason;
});

const terminal = new RawTerminal({ input: process.stdin, output: process.stdout });

// En modo raw Ctrl+C no genera SIGINT, pero una señal externa no debe dejar la terminal rota.
process.on("SIGTERM", () => {
  terminal.close();
  process.exit(143);
});

const application = new CliApplication({
  env: process.env,
  stdout: process.stdout,
  stderr: process.stderr,
  terminal,
});

process.exitCode = await application.run(process.argv.slice(2));
