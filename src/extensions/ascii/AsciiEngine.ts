import { FONT } from "./font.ts";

export const CELL_WIDTH = 6;
export const CELL_HEIGHT = 8;
const PIXELS = CELL_WIDTH * CELL_HEIGHT;
const PRINTABLE_ASCII = /^[\x20-\x7e]$/;

export interface AsciiOptions {
  readonly chars?: string;
  readonly bg?: boolean;
  readonly color?: boolean;
  readonly invert?: boolean;
  readonly gamma?: number;
  readonly tone?: number;
}

export interface AsciiGrid {
  readonly cols: number;
  readonly rows: number;
  readonly gi: Uint8Array;
  readonly fg: Uint8Array;
  readonly bg: Uint8Array;
}

export interface RasterFrame {
  readonly buf: Buffer;
  readonly w: number;
  readonly h: number;
}

interface Glyph {
  readonly char: string;
  readonly mask: Uint8Array;
  readonly on: Uint8Array;
  readonly density: number;
}

function glyphMask(char: string): Uint8Array {
  const offset = (char.charCodeAt(0) - 32) * 5;
  const mask = new Uint8Array(PIXELS);
  for (let y = 0; y < 7; y++) {
    for (let x = 0; x < 5; x++) mask[y * CELL_WIDTH + x] = (FONT[offset + x]! >> y) & 1;
  }
  return mask;
}

function packedColor(colors: Uint8Array, offset: number): number {
  return (colors[offset]! << 16) | (colors[offset + 1]! << 8) | colors[offset + 2]!;
}

function hexColor(colors: Uint8Array, offset: number): string {
  return packedColor(colors, offset).toString(16).padStart(6, "0");
}

function escapeHTML(char: string): string {
  return char.replace(/[&<>]/g, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[symbol]!);
}

/** Ajusta la forma y el tono de cada celda RGB a los 95 glifos ASCII imprimibles. */
export class AsciiEngine {
  private readonly glyphs: readonly Glyph[];
  private readonly flat: number;
  private readonly lut: Uint8Array;
  private readonly options: Required<AsciiOptions>;
  private readonly colored: boolean;

  constructor(options: AsciiOptions = {}) {
    const { chars = "", bg = false, color = false, invert = false, gamma = 1, tone = 1 } = options;
    if (!Number.isFinite(gamma) || gamma <= 0 || !Number.isFinite(tone) || tone < 0) {
      throw new Error("Gamma debe ser positiva y el peso del tono debe ser no negativo.");
    }
    this.options = { chars, bg, color, invert, gamma, tone };
    const alphabet = chars ? [...new Set([...chars].filter((char) => PRINTABLE_ASCII.test(char)))]
      : Array.from({ length: 95 }, (_, index) => String.fromCharCode(index + 32));
    if (alphabet.length === 0) throw new Error("--chars no contiene caracteres ASCII imprimibles.");
    const masks = alphabet.map(glyphMask);
    const dots = masks.map((mask) => Uint8Array.from([...mask.keys()].filter((index) => mask[index] === 1)));
    const maxDots = Math.max(1, ...dots.map((indices) => indices.length));
    this.glyphs = alphabet.map((char, index) => ({
      char, mask: masks[index]!, on: dots[index]!, density: dots[index]!.length / maxDots,
    }));
    this.flat = this.glyphs.reduce((best, glyph, index) => glyph.on.length < this.glyphs[best]!.on.length ? index : best, 0);
    this.lut = Uint8Array.from({ length: 256 }, (_, value) => {
      const adjusted = (value / 255) ** (1 / gamma);
      return Math.round(255 * (invert ? 1 - adjusted : adjusted));
    });
    this.colored = bg || color;
  }

  size(srcW: number, srcH: number, cols: number, aspect: number) {
    if (![srcW, srcH, cols].every((value) => Number.isSafeInteger(value) && value > 0) ||
        !Number.isFinite(aspect) || aspect <= 0) throw new Error("Dimensiones o proporción inválidas.");
    const rows = Math.max(1, Math.round(cols * aspect * srcH / srcW));
    if (cols > 500 || rows > 500 || cols * rows > 75_000) throw new Error("La rejilla ASCII es demasiado grande.");
    return { cols, rows, w: cols * CELL_WIDTH, h: rows * CELL_HEIGHT };
  }

