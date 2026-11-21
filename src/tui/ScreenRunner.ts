import type { Screen, ScreenResult, Terminal } from "./Terminal.ts";

/** Runs a screen until it accepts a value or exits. */
export class ScreenRunner {
  private readonly terminal: Terminal;
  private readonly signal: AbortSignal | undefined;

  constructor(deps: { terminal: Terminal; signal?: AbortSignal | undefined }) {
    this.terminal = deps.terminal;
    this.signal = deps.signal;
  }

  async run<T>(screen: Screen<T>): Promise<Exclude<ScreenResult<T>, { kind: "stay" }>> {
    for (;;) {
      this.terminal.render(screen.render(this.terminal.size()));
      const result = screen.press(await this.terminal.readKey(this.signal));
      if (result.kind !== "stay") return result;
    }
  }
}
