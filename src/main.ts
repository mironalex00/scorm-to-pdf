import { launch } from "./cli/launch.ts";

// Treat an unhandled rejection as a fatal error.
process.on("unhandledRejection", (reason) => {
  throw reason;
});

await launch(process.argv.slice(2));