  frame(rgb: Uint8Array, cols: number, rows: number): AsciiGrid {
    const cells = cols * rows;
    if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols <= 0 || rows <= 0 ||
        cells * PIXELS * 3 !== rgb.length) throw new Error("El cuadro RGB24 no coincide con la rejilla.");
    const gi = new Uint8Array(cells);
    const fg = new Uint8Array(cells * 3);
    const bg = new Uint8Array(cells * 3);
    const luminance = new Uint8Array(PIXELS);
    const offsets = new Uint32Array(PIXELS);
    const stride = cols * CELL_WIDTH * 3;
    const { bg: useBg, color, tone } = this.options;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        let total = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        let cellPixel = 0;
        for (let y = 0; y < CELL_HEIGHT; y++) {
          let offset = (cy * CELL_HEIGHT + y) * stride + cx * CELL_WIDTH * 3;
          for (let x = 0; x < CELL_WIDTH; x++, offset += 3, cellPixel++) {
            const r = rgb[offset]!;
            const g = rgb[offset + 1]!;
            const b = rgb[offset + 2]!;
            red += r; green += g; blue += b;
            const value = this.lut[(r * 77 + g * 150 + b * 29) >> 8]!;
            offsets[cellPixel] = offset;
            luminance[cellPixel] = value;
            total += value;
          }
        }

        const max = Math.max(red, green, blue) || 1;
        const tint = !useBg && color ? [red * 255 / max, green * 255 / max, blue * 255 / max] : [255, 255, 255];
        const inkLum = (tint[0]! * 77 + tint[1]! * 150 + tint[2]! * 29) / 256;
        const index = cy * cols + cx;
        const best = this.match(luminance, total, inkLum, tone, useBg);
        gi[index] = best;

