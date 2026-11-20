import { mkdtemp, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { AsciiEngine, CELL_HEIGHT, CELL_WIDTH } from "./AsciiEngine.ts";
import type { AsciiGrid, AsciiOptions } from "./AsciiEngine.ts";
import { decodeFrames, encodeFrames, mediaInput, probe } from "./media.ts";
import type { RasterFormat } from "./media.ts";
import { PortableMediaRuntime, withMediaTools } from "./runtime.ts";
import type { MediaRuntime, MediaTools } from "./runtime.ts";
import type { OutputStream } from "../../infra/ConsoleLogger.ts";

export { AsciiEngine };
export { fitAsciiFrame } from "./viewport.ts";
export type { AsciiGrid, AsciiOptions };

export interface MediaOptions extends AsciiOptions {
  readonly cols?: number;
  readonly fps?: number;
  readonly aspect?: number;
  readonly maxRows?: number;
  readonly signal?: AbortSignal;
}

export interface ConversionOptions extends MediaOptions {
  readonly out?: string;
  readonly scale?: number;
  readonly loop?: boolean;
  readonly mute?: boolean;
  readonly maxFrames?: number;
}

export interface AsciiClip {
  readonly cols: number;
  readonly rows: number;
  readonly fps: number;
  readonly frames: readonly (readonly string[])[];
}

export interface ConversionContext {
  readonly cwd?: string;
  readonly runtime?: MediaRuntime;
  readonly stdout?: OutputStream;
}

const RASTER: ReadonlySet<string> = new Set<RasterFormat>(["png", "gif", "mp4", "webm", "mov", "mkv", "avi"]);
const TEXT: ReadonlySet<string> = new Set(["txt", "ansi", "json", "html"]);
const MAX_EXPORT_BYTES = 32 * 1024 * 1024;

function isRasterFormat(format: string): format is RasterFormat {
  return RASTER.has(format);
}

async function inspectMedia(tools: MediaTools, source: string, options: MediaOptions) {
  const { signal } = options;
  signal?.throwIfAborted();
  const info = await probe(tools, source, signal);
  const fps = options.fps ?? Math.min(info.fps, 30);
  if (!Number.isFinite(fps) || fps <= 0 || fps > 60) throw new Error("Los FPS deben estar entre 0 (excluido) y 60.");
  const engine = new AsciiEngine(options);
  const aspect = options.aspect ?? 0.5;
  let columns = options.cols ?? 80;
  if (options.maxRows !== undefined) {
    if (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1) throw new Error("El límite de filas debe ser positivo.");
    columns = Math.max(1, Math.min(columns, Math.floor(options.maxRows * info.width / (aspect * info.height))));
  }
  const { cols, rows, w, h } = engine.size(info.width, info.height, columns, aspect);

  async function* decode(activeTools: MediaTools, still = false): AsyncGenerator<AsciiGrid> {
    for await (const rgb of decodeFrames(activeTools, source, {
      width: w, height: h, fps, still: info.still || still, gif: info.gif,
      matte: options.invert ? 255 : 0, downscale: info.width >= w && info.height >= h, signal,
    })) {
      yield engine.frame(rgb, cols, rows);
    }
  }
  return { source, engine, cols, rows, fps, w, h, info, decode };
}

interface OpenMedia extends Omit<Awaited<ReturnType<typeof inspectMedia>>, "decode"> {
  frames(still?: boolean): AsyncGenerator<AsciiGrid>;
}

/** Cada iterador mantiene sus ejecutables mientras esté abierto y los elimina al cerrarse. */
export async function openAsciiMedia(input: string, options: MediaOptions = {}, context: ConversionContext = {}): Promise<OpenMedia> {
  const source = mediaInput(input, context.cwd);
  const runtime = context.runtime ?? new PortableMediaRuntime({ cwd: context.cwd });
  const { decode, ...media } = await withMediaTools(runtime, (tools) => inspectMedia(tools, source, options), options.signal);
  return {
    ...media,
    async *frames(still = false) {
      const lease = await runtime.acquire(options.signal);
      try {
        yield* decode(lease.tools, still);
      } finally {
        await lease.close();
      }
    },
  };
}

async function withMedia<T>(
  source: string,
  options: MediaOptions,
  context: ConversionContext,
  work: (media: OpenMedia, tools: MediaTools) => Promise<T>,
): Promise<T> {
  const runtime = context.runtime ?? new PortableMediaRuntime({ cwd: context.cwd });
  return withMediaTools(runtime, async (tools) => {
    const { decode, ...media } = await inspectMedia(tools, source, options);
    return work({ ...media, frames: (still) => decode(tools, still) }, tools);
  }, options.signal);
}

async function firstFrame(media: OpenMedia): Promise<AsciiGrid> {
  for await (const frame of media.frames(true)) return frame;
  throw new Error("La entrada no produjo ningún cuadro.");
}

async function atomicOutput(path: string, write: (temporary: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const dir = await mkdtemp(join(dirname(path), ".ascii-"));
  const temporary = join(dir, "output" + extname(path));
  try {
    await write(temporary);
    signal?.throwIfAborted();
    await rename(temporary, path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function validFrameCap(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) throw new Error("--max-frames requiere un entero de 1 a 10000.");
}

async function collect(media: OpenMedia, maxFrames: number, render: (frame: AsciiGrid) => string): Promise<string[]> {
  const frames: string[] = [];
  let bytes = 0;
  for await (const frame of media.frames()) {
    const text = render(frame);
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > MAX_EXPORT_BYTES) throw new Error("La animación es demasiado grande; reduce las columnas o --max-frames.");
    frames.push(text);
    if (frames.length === maxFrames) break;
  }
  if (frames.length === 0) throw new Error("La entrada no produjo ningún cuadro.");
  return frames;
}

export async function renderAsciiClip(
  input: string,
  options: MediaOptions & { maxFrames?: number } = {},
  context: ConversionContext = {},
): Promise<AsciiClip> {
  const maxFrames = options.maxFrames ?? 600;
  validFrameCap(maxFrames);
  return withMedia(mediaInput(input, context.cwd), options, context, (media) => toClip(media, maxFrames));
}

async function toClip(media: OpenMedia, maxFrames: number): Promise<AsciiClip> {
  const { cols, rows, fps, engine } = media;
  const frames = (await collect(media, maxFrames, (frame) => engine.text(frame))).map((frame) => frame.split("\n"));
  return { cols, rows, fps, frames };
}

async function rasterOutput(
  media: OpenMedia, tools: MediaTools, output: string, format: RasterFormat, options: ConversionOptions,
): Promise<void> {
  const scale = options.scale ?? 2;
  async function* rasters() {
    if (format === "png") {
      yield media.engine.raster(await firstFrame(media), scale).buf;
      return;
    }
    let count = 0;
    for await (const frame of media.frames()) {
      yield media.engine.raster(frame, scale).buf;
      if (++count >= (options.maxFrames ?? Infinity)) break;
    }
    if (count === 0) throw new Error("La entrada no produjo ningún cuadro.");
  }
  const audio = media.info.hasAudio && format !== "png" && format !== "gif" && !options.mute ? media.source : undefined;
  await encodeFrames(tools, output, {
    width: media.w * scale, height: media.h * scale, fps: media.fps, format, audio, signal: options.signal,
  }, rasters());
}

async function avoidInputOverwrite(source: string, out: string): Promise<void> {
  if (/^https?:\/\//i.test(source)) return;
  const [actualSource, actualOut] = await Promise.all([
    realpath(source),
    realpath(out).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return out;
    }),
  ]);
  if (actualSource === actualOut) throw new Error("La entrada y la salida no pueden ser el mismo archivo.");
}

/** Convierte con FFmpeg. Sin salida, reproduce en una terminal o escribe el primer cuadro si se redirige stdout. */
export async function run(input: string, options: ConversionOptions = {}, context: ConversionContext = {}): Promise<void> {
  const cwd = context.cwd ?? process.cwd();
  const stdout = context.stdout ?? process.stdout;
  const out = options.out === undefined ? undefined : resolve(cwd, options.out);
  const format = out === undefined ? "" : extname(out).slice(1).toLowerCase();
  const raster = isRasterFormat(format);
  if (out !== undefined && !raster && !TEXT.has(format)) throw new Error("Formato de salida no soportado: " + (format || "(sin extensión)") + ".");
  const maxFrames = options.maxFrames ?? 600;
  validFrameCap(maxFrames);
  if (options.scale !== undefined && (!Number.isSafeInteger(options.scale) || options.scale < 1 || options.scale > 8)) {
    throw new Error("--scale requiere un entero de 1 a 8.");
  }

  const source = mediaInput(input, cwd);
  if (out !== undefined) await avoidInputOverwrite(source, out);
  const settings: MediaOptions = {
    ...options,
    cols: options.cols ?? (out === undefined ? Math.max(2, (stdout.columns || 81) - 1) : raster ? 160 : 120),
    aspect: options.aspect ?? (raster ? CELL_WIDTH / CELL_HEIGHT : 0.5),
    maxRows: options.maxRows ?? (out === undefined && options.cols === undefined && stdout.isTTY
      ? Math.max(1, (stdout.rows || 25) - 1) : undefined),
  };
  await withMedia(source, settings, context, async (media, tools) => {
    if (out === undefined) {
      await showTerminal(media, options, stdout);
      return;
    }
    await atomicOutput(out, async (temporary) => {
      if (raster) {
        await rasterOutput(media, tools, temporary, format, options);
      } else if (format === "txt" || format === "ansi") {
        const frame = await firstFrame(media);
        const text = format === "ansi" ? media.engine.ansi(frame) : media.engine.text(frame);
        await writeFile(temporary, text + "\n");
      } else if (format === "html") {
        const frames = await collect(media, maxFrames, (frame) => media.engine.htmlFrame(frame));
        await writeFile(temporary, media.engine.htmlDocument(frames, media.cols, media.fps));
      } else {
        const clip = await toClip(media, maxFrames);
        await writeFile(temporary, JSON.stringify(clip) + "\n");
      }
    }, options.signal);
  });
}

async function showTerminal(media: OpenMedia, options: ConversionOptions, stdout: OutputStream): Promise<void> {
  if (!stdout.isTTY || media.info.still) {
    stdout.write(media.engine.ansi(await firstFrame(media)) + "\n");
    return;
  }
  let count = 0;
  let shown = false;
  stdout.write("\x1b[?1049h\x1b[?25l");
  try {
    do {
      const start = performance.now();
      let frameNumber = 0;
      for await (const grid of media.frames()) {
        const lineCount = Math.max(1, (stdout.rows || grid.rows + 1) - 1);
        stdout.write("\x1b[H" + media.engine.ansi(grid).split("\n").slice(0, lineCount).join("\n") + "\x1b[J");
        shown = true;
        const wait = start + (++frameNumber) * 1000 / media.fps - performance.now();
        if (wait > 0) await setTimeout(wait, undefined, { signal: options.signal });
        if (++count >= (options.maxFrames ?? Infinity)) return;
      }
      if (!shown) throw new Error("La entrada no produjo ningún cuadro.");
    } while (options.loop);
  } finally {
    stdout.write("\x1b[0m\x1b[?25h\x1b[?1049l");
  }
}
