import { execFile, spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const PROBE_TIMEOUT_MS = 20_000;
const LOCAL_PROTOCOLS = "file,pipe";
const REMOTE_PROTOCOLS = "http,https,tcp,tls";

export interface MediaInfo {
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly still: boolean;
  readonly hasAudio: boolean;
  readonly gif: boolean;
}

interface StreamInfo {
  readonly codec_type?: string;
  readonly width?: number;
  readonly height?: number;
  readonly avg_frame_rate?: string;
  readonly r_frame_rate?: string;
  readonly tags?: { rotate?: string };
  readonly side_data_list?: Array<{ rotation?: number }>;
}

interface Process {
  readonly child: ChildProcessWithoutNullStreams;
  readonly done: Promise<Error | undefined>;
}

export function mediaInput(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  if (input.trim() === "") throw new Error("Falta el archivo de entrada.");
  return resolve(input);
}

function inputOptions(input: string): string[] {
  return ["-protocol_whitelist", /^https?:\/\//i.test(input) ? REMOTE_PROTOCOLS : LOCAL_PROTOCOLS];
}

function rate(value: string | undefined): number {
  const [numerator, denominator] = (value ?? "").split("/").map(Number);
  const fps = numerator! / denominator!;
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

function toolError(name: "ffmpeg" | "ffprobe", error: unknown): Error {
  if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
    return new Error("No se encuentra " + name + ". Instala FFmpeg o indica la ruta mediante " + name.toUpperCase() + ".", { cause: error });
  }
  return error instanceof Error ? error : new Error(String(error));
}

export async function probe(input: string, signal?: AbortSignal): Promise<MediaInfo> {
  const bin = process.env.FFPROBE || "ffprobe";
  let stdout: string;
  try {
    ({ stdout } = await exec(bin, [
      "-v", "error", ...inputOptions(input), "-show_streams", "-show_format", "-of", "json", "-i", input,
    ], { encoding: "utf8", maxBuffer: 128 * 1024, timeout: PROBE_TIMEOUT_MS, signal }));
  } catch (error) {
    const failure = toolError("ffprobe", error);
    const stderr = (failure as Error & { stderr?: string }).stderr?.trim();
    throw stderr ? new Error(stderr.replaceAll(input, "[entrada]"), { cause: failure }) : failure;
  }
  const metadata = JSON.parse(stdout) as { streams?: StreamInfo[]; format?: { format_name?: string } };
  const streams = metadata.streams ?? [];
  const video = streams.find(({ codec_type }) => codec_type === "video");
  const width = video?.width;
  const height = video?.height;
  if (!video || !width || !height || !Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > 50_000_000) {
    throw new Error("La entrada no contiene una imagen o un vídeo con dimensiones válidas.");
  }
  const rotation = Number(video.side_data_list?.find((entry) => entry.rotation !== undefined)?.rotation ?? video.tags?.rotate ?? 0);
  const sideways = Math.abs(rotation) % 180 === 90;
  const format = metadata.format?.format_name ?? "";
  return {
    width: sideways ? height : width,
    height: sideways ? width : height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 12,
    still: format === "image2" || format.endsWith("_pipe"),
    gif: format === "gif",
    hasAudio: streams.some(({ codec_type }) => codec_type === "audio"),
  };
}

function ffmpeg(args: string[], signal?: AbortSignal): Process {
  const child = spawn(process.env.FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...args], { signal });
  let stderr = "";
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-4096); });
  const done = new Promise<Error | undefined>((resolveDone) => {
    let failure: Error | undefined;
    child.on("error", (error) => { failure = toolError("ffmpeg", error); });
    child.once("close", (code, stopSignal) => {
      resolveDone(failure ?? (code === 0 ? undefined : new Error(stderr.trim() || "FFmpeg terminó con " + (stopSignal ?? code) + ".")));
    });
  });
  return { child, done };
}

async function stop(process: Process): Promise<void> {
  process.child.stdout.resume();
  if (process.child.exitCode === null && process.child.signalCode === null) process.child.kill();
  await process.done;
}

