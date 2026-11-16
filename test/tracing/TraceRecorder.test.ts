import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { TraceRecorder } from "../../src/tracing/TraceRecorder.ts";
import { NullTracer } from "../../src/tracing/NullTracer.ts";
import { Redactor } from "../../src/tracing/Redactor.ts";
import { MemoryTraceSink } from "../support/MemoryTraceSink.ts";
import type { TraceEvent } from "../../src/tracing/Tracer.ts";

function make(options: { streaming?: boolean; capture?: boolean; ringSize?: number; sink?: MemoryTraceSink } = {}) {
  const time = { now: Date.parse("2026-11-10T10:00:00.000Z") };
  const sink = options.sink ?? new MemoryTraceSink();
  const redactor = new Redactor();
  const tracer = TraceRecorder.create({
    runId: "run1",
    clock: () => time.now,
    redactor,
    sink,
    streaming: options.streaming ?? false,
    captureBodies: options.capture ?? false,
    ringSize: options.ringSize ?? 100,
  });
  return { tracer, sink, redactor, time };
}
const parse = (lines: string[]): TraceEvent[] => lines.map((line) => JSON.parse(line) as TraceEvent);

describe("TraceRecorder · eventos", () => {
  it("emite eventos con marca de tiempo, secuencia, ejecución, ámbito y datos redactados", () => {
    const { tracer, sink, redactor, time } = make({ streaming: true });
    redactor.addSecret("topsecret");
    time.now += 50;
    tracer.event("info", "moodle.http", "request", { path: "/a?x=topsecret", hop: 0 });
    tracer.event("warn", "moodle.http", "retry");
    const [first, second] = parse(sink.lines);
    assert.deepEqual(
      { ...first, t: undefined },
      { t: undefined, seq: 1, run: "run1", level: "info", scope: "moodle.http", name: "request", data: { path: "/a?x=[REDACTADO]", hop: 0 } },
    );
    assert.equal(first!.t, "2026-11-10T10:00:00.050Z");
    assert.equal(second!.seq, 2);
    assert.equal(second!.data, undefined);
  });

  it("sin streaming conserva los eventos en memoria y los escribe en flush()", () => {
    const { tracer, sink } = make();
    tracer.event("info", "a", "uno");
    assert.deepEqual(sink.lines, []);
    assert.equal(tracer.flush(), sink.location());
    assert.equal(parse(sink.lines).length, 1);
    tracer.flush();
    assert.equal(sink.lines.length, 1, "un segundo flush no duplica");
  });

  it("con streaming flush() no vuelve a escribir lo ya emitido", () => {
    const { tracer, sink } = make({ streaming: true });
    tracer.event("info", "a", "uno");
    tracer.flush();
    assert.equal(sink.lines.length, 1);
  });

  it("el anillo en memoria descarta lo más antiguo al superar su tamaño", () => {
    const { tracer, sink } = make({ ringSize: 3 });
    for (let i = 1; i <= 5; i += 1) tracer.event("info", "a", `e${i}`);
    tracer.flush();
    assert.deepEqual(parse(sink.lines).map((e) => e.name), ["e3", "e4", "e5"]);
  });

  it("recuerda si hubo errores", () => {
    const { tracer } = make();
    assert.equal(tracer.hasErrors(), false);
    tracer.event("error", "a", "boom");
    assert.equal(tracer.hasErrors(), true);
  });

  it("with() añade contexto a cada evento y comparte secuencia y anillo", () => {
    const { tracer, sink } = make({ streaming: true });
    const child = tracer.with({ item: "cm7" }).with({ stage: "fetch" });
    tracer.event("info", "a", "padre");
    child.event("info", "a", "hijo");
    const [parent, kid] = parse(sink.lines);
    assert.equal(parent!.ctx, undefined);
    assert.deepEqual(kid!.ctx, { item: "cm7", stage: "fetch" });
    assert.equal(kid!.seq, 2);
  });

  it("addSecret registra el secreto para todo lo que se emita después", () => {
    const { tracer, sink } = make({ streaming: true });
    tracer.addSecret("cookie-value-123");
    tracer.event("info", "a", "x", { header: "Cookie: cookie-value-123" });
    assert.ok(!sink.lines.join("").includes("cookie-value-123"));
  });
});

