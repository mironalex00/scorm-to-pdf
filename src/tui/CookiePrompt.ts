import type { Messages } from "../i18n/Messages.ts";
import type { FrameLayout } from "./FrameLayout.ts";
import { ScreenRunner } from "./ScreenRunner.ts";
import { TextPromptScreen } from "./screens/TextPromptScreen.ts";
import type { Terminal } from "./Terminal.ts";

/** Prompts for a session cookie when MOODLE_COOKIE is unset. */
export class CookiePrompt {
  private readonly terminal: Terminal;
  private readonly messages: Messages;
  private readonly layout: FrameLayout;
  private readonly signal: AbortSignal | undefined;

  constructor(deps: { terminal: Terminal; messages: Messages; layout: FrameLayout; signal?: AbortSignal }) {
    this.terminal = deps.terminal;
    this.messages = deps.messages;
    this.layout = deps.layout;
    this.signal = deps.signal;
  }

  async ask(): Promise<string | undefined> {
    const { tui } = this.messages;
    this.terminal.open();
    try {
      const result = await new ScreenRunner({ terminal: this.terminal, signal: this.signal }).run(
        new TextPromptScreen({
          title: tui.cookieTitle(),
          lines: tui.cookieLines(),
          label: tui.cookieLabel(),
          mask: true,
          initial: "",
          footer: tui.keysPrompt(),
          layout: this.layout,
        }),
      );
      return result.kind === "done" ? result.value : undefined;
    } finally {
      this.terminal.close();
    }
  }
}