export async function* decodeFrames(
  input: string,
  options: { width: number; height: number; fps: number; still: boolean; gif: boolean; matte: number; downscale: boolean; signal?: AbortSignal },
): AsyncGenerator<Buffer> {
  const { width, height, fps, still, gif, matte, signal } = options;
  signal?.throwIfAborted();
  const filters = [
    ...(still ? [] : ["fps=" + fps + ":round=up"]),
    "scale=" + width + ":" + height + ":flags=" + (options.downscale ? "area" : "lanczos"),
    "format=rgba",
  ];
  const process = ffmpeg([
    ...inputOptions(input), ...(gif ? ["-ignore_loop", "1"] : []), "-i", input,
    "-map", "0:v:0", "-an", "-sn", "-vf", filters.join(","),
    ...(still ? ["-frames:v", "1"] : []), "-threads", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1",
  ], signal);
  process.child.stdin.end();
  const size = width * height * 4;
  const rgba = Buffer.allocUnsafe(size);
  let filled = 0;
  try {
    for await (const chunk of process.child.stdout.iterator({ destroyOnReturn: false })) {
      const bytes = chunk as Buffer;
      for (let offset = 0; offset < bytes.length;) {
        const copied = bytes.copy(rgba, filled, offset, offset + size - filled);
        filled += copied;
        offset += copied;
        if (filled === size) {
          const rgb = Buffer.allocUnsafe(width * height * 3);
          for (let i = 0, j = 0; i < size; i += 4, j += 3) {
            const alpha = rgba[i + 3]!;
            for (let channel = 0; channel < 3; channel++) {
              rgb[j + channel] = Math.round((rgba[i + channel]! * alpha + matte * (255 - alpha)) / 255);
            }
          }
          yield rgb;
          filled = 0;
        }
      }
    }
    const failure = await process.done;
    if (failure) throw failure;
    signal?.throwIfAborted();
    if (filled !== 0) throw new Error("FFmpeg entregó un cuadro incompleto.");
  } finally {
    await stop(process);
  }
}

export type RasterFormat = "png" | "gif" | "mp4" | "webm" | "mov" | "mkv" | "avi";

const CODECS: Record<RasterFormat, readonly string[]> = {
  png: ["-frames:v", "1", "-c:v", "png", "-f", "image2"],
  gif: ["-vf", "split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=none", "-loop", "0"],
  mp4: ["-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart"],
  webm: ["-c:v", "libvpx-vp9", "-crf", "18", "-b:v", "0", "-pix_fmt", "yuv420p", "-c:a", "libopus"],
  mov: ["-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p", "-c:a", "aac"],
  mkv: ["-c:v", "libx264", "-crf", "15", "-pix_fmt", "yuv420p", "-c:a", "aac"],
  avi: ["-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-c:a", "libmp3lame"],
};

export async function encodeFrames(
  output: string,
  options: { width: number; height: number; fps: number; format: RasterFormat; audio?: string; signal?: AbortSignal },
  frames: AsyncIterable<Buffer>,
): Promise<void> {
  const { width, height, fps, format, audio, signal } = options;
  signal?.throwIfAborted();
  const args = ["-y", "-filter_complex_threads", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", width + "x" + height,
    "-framerate", String(fps), "-i", "pipe:0"];
  if (audio) args.push(...inputOptions(audio), "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-shortest");
  args.push(...CODECS[format], "-threads", "1", output);
  const process = ffmpeg(args, signal);
  process.child.stdout.resume();
  // El error de escritura también llega al callback. El listener evita un error sin atender si FFmpeg sale antes.
  process.child.stdin.on("error", () => {});
  try {
    for await (const frame of frames) {
      await new Promise<void>((resolveWrite, reject) => {
        process.child.stdin.write(frame, (error) => error ? reject(error) : resolveWrite());
      });
    }
    process.child.stdin.end();
    const failure = await process.done;
    if (failure) throw failure;
  } catch (error) {
    await stop(process);
    if ((error as NodeJS.ErrnoException)?.code === "EPIPE") throw (await process.done) ?? error;
    throw error;
  }
}
