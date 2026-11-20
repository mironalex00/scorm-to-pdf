import assert from "node:assert/strict";
import { test } from "node:test";
import { AsciiEngine, CELL_HEIGHT, CELL_WIDTH } from "../../../src/extensions/ascii/AsciiEngine.ts";
import { fitAsciiFrame } from "../../../src/extensions/ascii/viewport.ts";

const rgb = (value: number) => Buffer.alloc(CELL_WIDTH * CELL_HEIGHT * 3, value);

test("preserves the glyph shape after a raster round trip", () => {
  const engine = new AsciiEngine({ chars: " /\\", tone: 0 });
  const grid = engine.frame(rgb(0), 1, 1);
  grid.gi[0] = 1;
  const raster = engine.raster(grid, 1);
  assert.equal(engine.text(engine.frame(raster.buf, 1, 1)), "/");
  assert.equal(engine.text(engine.frame(rgb(0), 1, 1)), " ");
  assert.equal(engine.ansi(grid), "/");
});

test("renders foreground and background colors and escapes HTML glyphs", () => {
  const engine = new AsciiEngine({ bg: true, chars: "<&" });
  const grid = engine.frame(rgb(120), 1, 1);
  assert.equal(engine.text(grid), "<");
  assert.match(engine.ansi(grid), /\x1b\[38;2;120;120;120;48;2;120;120;120m<\x1b\[0m/);
  assert.equal(engine.htmlFrame(grid), '<span style="color:#787878;background:#787878">&lt;</span>');
  assert.match(engine.html([grid, grid], 10), /setInterval.*100\)/);
  assert.deepEqual(engine.raster(grid, 1).buf, rgb(120));
});

test("renders dark colored ink on light paper when inversion is enabled", () => {
  const engine = new AsciiEngine({ color: true, invert: true, chars: " #" });
  const dark = engine.frame(rgb(0), 1, 1);
  const light = engine.frame(rgb(255), 1, 1);
  assert.equal(engine.text(dark), "#");
  assert.equal(engine.text(light), " ");
  assert.match(engine.ansi(dark), /\x1b\[38;2;0;0;0;48;2;255;255;255m#/);
  assert.match(engine.html([dark]), /background:#fff.*<span style="color:#000000">#/);
  assert.deepEqual(new Set(engine.raster(dark, 1).buf), new Set([0, 255]));
  assert.deepEqual(engine.raster(light, 1).buf, rgb(255));
});

test("validates dimensions, RGB frames, and conversion settings", () => {
  assert.throws(() => new AsciiEngine({ gamma: Infinity }), /Gamma/);
  assert.throws(() => new AsciiEngine({ chars: "ñ" }), /printable ASCII/);
  const engine = new AsciiEngine({ invert: true });
  assert.deepEqual(engine.size(100, 50, 40, 0.5), { cols: 40, rows: 10, w: 240, h: 80 });
  assert.throws(() => engine.size(0, 1, 5, 0.5), /Invalid dimensions/);
  assert.throws(() => engine.size(1, 100, 500, 1), /too large/);
  assert.throws(() => engine.frame(rgb(0), 2, 1), /RGB24/);
  assert.throws(() => engine.raster(engine.frame(rgb(0), 1, 1), 1.5), /an integer/);
  assert.match(engine.html([engine.frame(rgb(255), 1, 1)]), /background:#fff/);
});

test("centers and crops ASCII frames to the viewport", () => {
  assert.deepEqual(fitAsciiFrame(["abc"], 7, 5), ["", "", "  abc"]);
  assert.deepEqual(fitAsciiFrame(["012345", "abcdef", "ABCDEF", "678901"], 4, 2), ["bcde", "BCDE"]);
});
