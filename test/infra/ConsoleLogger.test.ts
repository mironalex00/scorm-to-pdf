import { describe, it } from "node:test";
import { es } from "../../src/i18n/es.ts";
import assert from "node:assert/strict";
import { ConsoleLogger } from "../../src/infra/ConsoleLogger.ts";
import { CapturedStream } from "../support/streams.ts";

describe("ConsoleLogger · modo no interactivo", () => {
  it("info va a stdout y warn a stderr con prefijo", () => {
    const stdout = new CapturedStream();
    const stderr = new CapturedStream();
    const logger = new ConsoleLogger({ messages: es, stdout, stderr, quiet: false });
    logger.info("hola");
    logger.warn("cuidado");
    assert.equal(stdout.output, "hola\n");
    assert.equal(stderr.output, "Aviso: cuidado\n");
  });

  it("el progreso imprime una línea por diapositiva", () => {
    const stdout = new CapturedStream();
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 12, label: "Uno" });
    logger.progress({ done: 2, total: 12, label: "Dos" });
    assert.equal(stdout.output, "[ 1/12] Uno\n[ 2/12] Dos\n");
  });

  it("--quiet silencia info y progreso pero nunca los avisos", () => {
    const stdout = new CapturedStream();
    const stderr = new CapturedStream();
    const logger = new ConsoleLogger({ messages: es, stdout, stderr, quiet: true });
    logger.info("x");
    logger.progress({ done: 1, total: 1, label: "x" });
    logger.warn("importante");
    assert.equal(stdout.output, "");
    assert.equal(stderr.output, "Aviso: importante\n");
  });
});

describe("ConsoleLogger · terminal interactiva", () => {
  const CLEAR = "\r\x1b[2K";

  it("redibuja el progreso en la misma línea y cierra con salto de línea al terminar", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Uno" });
    logger.progress({ done: 2, total: 2, label: "Dos" });
    assert.equal(stdout.output, `${CLEAR}[1/2] Uno${CLEAR}[2/2] Dos\n`);
  });

  it("trunca etiquetas largas al ancho de la terminal", () => {
    const stdout = new CapturedStream(true, 20);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Una etiqueta larguísima de verdad" });
    assert.equal(stdout.output, `${CLEAR}[1/2] Una etiquet…`);
  });

  it("no trunca si la terminal no informa de su ancho", () => {
    const stdout = new CapturedStream(true);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Etiqueta completa sin límite" });
    assert.ok(stdout.output.includes("Etiqueta completa sin límite"));
  });

  it("limpia la línea de progreso abierta antes de imprimir un mensaje", () => {
    const stdout = new CapturedStream(true, 80);
    const stderr = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr, quiet: false });
    logger.progress({ done: 1, total: 3, label: "Uno" });
    logger.warn("reintento");
    assert.equal(stderr.output, `${CLEAR}Aviso: reintento\n`);
    logger.info("fin");
    assert.equal(stdout.output, `${CLEAR}[1/3] Unofin\n`);
  });

  it("no emite secuencias de limpieza si no hay línea abierta", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.info("hola");
    assert.equal(stdout.output, "hola\n");
  });
});

describe("ConsoleLogger · resultado", () => {
  it("result imprime siempre en stdout, incluso con --quiet", () => {
    const stdout = new CapturedStream();
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: true });
    logger.info("ruido");
    logger.result("/ruta/salida.pdf");
    assert.equal(stdout.output, "/ruta/salida.pdf\n");
  });

  it("result limpia una línea de progreso abierta en una terminal", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: es, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 3, label: "Uno" });
    logger.result("fin.pdf");
    assert.ok(stdout.output.endsWith("\r\x1b[2Kfin.pdf\n"));
  });
});
