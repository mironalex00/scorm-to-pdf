import { gunzipSync, gzipSync } from "node:zlib";
import type { Redactor } from "../tracing/Redactor.ts";

/** Stores redacted, gzip-compressed JSON in memory. Reads decompress a single entry. */
export class CompressedStore<T> {
  private readonly redactor: Redactor;
  private readonly entries = new Map<string, Buffer>();
  private readonly maxBytes: number;
  private size = 0;

  constructor(deps: { redactor: Redactor; maxBytes?: number }) {
    this.redactor = deps.redactor;
    this.maxBytes = deps.maxBytes ?? Infinity;
  }

  set(key: string, value: T): void {
    const packed = gzipSync(this.redactor.redact(JSON.stringify(value)));
    this.delete(key);
    if (packed.length > this.maxBytes) return;
    while (this.size + packed.length > this.maxBytes) this.delete(this.entries.keys().next().value!);
    // A small gzip result can retain the entire zlib output buffer.
    const compact = Buffer.allocUnsafeSlow(packed.length);
    packed.copy(compact);
    this.entries.set(key, compact);
    this.size += packed.length;
  }

  get(key: string): T | undefined {
    const packed = this.entries.get(key);
    if (packed === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, packed);
    return JSON.parse(gunzipSync(packed).toString("utf8")) as T;
  }

  raw(key: string): Buffer | undefined {
    return this.entries.get(key);
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  delete(key: string): void {
    this.size -= this.entries.get(key)?.length ?? 0;
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.size = 0;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  /** Total size of the compressed entries. */
  bytes(): number {
    return this.size;
  }
}
