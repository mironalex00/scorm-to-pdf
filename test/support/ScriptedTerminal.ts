import type { KeyName, KeyPress, Terminal, TerminalSize } from "../../src/tui/Terminal.ts";

export const key = (name: Exclude<KeyName, "char">): KeyPress => ({ name, ...(name === "space" && { char: " " }) });
export const chars = (text: string): KeyPress[] => [...text].map((char) => (char === " " ? key("space") : { name: "char", char }));

/** Replays a key script and records frames and terminal state changes. */
export class ScriptedTerminal implements Terminal {
  readonly frames: string[][] = [];
  opened = 0;
  closed = 0;
  interactive = true;
  private readonly keys: KeyPress[];
  private readonly dimensions: TerminalSize;

  constructor(keys: readonly KeyPress[], dimensions: TerminalSize = { columns: 80, rows: 24 }) {
    this.keys = [...keys];
    this.dimensions = dimensions;
  }

  size(): TerminalSize {
    return this.dimensions;
  }
  open(): void {
    this.opened += 1;
  }
  close(): void {
    this.closed += 1;
  }
  render(lines: readonly string[]): void {
    this.frames.push([...lines]);
  }
  async readKey(): Promise<KeyPress> {
    const next = this.keys.shift();
    if (!next) throw new Error("ScriptedTerminal ran out of keys");
    return next;
  }
  get lastFrame(): string {
    return (this.frames.at(-1) ?? []).join("\n");
  }
  allFrames(): string {
    return this.frames.map((frame) => frame.join("\n")).join("\n=====\n");
  }
  get remainingKeys(): number {
    return this.keys.length;
  }
}
