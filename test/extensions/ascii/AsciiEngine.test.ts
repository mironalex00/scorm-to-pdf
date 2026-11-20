import assert from "node:assert/strict";
import { test } from "node:test";
import { AsciiEngine, CELL_HEIGHT, CELL_WIDTH } from "../../../src/extensions/ascii/AsciiEngine.ts";
import { fitAsciiFrame } from "../../../src/extensions/ascii/viewport.ts";

const rgb = (value: number) => Buffer.alloc(CELL_WIDTH * CELL_HEIGHT * 3, value);

test("mantiene la forma del glifo al convertir su propio raster", () => {
  const engine = new AsciiEngine({ chars: " /\\", tone: 0 });
  const grid = engine.frame(rgb(0), 1, 1);
  grid.gi[0] = 1;
  const raster = engine.raster(grid, 1);
  assert.equal(engine.text(engine.frame(raster.buf, 1, 1)), "/");
  assert.equal(engine.text(engine.frame(rgb(0), 1, 1)), " ");
  assert.equal(engine.ansi(grid), "/");
});

test("renderiza color de primer plano y fondo y escapa glifos en HTML", () => {
  const engine = new AsciiEngine({ bg: true, chars: "<&" });
  const grid = engine.frame(rgb(120), 1, 1);
  assert.equal(engine.text(grid), "<");
  assert.match(engine.ansi(grid), /\x1b\[38;2;120;120;120;48;2;120;120;120m<\x1b\[0m/);
  assert.equal(engine.htmlFrame(grid), '<span style="color:#787878;background:#787878">&lt;</span>');
  assert.match(engine.html([grid, grid], 10), /setInterval.*100\)/);
  assert.deepEqual(engine.raster(grid, 1).buf, rgb(120));
});

test("valida dimensiones, cuadros RGB y parámetros de conversión", () => {
  assert.throws(() => new AsciiEngine({ gamma: Infinity }), /Gamma/);
  assert.throws(() => new AsciiEngine({ chars: "ñ" }), /ASCII imprimibles/);
  const engine = new AsciiEngine({ invert: true });
  assert.deepEqual(engine.size(100, 50, 40, 0.5), { cols: 40, rows: 10, w: 240, h: 80 });
  assert.throws(() => engine.size(0, 1, 5, 0.5), /Dimensiones/);
  assert.throws(() => engine.size(1, 100, 500, 1), /demasiado grande/);
  assert.throws(() => engine.frame(rgb(0), 2, 1), /RGB24/);
  assert.throws(() => engine.raster(engine.frame(rgb(0), 1, 1), 1.5), /entero/);
  assert.match(engine.html([engine.frame(rgb(255), 1, 1)]), /background:#fff/);
});

test("centra y recorta cuadros ASCII al tamaño de un visor", () => {
  assert.deepEqual(fitAsciiFrame(["abc"], 7, 5), ["", "", "  abc"]);
  assert.deepEqual(fitAsciiFrame(["012345", "abcdef", "ABCDEF", "678901"], 4, 2), ["bcde", "BCDE"]);
});