        if (!useBg) {
          fg.set(tint.map(Math.round), index * 3);
          continue;
        }
        const on = this.glyphs[best]!.on;
        const offCount = PIXELS - on.length;
        let inkRed = 0;
        let inkGreen = 0;
        let inkBlue = 0;
        for (const pixel of on) {
          const offset = offsets[pixel]!;
          inkRed += rgb[offset]!;
          inkGreen += rgb[offset + 1]!;
          inkBlue += rgb[offset + 2]!;
        }
        const paper = [(red - inkRed) / offCount, (green - inkGreen) / offCount, (blue - inkBlue) / offCount];
        bg.set(paper.map(Math.round), index * 3);
        const ink = on.length ? [inkRed / on.length, inkGreen / on.length, inkBlue / on.length] : paper;
        fg.set(ink.map(Math.round), index * 3);
      }
    }
    return { cols, rows, gi, fg, bg };
  }

  private match(values: Uint8Array, total: number, inkLum: number, tone: number, useBg: boolean): number {
    let best = this.flat;
    let bestScore = -Infinity;
    const mean = total / PIXELS;
    for (const [index, glyph] of this.glyphs.entries()) {
      let onSum = 0;
      for (const pixel of glyph.on) onSum += values[pixel]!;
      const n = glyph.on.length;
      const off = PIXELS - n;
      const contrast = n === 0 ? 0 : onSum / n - (total - onSum) / off;
      // Con fondo de color es válido que la tinta sea más oscura que el fondo.
      const shape = useBg ? contrast : Math.max(0, contrast);
      const error = mean - inkLum * glyph.density;
      const score = shape * shape * n * off / PIXELS - (useBg ? 0 : tone * PIXELS * error * error);
      if (score > bestScore) {
        bestScore = score;
        best = index;
      }
    }
    return useBg && bestScore < 200 ? this.flat : best;
  }

  text(grid: AsciiGrid): string {
    return this.lines(grid, (index) => this.glyphs[grid.gi[index]!]!.char).join("\n");
  }

  ansi(grid: AsciiGrid): string {
    if (!this.colored) return this.text(grid);
    const { cols, fg, bg } = grid;
    let previousFg = -1;
    let previousBg = -1;
    return this.lines(grid, (index, x) => {
      if (x === 0) { previousFg = -1; previousBg = -1; }
      const char = this.glyphs[grid.gi[index]!]!.char;
      const offset = index * 3;
      const fgKey = packedColor(fg, offset);
      const bgKey = this.options.bg ? packedColor(bg, offset) : -1;
      let prefix = "";
      if ((this.options.bg || char !== " ") && (fgKey !== previousFg || bgKey !== previousBg)) {
        const foreground = [fg[offset], fg[offset + 1], fg[offset + 2]].join(";");
        const background = this.options.bg ? ";48;2;" + [bg[offset], bg[offset + 1], bg[offset + 2]].join(";") : "";
        prefix = "\x1b[38;2;" + foreground + background + "m";
        previousFg = fgKey;
        previousBg = bgKey;
      }
      return prefix + char + (x === cols - 1 ? "\x1b[0m" : "");
    }).join("\n");
  }

  htmlFrame(grid: AsciiGrid): string {
    const { cols, fg, bg } = grid;
    let previous = "";
    return this.lines(grid, (index, x) => {
      const char = escapeHTML(this.glyphs[grid.gi[index]!]!.char);
      const offset = index * 3;
      const style = this.colored && (this.options.bg || char !== " ")
        ? "color:#" + hexColor(fg, offset) + (this.options.bg ? ";background:#" + hexColor(bg, offset) : "")
        : "";
      let markup = char;
      if (style !== previous) {
        markup = (previous ? "</span>" : "") + (style ? '<span style="' + style + '">' : "") + markup;
        previous = style;
      }
      if (x === cols - 1 && previous) {
        markup += "</span>";
        previous = "";
      }
      return markup;
    }).join("\n");
  }

  html(grids: readonly AsciiGrid[], fps = 12): string {
    const grid = grids[0];
    if (!grid) throw new Error("HTML necesita al menos un cuadro.");
    return this.htmlDocument(grids.map((frame) => this.htmlFrame(frame)), grid.cols, fps);
  }

  htmlDocument(frames: readonly string[], cols: number, fps: number): string {
    if (frames.length === 0 || !Number.isInteger(cols) || cols < 1 || !Number.isFinite(fps) || fps <= 0) {
      throw new Error("HTML necesita cuadros, columnas y una frecuencia positiva.");
    }
    const light = !this.colored && this.options.invert;
    const css = "body{margin:0;min-height:100vh;display:grid;place-items:center;background:" + (light ? "#fff" : "#000") +
      "}pre{margin:0;white-space:pre;font:calc(100vw/" + cols + "/.6)/1.2 monospace;color:" + (light ? "#000" : "#fff") + "}";
    const body = "<pre id=\"art\">" + frames[0] + "</pre>";
    const script = frames.length > 1
      ? "<script>const frames=" + JSON.stringify(frames).replace(/</g, "\\u003c") +
        ";let i=0;setInterval(()=>document.getElementById('art').innerHTML=frames[++i%frames.length]," + 1000 / fps + ")</script>"
      : "";
    return '<!doctype html><meta charset="utf-8"><title>ASCII</title><style>' + css + "</style>" + body + script;
  }

  raster(grid: AsciiGrid, scale = 2): RasterFrame {
    if (!Number.isSafeInteger(scale) || scale < 1 || scale > 8) throw new Error("La escala debe ser un entero entre 1 y 8.");
    const { cols, rows, gi, fg, bg } = grid;
    const w = cols * CELL_WIDTH * scale;
    const h = rows * CELL_HEIGHT * scale;
    if (w * h > 32_000_000) throw new Error("La imagen ASCII de salida es demasiado grande.");
    const buf = Buffer.alloc(w * h * 3);
    const ink = this.options.invert ? 0 : 255;
    const paper = 255 - ink;

    for (let cy = 0; cy < rows; cy++) {
      for (let y = 0; y < CELL_HEIGHT; y++) {
        const start = (cy * CELL_HEIGHT + y) * scale * w * 3;
        let offset = start;
        for (let cx = 0; cx < cols; cx++) {
          const index = cy * cols + cx;
          const mask = this.glyphs[gi[index]!]!.mask;
          for (let x = 0; x < CELL_WIDTH; x++) {
            const on = mask[y * CELL_WIDTH + x] === 1;
            for (let copy = 0; copy < scale; copy++) {
              for (let channel = 0; channel < 3; channel++) {
                const colorIndex = index * 3 + channel;
                buf[offset++] = this.colored
                  ? (on ? fg[colorIndex]! : this.options.bg ? bg[colorIndex]! : 0)
                  : (on ? ink : paper);
              }
            }
          }
        }
        for (let copy = 1; copy < scale; copy++) buf.copyWithin(start + copy * w * 3, start, start + w * 3);
      }
    }
    return { buf, w, h };
  }

  private lines(grid: AsciiGrid, cell: (index: number, x: number) => string): string[] {
    return Array.from({ length: grid.rows }, (_, y) => {
      let line = "";
      for (let x = 0; x < grid.cols; x++) line += cell(y * grid.cols + x, x);
      return line;
    });
  }
}
