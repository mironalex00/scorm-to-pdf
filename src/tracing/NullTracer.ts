import type { Tracer, TraceLevel } from "./Tracer.ts";

/** Trazador que no registra nada: es lo que usan los componentes cuando no se pide traza. */
export class NullTracer implements Tracer {
  event(_level: TraceLevel, _scope: string, _name: string, _data?: Record<string, unknown>): void {}

  span<T>(_scope: string, _name: string, _data: Record<string, unknown>, work: () => Promise<T>): Promise<T> {
    return work();
  }

  snapshot(_label: string, _content: string, _meta?: Record<string, unknown>): void {}

  with(_context: Record<string, unknown>): Tracer {
    return this;
  }

  addSecret(_value: string): void {}

  hasErrors(): boolean {
    return false;
  }

  flush(): string | undefined {
    return undefined;
  }
}
