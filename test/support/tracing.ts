import { Redactor } from "../../src/tracing/Redactor.ts";
import { TraceRecorder } from "../../src/tracing/TraceRecorder.ts";
import type { TraceEvent } from "../../src/tracing/Tracer.ts";
import { MemoryTraceSink } from "./MemoryTraceSink.ts";

/** Records emitted diagnostic events in memory for assertions. */
export function makeRecorder(options: { capture?: boolean } = {}) {
  const sink = new MemoryTraceSink();
  const redactor = new Redactor();
  const tracer = TraceRecorder.create({
    runId: "test",
    clock: () => 1_000,
    redactor,
    sink,
    streaming: true,
    captureBodies: options.capture ?? false,
    ringSize: 50,
  });
  return {
    tracer,
    sink,
    redactor,
    events: (): TraceEvent[] => sink.lines.map((line) => JSON.parse(line) as TraceEvent),
  };
}
