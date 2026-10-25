import { gunzipSync, gzipSync } from "node:zlib";
import type { Redactor } from "../tracing/Redactor.ts";

/**
 * Almacén en RAM que guarda cada valor como JSON comprimido con gzip: un catálogo grande ocupa
 * una fracción y solo se descomprime lo que se consulta. Los secretos se redactan antes de
 * comprimir, así que no pueden acabar almacenados aunque alguien los pase por error.
 */
export class CompressedStore<T> {
  private readonly redactor: Redactor;
  private readonly entries = new Map<string, Buffer>();

  constructor(deps: { redactor: Redactor }) {
    this.redactor = deps.redactor;
  }

  set(key: string, value: T): void {
    this.entries.set(key, gzipSync(this.redactor.redact(JSON.stringify(value))));
  }

  get(key: string): T | undefined {
    const packed = this.entries.get(key);
    return packed === undefined ? undefined : (JSON.parse(gunzipSync(packed).toString("utf8")) as T);
  }

  raw(key: string): Buffer | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Bytes que ocupan los datos comprimidos. */
  bytes(): number {
    let total = 0;
    for (const packed of this.entries.values()) total += packed.length;
    return total;
  }
}
