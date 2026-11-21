export type TraceLevel = "debug" | "info" | "warn" | "error";

export interface SerializedError {
  readonly name: string;
  readonly message: string;
  /** Error names and messages from the outermost error to the root cause. */
  readonly chain: readonly string[];
  readonly stack?: string;
}

export interface TraceEvent {
  readonly t: string;
  readonly seq: number;
  readonly run: string;
  readonly level: TraceLevel;
  /** Component that emitted the event. */
  readonly scope: string;
  /** Event name within the component. */
  readonly name: string;
  readonly ms?: number;
  readonly ctx?: Readonly<Record<string, unknown>>;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly error?: SerializedError;
}

/** Trace output interface used by file and in-memory sinks. */
export interface TraceSink {
  write(line: string): void;
  snapshot(name: string, content: string): boolean | void;
  location(): string | undefined;
}

/** Records timings, response shapes, and error causes without interrupting command execution. */
export interface Tracer {
  event(level: TraceLevel, scope: string, name: string, data?: Record<string, unknown>): void;
  span<T>(scope: string, name: string, data: Record<string, unknown>, work: () => Promise<T>): Promise<T>;
  /** Captures a response after redaction when snapshots are enabled. */
  snapshot(label: string, content: string, meta?: Record<string, unknown>): void;
  /** Adds context to the events emitted by the returned tracer. */
  with(context: Record<string, unknown>): Tracer;
  /** Registers a secret for redaction. */
  addSecret(value: string): void;
  hasErrors(): boolean;
  /** Flushes buffered events and returns the trace location when available. */
  flush(): string | undefined;
}
