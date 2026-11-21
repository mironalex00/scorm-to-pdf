import type { Redactor } from "./Redactor.ts";
import type { Tracer, TraceLevel } from "./Tracer.ts";

export class NullTracer implements Tracer {
  private readonly redactor: Redactor | undefined;

  constructor(redactor?: Redactor) {
    this.redactor = redactor;
  }

  event(_level: TraceLevel, _scope: string, _name: string, _data?: Record<string, unknown>): void {}

  span<T>(_scope: string, _name: string, _data: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
    return work();
  }

  snapshot(_label: string, _content: string, _meta?: Record<string, unknown>): void {}

  with(_context: Record<string, unknown>): Tracer {
    return this;
  }

  addSecret(value: string): void {
    this.redactor?.addSecret(value);
  }

  hasErrors(): boolean {
    return false;
  }

  flush(): string | undefined {
    return undefined;
  }
}
