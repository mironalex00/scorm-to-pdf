import type { TraceSink } from "../../src/tracing/Tracer.ts";

export class MemoryTraceSink implements TraceSink {
  readonly lines: string[] = [];
  readonly snapshots: Array<{ name: string; content: string }> = [];
  failing = false;

  write(line: string): void {
    this.guard();
    this.lines.push(line);
  }
  snapshot(name: string, content: string): void {
    this.guard();
    this.snapshots.push({ name, content });
  }
  location(): string {
    return "memoria";
  }
  private guard(): void {
    if (this.failing) throw new Error("disk full");
  }
}
