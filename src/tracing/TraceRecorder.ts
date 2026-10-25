import type { Redactor } from "./Redactor.ts";
import type { SerializedError, TraceEvent, TraceLevel, TraceSink, Tracer } from "./Tracer.ts";

const MAX_SNAPSHOT_CHARS = 200_000;
const MAX_CAUSE_DEPTH = 8;

interface RecorderState {
  readonly runId: string;
  readonly clock: () => number;
  readonly redactor: Redactor;
  readonly sink: TraceSink;
  readonly streaming: boolean;
  readonly captureBodies: boolean;
  readonly ringSize: number;
  readonly ring: string[];
  seq: number;
  errors: number;
}

export interface TraceRecorderOptions {
  readonly runId: string;
  readonly clock: () => number;
  readonly redactor: Redactor;
  readonly sink: TraceSink;
  /** Escribe cada evento al momento (--trace); si no, se guardan en un anillo y se vuelcan al fallar. */
  readonly streaming: boolean;
  readonly captureBodies: boolean;
  readonly ringSize: number;
}

export class TraceRecorder implements Tracer {
  private readonly state: RecorderState;
  private readonly context: Readonly<Record<string, unknown>>;

  private constructor(state: RecorderState, context: Readonly<Record<string, unknown>>) {
    this.state = state;
    this.context = context;
  }

  static create(options: TraceRecorderOptions): TraceRecorder {
    return new TraceRecorder({ ...options, ring: [], seq: 0, errors: 0 }, {});
  }

  event(level: TraceLevel, scope: string, name: string, data?: Record<string, unknown>): void {
    this.emit({ level, scope, name, data });
  }

  async span<T>(scope: string, name: string, data: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
    const started = this.state.clock();
    this.emit({ level: "debug", scope, name: `${name}.start`, data });
    try {
      const result = await work();
      this.emit({ level: "debug", scope, name: `${name}.end`, ms: this.state.clock() - started });
      return result;
    } catch (error) {
      this.emit({
        level: "error",
        scope,
        name: `${name}.fail`,
        ms: this.state.clock() - started,
        error: this.serialize(error),
      });
      throw error;
    }
  }

  snapshot(label: string, content: string, meta?: Record<string, unknown>): void {
    if (!this.state.captureBodies) return;
    const redacted = this.state.redactor.redact(content);
    const stored = redacted.length > MAX_SNAPSHOT_CHARS ? `${redacted.slice(0, MAX_SNAPSHOT_CHARS)}\n[...truncated]` : redacted;
    this.guard(() => this.state.sink.snapshot(label, stored));
    this.emit({ level: "info", scope: "trace", name: "snapshot.saved", data: { label, chars: content.length, ...meta } });
  }

  with(context: Record<string, unknown>): Tracer {
    return new TraceRecorder(this.state, { ...this.context, ...context });
  }

  addSecret(value: string): void {
    this.state.redactor.addSecret(value);
  }

  hasErrors(): boolean {
    return this.state.errors > 0;
  }

  flush(): string {
    if (!this.state.streaming) {
      for (const line of this.state.ring) this.guard(() => this.state.sink.write(line));
      this.state.ring.length = 0;
    }
    return this.state.sink.location();
  }

  private emit(input: {
    level: TraceLevel;
    scope: string;
    name: string;
    data?: Record<string, unknown> | undefined;
    ms?: number;
    error?: SerializedError;
  }): void {
    const state = this.state;
    state.seq += 1;
    if (input.level === "error") state.errors += 1;
    const hasContext = Object.keys(this.context).length > 0;
    const event: TraceEvent = {
      t: new Date(state.clock()).toISOString(),
      seq: state.seq,
      run: state.runId,
      level: input.level,
      scope: input.scope,
      name: input.name,
      ...(input.ms !== undefined && { ms: input.ms }),
      ...(hasContext && { ctx: state.redactor.redactValue(this.context) as Record<string, unknown> }),
      ...(input.data !== undefined && { data: state.redactor.redactValue(input.data) as Record<string, unknown> }),
      ...(input.error !== undefined && { error: input.error }),
    };
    const line = JSON.stringify(event);
    if (state.streaming) {
      this.guard(() => state.sink.write(line));
      return;
    }
    state.ring.push(line);
    if (state.ring.length > state.ringSize) state.ring.shift();
  }

  private serialize(error: unknown): SerializedError {
    const chain: string[] = [];
    let current: unknown = error;
    while (chain.length < MAX_CAUSE_DEPTH) {
      if (current instanceof Error) {
        chain.push(`${current.name}: ${current.message}`);
        current = current.cause;
        if (current === undefined) break;
      } else {
        chain.push(`non-error: ${String(current)}`);
        break;
      }
    }
    const redactor = this.state.redactor;
    if (!(error instanceof Error)) {
      return redactor.redactValue({ name: "non-error", message: String(error), chain }) as SerializedError;
    }
    return redactor.redactValue({ name: error.name, message: error.message, chain, stack: error.stack }) as SerializedError;
  }

  private guard(action: () => void): void {
    try {
      action();
    } catch {
      // La traza es best-effort: un disco lleno no debe tumbar la descarga.
    }
  }
}
