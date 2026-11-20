import { emitKeypressEvents } from "node:readline";
import type { KeyName, KeyPress, Terminal, TerminalSize } from "./Terminal.ts";

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l";
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l";
const DEFAULT_SIZE: TerminalSize = { columns: 80, rows: 24 };
const MAX_PENDING_KEYS = 16_384;

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

/** Reads raw terminal input and renders to the alternate screen. */
export class RawTerminal implements Terminal {
  private readonly input: TerminalInput;
  private readonly output: TerminalOutput;
  private readonly interrupt: (() => boolean) | undefined;
  private readonly queue: KeyPress[] = [];
  private waiter: ((key: KeyPress) => void) | undefined;
  private opened = false;

  private readonly onKeypress: KeypressListener = (str, info) => {
    for (const key of this.decode(str, info)) {
      if (key.name === "ctrl-c" && this.interrupt?.()) continue;
      const waiting = this.waiter;
      if (waiting) {
        this.waiter = undefined;
        waiting(key);
      } else if (this.queue.length < MAX_PENDING_KEYS) {
        this.queue.push(key);
      }
    }
  };

  constructor(deps: { input: TerminalInput; output: TerminalOutput; interrupt?: () => boolean }) {
    this.input = deps.input;
    this.output = deps.output;
    this.interrupt = deps.interrupt;
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
    this.queue.length = 0;
    this.waiter?.({ name: "ctrl-c" });
    this.waiter = undefined;
    this.input.setRawMode!(false);
    this.input.pause();
    this.output.write(LEAVE_SCREEN);
  }

  render(lines: readonly string[]): void {
    this.output.write(`\x1b[H${lines.map((line) => `${line}\x1b[K`).join("\r\n")}\x1b[J`);
  }

  async readKey(signal?: AbortSignal): Promise<KeyPress> {
    signal?.throwIfAborted();
    const next = this.queue.shift();
    if (next) return next;
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.waiter = undefined;
        reject(signal?.reason);
      };
      this.waiter = (key) => {
        signal?.removeEventListener("abort", abort);
        resolve(key);
      };
      signal?.addEventListener("abort", abort, { once: true });
    });
  }

  /** Maps readline events to keys understood by the interactive screens. */
  private decode(str: string | undefined, info: KeypressInfo | undefined): KeyPress[] {
    if (info?.ctrl && info.name === "c") return [{ name: "ctrl-c" }];
    // Readline sets meta on a standalone Escape when its escape-sequence timer expires.
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
