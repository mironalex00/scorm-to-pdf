import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { HttpClient } from "../../application/ports.ts";
import { OutputError, UsageError } from "../../domain/errors.ts";
import type { Messages } from "../../i18n/Messages.ts";
import { es } from "../../i18n/es.ts";
import { FetchHttpClient } from "../../infra/FetchHttpClient.ts";
import { NodeFileSink } from "../../infra/NodeFileSink.ts";

export interface MediaTools {
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

export interface MediaLease {
  readonly tools: MediaTools;
  close(): Promise<void>;
}

export interface MediaRuntime {
  acquire(signal?: AbortSignal): Promise<MediaLease>;
}

export async function withMediaTools<T>(runtime: MediaRuntime, work: (tools: MediaTools) => Promise<T>, signal?: AbortSignal): Promise<T> {
  const lease = await runtime.acquire(signal);
  try {
    return await work(lease.tools);
  } finally {
    await lease.close();
  }
}

type Tool = keyof MediaTools;
const TOOLS = ["ffmpeg", "ffprobe"] as const;
const MAX_ARCHIVE = 64 * 1024 * 1024;
const MAX_EXECUTABLE = 128 * 1024 * 1024;
const PUBLISHER = "https://ffmpeg.martin-riedl.de/download/";
export const ASCII_TOOL_RELEASE = "9.0.2";

interface Build {
  readonly directory: string;
  readonly ffmpeg: string;
  readonly ffprobe: string;
}

/** Los SHA-256 corresponden a los ZIP publicados, no a descargas de una etiqueta latest. */
const BUILDS: Readonly<Record<string, Build | undefined>> = {
  "darwin-arm64": {
    directory: "macos/arm64/1789931890_9.0.2",
    ffmpeg: "c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924",
    ffprobe: "fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6",
  },
  "darwin-x64": {
    directory: "macos/amd64/1789931006_9.0.2",
    ffmpeg: "7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4",
    ffprobe: "2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd",
  },
  "linux-x64": {
    directory: "linux/amd64/1789931100_9.0.2",
    ffmpeg: "fa8ecf4abbd290d98f7d188b8649cc6b391ae209a98452be955a15aab1909d7f",
    ffprobe: "3f428c49070be3d24ec338602b76d412e401ffcb8a5641ef0e729181a232fc32",
  },
  "linux-arm64": {
    directory: "linux/arm64/1789931697_9.0.2",
    ffmpeg: "93a76ae90db5474eecdf951a729857c64f3de23567228d6a7d5e6e8e3cd1021b",
    ffprobe: "bcbe80fb741c180083327afaf5434812e006b33cacde2016b9aeaf6936128330",
  },
};

function digest(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Conserva únicamente los ZIP verificados. Cada operación extrae y elimina su propio par. */
export class PortableMediaRuntime implements MediaRuntime {
  private readonly cache: string;
  private readonly messages: Messages;
  private readonly http: HttpClient;
  private readonly sink: NodeFileSink;
  private readonly target: string;

  constructor(deps: {
    cwd?: string;
    env?: Readonly<Record<string, string | undefined>>;
    messages?: Messages;
    http?: HttpClient;
  } = {}) {
    const env = deps.env ?? process.env;
    this.messages = deps.messages ?? es;
    this.http = deps.http ?? new FetchHttpClient({ messages: this.messages, timeoutMs: 120_000 });
    this.sink = new NodeFileSink({ messages: this.messages });
    this.target = process.platform + "-" + process.arch;
    this.cache = resolve(deps.cwd ?? process.cwd(), env.SCORM_ASCII_CACHE?.trim() || ".ascii-cache", ASCII_TOOL_RELEASE, this.target);
  }

  async prepare(signal?: AbortSignal): Promise<void> {
    const build = this.build();
    for (const name of TOOLS) await this.archive(name, build, signal);
  }

  async acquire(signal?: AbortSignal): Promise<MediaLease> {
    signal?.throwIfAborted();
    const build = this.build();
    const unzip = await import("fflate").then(({ unzipSync }) => unzipSync).catch((cause: unknown) => {
      throw new UsageError(this.messages.ascii.missingDependency(), { cause });
    });
    const directory = await mkdtemp(join(tmpdir(), "scorm-ascii-"));
    const files = { ffmpeg: join(directory, "ffmpeg"), ffprobe: join(directory, "ffprobe") };
    const close = () => rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    try {
      for (const name of TOOLS) {
        const archive = await this.archive(name, build, signal);
        const binary = unzip(archive, {
          filter: (file) => file.name === name && file.originalSize > 0 && file.originalSize <= MAX_EXECUTABLE,
        })[name];
        if (!binary?.length) throw new OutputError(this.messages.ascii.invalidArchive({ tool: name }));
        await writeFile(files[name], binary, { mode: 0o700, flag: "wx", signal });
      }
      signal?.throwIfAborted();
      return { tools: files, close };
    } catch (error) {
      await close();
      throw error;
    }
  }

  private build(): Build {
    const found = BUILDS[this.target];
    if (!found) throw new UsageError(this.messages.ascii.unsupportedPlatform({ target: this.target }));
    return found;
  }

  private async archive(name: Tool, build: Build, signal?: AbortSignal): Promise<Uint8Array> {
    signal?.throwIfAborted();
    const file = join(this.cache, name + ".zip");
    const cached = await this.readCache(file, signal);
    if (cached && digest(cached) === build[name]) return cached;

    const url = new URL(build.directory + "/" + name + ".zip", PUBLISHER);
    const response = await this.http.get({ url, headers: {}, maxBytes: MAX_ARCHIVE, signal });
    signal?.throwIfAborted();
    if (response.status !== 200) {
      throw new OutputError(this.messages.ascii.preparationFailed({ tool: name, status: String(response.status) }));
    }
    if (digest(response.body) !== build[name]) throw new OutputError(this.messages.ascii.invalidArchive({ tool: name }));

    await mkdir(this.cache, { recursive: true, mode: 0o700 });
    await this.sink.write(file, response.body);
    return response.body;
  }

  private async readCache(file: string, signal?: AbortSignal): Promise<Buffer | undefined> {
    try {
      const entry = await stat(file);
      return entry.isFile() && entry.size <= MAX_ARCHIVE ? await readFile(file, { signal }) : undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return undefined;
    }
  }
}
