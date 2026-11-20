import { link, lstat, mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { OutputError, errorMessage } from "../domain/errors.ts";
import type { FileSink } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";

/** Publish a complete file from a private staging directory on the same filesystem. */
export class NodeFileSink implements FileSink {
  private readonly messages: Messages;
  private readonly signal: AbortSignal | undefined;

  constructor(deps: { messages: Messages; signal?: AbortSignal | undefined }) {
    this.messages = deps.messages;
    this.signal = deps.signal;
  }

  async exists(path: string): Promise<boolean> {
    try {
      const entry = await lstat(resolve(path));
      return entry.isFile() || entry.isSymbolicLink();
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
      throw error;
    }
  }

  async write(path: string, content: Uint8Array, signal = this.signal): Promise<string> {
    const target = resolve(path);
    await this.publish(target, content, true, signal);
    return target;
  }

  async writeIfAbsent(path: string, content: Uint8Array): Promise<string | undefined> {
    const target = resolve(path);
    return await this.publish(target, content, false, this.signal) ? target : undefined;
  }

  private async publish(target: string, content: Uint8Array, overwrite: boolean, signal?: AbortSignal): Promise<boolean> {
    try {
      signal?.throwIfAborted();
      await mkdir(dirname(target), { recursive: true });
      const directory = await mkdtemp(join(dirname(target), ".scorm-write-"));
      try {
        const temporary = join(directory, "payload");
        await writeFile(temporary, content, { mode: 0o600, flag: "wx", signal });
        signal?.throwIfAborted();
        if (overwrite) await rename(temporary, target);
        else await link(temporary, target);
        return true;
      } catch (error) {
        if (!overwrite && (error as NodeJS.ErrnoException).code === "EEXIST" && await this.exists(target)) return false;
        throw error;
      } finally {
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
      }
    } catch (error) {
      signal?.throwIfAborted();
      throw new OutputError(this.messages.sink.writeFailed({ target, detail: errorMessage(error) }), { cause: error });
    }
  }
}
