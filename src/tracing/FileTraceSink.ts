import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { TraceSink } from "./Tracer.ts";

export class FileTraceSink implements TraceSink {
  private readonly dir: string;
  private snapshotCount = 0;
  private wroteTrace = false;

  constructor(deps: { dir: string }) {
    this.dir = deps.dir;
  }

  write(line: string): void {
    try {
      this.ensureDirectory(this.dir);
      const flags = constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
      const file = openSync(join(this.dir, "trace.jsonl"), flags, 0o600);
      try {
        const entry = fstatSync(file);
        if (!entry.isFile() || entry.nlink !== 1 || (process.platform !== "win32" && (entry.mode & 0o077) !== 0)) return;
        writeFileSync(file, `${line}\n`);
        this.wroteTrace = true;
      } finally {
        closeSync(file);
      }
    } catch { /* Diagnostics should not interrupt the download. */ }
  }

  snapshot(name: string, content: string): boolean {
    try {
      const folder = join(this.dir, "snapshots");
      this.ensureDirectory(this.dir);
      this.ensureDirectory(folder);
      const safe = name.replace(/[^\w.-]+/g, "_");
      for (;;) {
        const index = String(++this.snapshotCount).padStart(2, "0");
        try {
          writeFileSync(join(folder, `${index}-${safe}.txt`), content, { flag: "wx", mode: 0o600 });
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") return false;
        }
      }
    } catch {
      return false;
    }
  }

  location(): string | undefined {
    return this.wroteTrace ? this.dir : undefined;
  }

  private ensureDirectory(path: string): void {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (!lstatSync(path).isDirectory()) throw new Error("Expected a trace directory");
  }
}
