import type { TuiApplication } from "../tui/TuiApplication.ts";
import type { Command } from "./Command.ts";

/** Orden por defecto en una terminal interactiva: abre el selector. */
export class TuiCommand implements Command {
  private readonly app: TuiApplication;

  constructor(deps: { app: TuiApplication }) {
    this.app = deps.app;
  }

  run(): Promise<number> {
    return this.app.run();
  }
}
