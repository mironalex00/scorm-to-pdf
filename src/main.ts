import { launch } from "./cli/launch.ts";

// Un rechazo sin capturar es un bug: que falle con ruido en lugar de seguir en silencio.
process.on("unhandledRejection", (reason) => {
  throw reason;
});

await launch(process.argv.slice(2));
