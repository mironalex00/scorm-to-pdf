import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { RawTerminal } from "../../src/tui/RawTerminal.ts";

class FakeInput extends EventEmitter {
  isTTY: boolean | undefined = true;
  setRawMode: ((mode: boolean) => unknown) | undefined = (mode) => void this.raw.push(mode);
  readonly raw: boolean[] = [];
  resumed = 0;
  paused = 0;
  resume() {
    this.resumed += 1;
  }
  pause() {
    this.paused += 1;
  }
  press(str: string | undefined, key: Record<string, unknown> | undefined) {
    this.emit("keypress", str, key);
  }
}

class FakeOutput {
  isTTY: boolean | undefined = true;
  columns: number | undefined = 100;
  rows: number | undefined = 30;
  readonly written: string[] = [];
  write(text: string) {
    this.written.push(text);
    return true;
  }
}

function make() {
  const input = new FakeInput();
  const output = new FakeOutput();
  return { input, output, terminal: new RawTerminal({ input, output }) };
}

describe("RawTerminal state", () => {
  it("requires TTY input, TTY output, and raw mode for interactivity", () => {
    assert.equal(make().terminal.interactive, true);
    const noInputTty = make();
    noInputTty.input.isTTY = undefined;
    assert.equal(new RawTerminal({ input: noInputTty.input, output: noInputTty.output }).interactive, false);
    const noOutputTty = make();
    noOutputTty.output.isTTY = false;
    assert.equal(new RawTerminal({ input: noOutputTty.input, output: noOutputTty.output }).interactive, false);
    const noRaw = make();
    noRaw.input.setRawMode = undefined;
    assert.equal(new RawTerminal({ input: noRaw.input, output: noRaw.output }).interactive, false);
  });

  it("reports the terminal size or defaults to 80 by 24", () => {
    const { terminal, output } = make();
    assert.deepEqual(terminal.size(), { columns: 100, rows: 30 });
    output.columns = undefined;
    output.rows = undefined;
    assert.deepEqual(terminal.size(), { columns: 80, rows: 24 });
  });
});

describe("RawTerminal opening and closing", () => {
  it("enters the alternate screen in raw mode and restores the terminal on close", () => {
    const { terminal, input, output } = make();
    terminal.open();
    assert.deepEqual(input.raw, [true]);
    assert.equal(input.resumed, 1);
    assert.equal(input.listenerCount("keypress"), 1);
    assert.equal(output.written.join(""), "\x1b[?1049h\x1b[?25l");

    terminal.close();
    assert.deepEqual(input.raw, [true, false]);
    assert.equal(input.paused, 1);
    assert.equal(input.listenerCount("keypress"), 0);
    assert.equal(output.written.join(""), "\x1b[?1049h\x1b[?25l\x1b[?25h\x1b[?1049l");
  });

  it("allows repeated calls to open and close", () => {
    const { terminal, input, output } = make();
    terminal.close();
    assert.deepEqual([input.raw, output.written], [[], []]);
    terminal.open();
    terminal.open();
    assert.deepEqual(input.raw, [true]);
    terminal.close();
    terminal.close();
    assert.deepEqual(input.raw, [true, false]);
  });

  it("cancels a pending read when the terminal closes", async () => {
    const { terminal } = make();
    terminal.open();
    const pending = terminal.readKey();
    terminal.close();
    assert.deepEqual(await pending, { name: "ctrl-c" });
  });

  it("discards queued keys when the terminal closes", async () => {
    const { terminal, input } = make();
    terminal.open();
    input.press("a", undefined);
    terminal.close();
    terminal.open();
    input.press("b", undefined);
    assert.deepEqual(await terminal.readKey(), { name: "char", char: "b" });
    terminal.close();
  });
});

describe("RawTerminal rendering", () => {
  it("positions the cursor and clears old frame content", () => {
    const { terminal, output } = make();
    terminal.render(["uno", "dos"]);
    assert.equal(output.written[0], "\x1b[H" + "uno\x1b[K\r\n" + "dos\x1b[K" + "\x1b[J");
  });
});

describe("RawTerminal input", () => {
  const read = async (str: string | undefined, key: Record<string, unknown> | undefined) => {
    const { terminal, input } = make();
    terminal.open();
    input.press(str, key);
    return terminal.readKey();
  };

  const named: Array<[string, Record<string, unknown>, string]> = [
    ["\x1b[A", { name: "up" }, "up"],
    ["\x1b[B", { name: "down" }, "down"],
    ["\x1b[D", { name: "left" }, "left"],
    ["\x1b[C", { name: "right" }, "right"],
    ["\r", { name: "return" }, "enter"],
    ["\n", { name: "enter" }, "enter"],
    ["\x1b", { name: "escape" }, "escape"],
    // readline reports a standalone Escape with meta set after its sequence timeout.
    ["\x1b", { name: "escape", meta: true, sequence: "\x1b" }, "escape"],
    ["\x7f", { name: "backspace" }, "backspace"],
    ["\t", { name: "tab" }, "tab"],
    ["\x1b[5~", { name: "pageup" }, "pageup"],
    ["\x1b[6~", { name: "pagedown" }, "pagedown"],
    ["\x1b[H", { name: "home" }, "home"],
    ["\x1b[F", { name: "end" }, "end"],
  ];
  for (const [str, key, expected] of named) {
    it(`decodes ${expected} (${JSON.stringify(str)})`, async () => assert.deepEqual(await read(str, key), { name: expected }));
  }

  it("decodes spaces, printable characters, and Ctrl+C", async () => {
    assert.deepEqual(await read(" ", { name: "space" }), { name: "space", char: " " });
    assert.deepEqual(await read("a", { name: "a" }), { name: "char", char: "a" });
    assert.deepEqual(await read("A", { name: "a", shift: true }), { name: "char", char: "A" });
    assert.deepEqual(await read("ñ", {}), { name: "char", char: "ñ" });
    assert.deepEqual(await read("\x03", { name: "c", ctrl: true }), { name: "ctrl-c" });
  });

  it("splits pasted text into individual keys and ignores nonprintable input", async () => {
    const { terminal, input } = make();
    terminal.open();
    input.press("ab c", undefined);
    input.press("\x1bOP", { name: "f1" });
    input.press(undefined, undefined);
    input.press("\x01", { name: "a", ctrl: true });
    input.press("\x1ba", { name: "a", meta: true });
    assert.deepEqual(
      [await terminal.readKey(), await terminal.readKey(), await terminal.readKey(), await terminal.readKey()],
      [{ name: "char", char: "a" }, { name: "char", char: "b" }, { name: "space", char: " " }, { name: "char", char: "c" }],
    );
  });

  it("waits for a key and returns queued keys in order", async () => {
    const { terminal, input } = make();
    terminal.open();
    const pending = terminal.readKey();
    input.press("\x1b[A", { name: "up" });
    assert.deepEqual(await pending, { name: "up" });
    input.press("\x1b[B", { name: "down" });
    input.press("\r", { name: "return" });
    assert.deepEqual([await terminal.readKey(), await terminal.readKey()], [{ name: "down" }, { name: "enter" }]);
  });

  it("releases an aborted pending read so the next key reaches the next reader", async () => {
    const { terminal, input } = make();
    terminal.open();
    const controller = new AbortController();
    const cancelled = new Error("Reading was cancelled");
    const pending = terminal.readKey(controller.signal);
    controller.abort(cancelled);
    await assert.rejects(pending, cancelled);
    const next = terminal.readKey();
    input.press("\r", { name: "return" });
    assert.deepEqual(await next, { name: "enter" });
    terminal.close();
  });
});
