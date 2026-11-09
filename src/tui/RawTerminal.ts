import { emitKeypressEvents } from "node:readline";
import type { KeyName, KeyPress, Terminal, TerminalSize } from "./Terminal.ts";

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l";
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";
const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 };

interface KeypressInfo {
  readonly name?: string;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
}
type KeypressListener = (str: string | undefined, key: KeypressInfo | undefined) => void;

export interface TerminalInput {
  readonly isTTY?: boolean | undefined;
  readonly setRawMode?: ((mode: boolean) => unknown) | undefined;
  resume(): unknown;
  pause(): unknown;
  on(event: "keypress", listener: KeypressListener): unknown;
  off(event: "keypress", listener: KeypressListener): unknown;
}

export interface TerminalOutput {
  readonly isTTY?: boolean | undefined;
  readonly columns?: number | undefined;
  readonly rows?: number | undefined;
  write(text: string): unknown;
}

const NAMED_KEYS: Readonly<Record<string, KeyName>> = {
  up: "up", down: "down", left: "left", right: "right", return: "enter", enter: "enter",
  backspace: "backspace", tab: "tab", pageup: "pageup", pagedown: "pagedown", home: "home", end: "end",
};

/** Teclado y pantalla reales: stdin en modo raw y stdout en pantalla alternativa, con códigos ANSI estándar. */
export class RawTerminal implements Terminal {
  private readonly input: TerminalInput;
  private readonly output: TerminalOutput;
  private readonly queue: KeyPress[] = [];
  private waiter: ((key: KeyPress) => void) | undefined;
  private opened = false;

  private readonly onKeypress: KeypressListener = (str, info) => {
    for (const key of this.decode(str, info)) {
      const waiting = this.waiter;
      if (waiting) {
        this.waiter = undefined;
        waiting(key);
      } else {
        this.queue.push(key);
      }
    }
  };

  constructor(deps: { input: TerminalInput; output: TerminalOutput }) {
    this.input = deps.input;
    this.output = deps.output;
  }

  get interactive(): boolean {
    return this.input.isTTY === true && this.output.isTTY === true && typeof this.input.setRawMode === "function";
  }

  size(): TerminalSize {
    return { columns: this.output.columns ?? DEFAULT_SIZE.columns, rows: this.output.rows ?? DEFAULT_SIZE.rows };
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    emitKeypressEvents(this.input as unknown as NodeJS.ReadableStream);
    this.input.setRawMode!(true);
    this.input.resume();
    this.input.on("keypress", this.onKeypress);
    this.output.write(ENTER_SCREEN);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.input.off("keypress", this.onKeypress);
    this.input.setRawMode!(false);
    this.input.pause();
    this.output.write(LEAVE_SCREEN);
  }

  render(lines: readonly string[]): void {
    this.output.write(`\x1b[H${lines.map((line) => `${line}\x1b[K`).join("\r\n")}\x1b[J`);
  }

  readKey(): Promise<KeyPress> {
    const next = this.queue.shift();
    if (next) return Promise.resolve(next);
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }

  /** Traduce un evento de readline a nuestras teclas; ignora teclas de función y combinaciones con Ctrl/Alt. */
  private decode(str: string | undefined, info: KeypressInfo | undefined): KeyPress[] {
    if (info?.ctrl && info.name === "c") return [{ name: "ctrl-c" }];
    // Un Esc suelto llega de readline con meta: true (se emite por su temporizador de secuencias),
    // así que debe reconocerse antes de descartar las combinaciones con Alt.
    if (info?.name === "escape") return [{ name: "escape" }];
    if (info?.ctrl || info?.meta) return [];
    if (info?.name === "space") return [{ name: "space", char: " " }];

    const named = info?.name ? NAMED_KEYS[info.name] : undefined;
    if (named) return [{ name: named }];
    if (info?.name && info.name.length > 1) return [];

    return [...(str ?? "")]
      .filter((char) => char >= " " && char !== "\x7f")
      .map((char): KeyPress => (char === " " ? { name: "space", char } : { name: "char", char }));
  }
}
