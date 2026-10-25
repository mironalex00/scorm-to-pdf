import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceSink } from "./Tracer.ts";

/** Traza en una carpeta: `trace.jsonl` (un evento por línea) y `snapshots/NN-nombre.txt`. */
export class FileTraceSink implements TraceSink {
  private readonly dir: string;
  private snapshotCount = 0;

  constructor(deps: { dir: string }) {
    this.dir = deps.dir;
  }

  write(line: string): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(join(this.dir, "trace.jsonl"), `${line}\n`);
    } catch {
      // best-effort
    }
  }

  snapshot(name: string, content: string): void {
    try {
      const folder = join(this.dir, "snapshots");
      mkdirSync(folder, { recursive: true });
      this.snapshotCount += 1;
      const safe = name.replace(/[^\w.-]+/g, "_");
      writeFileSync(join(folder, `${String(this.snapshotCount).padStart(2, "0")}-${safe}.txt`), content);
    } catch {
      // best-effort
    }
  }

  location(): string {
    return this.dir;
  }
}
