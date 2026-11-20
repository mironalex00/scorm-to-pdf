#!/usr/bin/env node
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { run } from "./index.ts";
import type { ConversionOptions } from "./index.ts";

const HELP = [
  "Uso: node src/extensions/ascii/main.ts <entrada> [opciones]",
  "",
  "Entradas: JPG/JPEG, PNG, WebP, GIF, MP4 o WebM. Acepta archivos y URLs HTTP(S).",
  "Sin --out, muestra el ASCII en la terminal. Con salida redirigida escribe el primer cuadro.",
  "  -o, --out <ruta>      .txt .ansi .json .html .png .gif .mp4 .webm .mov .mkv .avi",
  "  -w, --cols <n>        Número de columnas.",
  "  --fps <n>             Frecuencia de muestreo y salida, hasta 60.",
  "  --bg                  Color de primer plano y fondo por celda.",
  "  --color               Color de primer plano por celda.",
  "  --invert              Invierte el brillo para usar fondo claro.",
  "  --chars <cadena>      Limita los glifos, por ejemplo \" .:-=+*#%@\".",
  "  --gamma <n>           Ajusta el brillo, por defecto 1.",
  "  --tone <n>            Peso del tono frente a la forma, por defecto 1.",
  "  --aspect <n>          Proporción de la celda, por defecto 0.5 en texto y 0.75 en raster.",
  "  --scale <n>           Escala entera para la salida raster, por defecto 2.",
  "  --loop                Repite la reproducción en terminal.",
  "  --mute                Omite el audio al exportar vídeo.",
  "  --max-frames <n>      Límite de cuadros. Por defecto 600 para HTML y JSON.",
  "  -h, --help            Muestra esta ayuda.",
  "",
  "Requiere FFmpeg y FFprobe. FFMPEG y FFPROBE permiten indicar otras rutas.",
].join("\n");

export function cliArgs(argv: readonly string[]): { input?: string; help: boolean; options: ConversionOptions } {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      cols: { type: "string", short: "w" },
      fps: { type: "string" },
      scale: { type: "string" },
      gamma: { type: "string" },
      tone: { type: "string" },
      aspect: { type: "string" },
      chars: { type: "string" },
      "max-frames": { type: "string" },
      color: { type: "boolean" },
      bg: { type: "boolean" },
      invert: { type: "boolean" },
      loop: { type: "boolean" },
      mute: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (positionals.length > 1) throw new Error("Indica un solo archivo o URL de entrada.");
  const number = (flag: "cols" | "fps" | "scale" | "gamma" | "tone" | "aspect" | "max-frames") => {
    const raw = values[flag];
    if (raw === undefined) return undefined;
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < (flag === "tone" ? 0 : Number.MIN_VALUE)) {
      throw new Error("Valor inválido para --" + flag + ": " + raw);
    }
    return value;
  };
  return {
    input: positionals[0],
    help: values.help === true,
    options: {
      out: values.out, cols: number("cols"), fps: number("fps"), scale: number("scale"),
      gamma: number("gamma"), tone: number("tone"), aspect: number("aspect"), chars: values.chars,
      maxFrames: number("max-frames"), color: values.color, bg: values.bg, invert: values.invert,
      loop: values.loop, mute: values.mute,
    },
  };
}

async function main(): Promise<void> {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  const onStdoutError = (error: NodeJS.ErrnoException) => {
    if (error.code === "EPIPE") controller.abort(error);
    else throw error;
  };
  process.once("SIGINT", interrupt);
  process.stdout.on("error", onStdoutError);
  try {
    const { input, help, options } = cliArgs(process.argv.slice(2));
    if (help || input === undefined) {
      (help ? process.stdout : process.stderr).write(HELP + "\n");
      process.exitCode = help ? 0 : 1;
      return;
    }
    await run(input, { ...options, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      process.exitCode = (controller.signal.reason as NodeJS.ErrnoException).code === "EPIPE" ? 0 : 130;
      return;
    }
    process.stderr.write("Error: " + (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  } finally {
    process.off("SIGINT", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