describe("TraceRecorder · spans", () => {
  it("un span correcto emite inicio y fin con la duración y devuelve el resultado", async () => {
    const { tracer, sink, time } = make({ streaming: true });
    const result = await tracer.span("catalog", "load", { id: "9" }, async () => {
      time.now += 120;
      return 42;
    });
    assert.equal(result, 42);
    const events = parse(sink.lines);
    assert.deepEqual(events.map((e) => [e.scope, e.name, e.level]), [["catalog", "load.start", "debug"], ["catalog", "load.end", "debug"]]);
    assert.equal(events[0]!.data?.id, "9");
    assert.equal(events[1]!.ms, 120);
  });

  it("un span fallido emite el error con su cadena de causas y relanza el mismo error", async () => {
    const { tracer, sink } = make({ streaming: true });
    const failure = new Error("alto nivel", { cause: new TypeError("causa raíz") });
    await assert.rejects(tracer.span("catalog", "load", {}, async () => { throw failure; }), (e) => e === failure);
    const fail = parse(sink.lines).find((e) => e.name === "load.fail")!;
    assert.equal(fail.level, "error");
    assert.deepEqual(fail.error?.chain, ["Error: alto nivel", "TypeError: causa raíz"]);
    assert.match(fail.error!.stack ?? "", /alto nivel/);
  });

  it("serializa valores lanzados que no son Error", async () => {
    const { tracer, sink } = make({ streaming: true });
    await assert.rejects(tracer.span("a", "b", {}, () => Promise.reject("texto suelto")));
    const fail = parse(sink.lines).find((e) => e.name === "b.fail")!;
    assert.deepEqual(fail.error, { name: "non-error", message: "texto suelto", chain: ["non-error: texto suelto"] });
  });

  it("redacta secretos dentro de mensajes de error", async () => {
    const { tracer, sink, redactor } = make({ streaming: true });
    redactor.addSecret("sk-123456");
    await assert.rejects(tracer.span("a", "b", {}, async () => { throw new Error("falló con sk-123456"); }));
    assert.ok(!sink.lines.join("").includes("sk-123456"));
  });
});

describe("TraceRecorder · capturas y robustez", () => {
  it("snapshot guarda el contenido redactado y truncado solo si la captura está activa", () => {
    const on = make({ capture: true });
    on.redactor.addSecret("topsecret");
    on.tracer.snapshot("courses-page", `hola topsecret ${"x".repeat(300_000)}`, { status: 200 });
    assert.equal(on.sink.snapshots.length, 1);
    const [snap] = on.sink.snapshots;
    assert.equal(snap!.name, "courses-page");
    assert.ok(snap!.content.startsWith("hola [REDACTADO] "));
    assert.ok(snap!.content.length < 210_000 && snap!.content.endsWith("[...truncated]"));

    const off = make({ capture: false });
    off.tracer.snapshot("x", "y");
    assert.equal(off.sink.snapshots.length, 0);
  });

  it("un sink que falla nunca rompe la aplicación", () => {
    const sink = new MemoryTraceSink();
    sink.failing = true;
    const { tracer } = make({ streaming: true, sink });
    assert.doesNotThrow(() => tracer.event("info", "a", "x"));
    assert.doesNotThrow(() => tracer.flush());
    assert.doesNotThrow(() => make({ capture: true, sink }).tracer.snapshot("s", "c"));
  });
});

describe("NullTracer", () => {
  it("ejecuta el trabajo y no registra nada", async () => {
    const tracer = new NullTracer();
    assert.equal(await tracer.span("a", "b", {}, async () => "ok"), "ok");
    assert.equal(tracer.with({ x: 1 }), tracer);
    tracer.event("info", "a", "b");
    tracer.snapshot("a", "b");
    tracer.addSecret("x");
    assert.equal(tracer.hasErrors(), false);
    assert.equal(tracer.flush(), undefined);
  });
});
