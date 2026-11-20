import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { AsciiEngine } from "../src/extensions/ascii/AsciiEngine.ts";
import type { AsciiClip } from "../src/extensions/ascii/index.ts";
import { decodeFrames, probe } from "../src/extensions/ascii/media.ts";
import { PortableMediaRuntime, withMediaTools } from "../src/extensions/ascii/runtime.ts";
import { es } from "../src/i18n/es.ts";
import { NodeFileSink } from "../src/infra/NodeFileSink.ts";

const directory = fileURLToPath(new URL("../src/extensions/ascii/", import.meta.url));
const engine = new AsciiEngine({ invert: true, chars: " .,:;!+*#@=|/\\()_'-", tone: 0.65 });
const cols = 42;
const fps = 7;

function band(position: number, center: number, radius: number): number {
  return Math.max(0, 1 - Math.abs(position - center) / radius);
}

const scenes = {
  farewell: {
    file: "bear_hoop.png",
    poses: [0, 1, -1],
    // Gira la proyección del aro sin desplazar la cara ni los pies del oso.
    shift: (x: number, y: number) => (x - 0.51) * 0.22 * band(y, 0.71, 0.14),
  },
  downloadFailure: {
    file: "hammer_point.png",
    poses: [0, 1],
    // Levanta la mano del martillo. El dedo de la otra mano se mantiene visible.
    shift: (x: number, y: number) => -0.085 * band(x, 0.27, 0.19) * band(y, 0.86, 0.19),
  },
  unexpectedFailure: {
    file: "startled_boy.png",
    poses: [0, 1],
    // Sube los brazos en los márgenes mientras el rostro permanece fijo.
    shift: (x: number, y: number) => -0.09 * Math.max(band(x, 0.08, 0.28), band(x, 0.92, 0.28)) * band(y, 0.84, 0.22),
  },
} as const;

function pose(
  rgb: Uint8Array, width: number, height: number, amount: number, shift: (x: number, y: number) => number,
): Uint8Array {
  const frame = new Uint8Array(rgb.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceY = y - amount * shift(x / width, y / height) * height;
      const base = Math.floor(sourceY);
      const fraction = sourceY - base;
      for (let channel = 0; channel < 3; channel++) {
        const a = rgb[(base * width + x) * 3 + channel] ?? 255;
        const b = rgb[((base + 1) * width + x) * 3 + channel] ?? 255;
        frame[(y * width + x) * 3 + channel] = Math.round(a * (1 - fraction) + b * fraction);
      }
    }
  }
  return frame;
}

const runtime = new PortableMediaRuntime();
const clips: Record<string, AsciiClip> = {};
await withMediaTools(runtime, async (tools) => {
  for (const [name, scene] of Object.entries(scenes)) {
    const source = join(directory, "content", scene.file);
    const { width, height, gif } = await probe(tools, source);
    const { rows, w, h } = engine.size(width, height, cols, 0.44);
    const decoded = decodeFrames(tools, source, {
      width: w, height: h, fps, still: true, gif, matte: 255, downscale: width >= w && height >= h,
    });
    try {
      const { value } = await decoded.next();
      if (!value) throw new Error("No se pudo leer " + scene.file + ".");
      const frames = scene.poses.map((amount) =>
        engine.text(engine.frame(pose(value, w, h, amount, scene.shift), cols, rows)).split("\n"),
      );
      clips[name] = { cols, rows, fps, frames };
    } finally {
      await decoded.return(undefined);
    }
  }
});

const output = [
  "// Generado por npm run ascii:art desde content/. Edita el generador, no estos cuadros.",
  'import type { AsciiClip } from "./index.ts";',
  "",
  "export const asciiAnimations = " + JSON.stringify(clips, null, 2) + " satisfies Record<string, AsciiClip>;",
  "",
].join("\n");
await new NodeFileSink({ messages: es }).write(join(directory, "generatedAnimations.ts"), Buffer.from(output));
