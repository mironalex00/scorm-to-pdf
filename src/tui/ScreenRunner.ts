import type { Screen, ScreenResult, Terminal } from "./Terminal.ts";

/** Ejecuta una pantalla: la dibuja, lee una tecla y repite hasta que la pantalla da una respuesta. */
export class ScreenRunner {
  private readonly terminal: Terminal;

  constructor(deps: { terminal: Terminal }) {
    this.terminal = deps.terminal;
  }

  async run<T>(screen: Screen<T>): Promise<Exclude<ScreenResult<T>, { kind: "stay" }>> {
    for (;;) {
      this.terminal.render(screen.render(this.terminal.size()));
      const result = screen.press(await this.terminal.readKey());
      if (result.kind !== "stay") return result;
    }
  }
}
