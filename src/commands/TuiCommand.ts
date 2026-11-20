import type { TuiApplication } from "../tui/TuiApplication.ts";
import type { Command } from "./Command.ts";

/** Opens the course selector on an interactive terminal. */
export class TuiCommand implements Command {
  private readonly app: TuiApplication;

  constructor(deps: { app: TuiApplication }) {
    this.app = deps.app;
  }

  run(): Promise<number> {
    return this.app.run();
  }
}
