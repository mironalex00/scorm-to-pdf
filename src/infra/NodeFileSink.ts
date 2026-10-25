import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { OutputError, errorMessage } from "../domain/errors.ts";
import type { FileSink } from "../application/ports.ts";
import type { Messages } from "../i18n/Messages.ts";

/** Escritura atómica: se escribe en un temporal vecino y se renombra, así nunca queda un PDF a medias. */
export class NodeFileSink implements FileSink {
  private readonly messages: Messages;

  constructor(deps: { messages: Messages }) {
    this.messages = deps.messages;
  }

  async exists(path: string): Promise<boolean> {
    return stat(resolve(path)).then(
      () => true,
      () => false,
    );
  }

  async write(path: string, content: Uint8Array): Promise<string> {
    const target = resolve(path);
    const temporary = `${target}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(temporary, content);
      await rename(temporary, target);
    } catch (error) {
      // La limpieza es best-effort: nunca debe enmascarar el error original.
      await rm(temporary, { force: true }).catch(() => undefined);
      throw new OutputError(this.messages.sink.writeFailed({ target, detail: errorMessage(error) }), { cause: error });
    }
    return target;
  }
}
