import { describe, it } from "node:test";
import { en } from "../../src/i18n/en.ts";
import assert from "node:assert/strict";
import { ConsoleLogger } from "../../src/infra/ConsoleLogger.ts";
import { CapturedStream } from "../support/streams.ts";

describe("ConsoleLogger with redirected output", () => {
  it("writes info to stdout and prefixed warnings to stderr", () => {
    const stdout = new CapturedStream();
    const stderr = new CapturedStream();
    const logger = new ConsoleLogger({ messages: en, stdout, stderr, quiet: false });
    logger.info("hola");
    logger.warn("watch out");
    assert.equal(stdout.output, "hola\n");
    assert.equal(stderr.output, "Warning: watch out\n");
  });

  it("prints one progress line per slide", () => {
    const stdout = new CapturedStream();
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 12, label: "Uno" });
    logger.progress({ done: 2, total: 12, label: "Dos" });
    assert.equal(stdout.output, "[ 1/12] Uno\n[ 2/12] Dos\n");
  });

  it("suppresses info and progress in quiet mode while preserving warnings", () => {
    const stdout = new CapturedStream();
    const stderr = new CapturedStream();
    const logger = new ConsoleLogger({ messages: en, stdout, stderr, quiet: true });
    logger.info("x");
    logger.progress({ done: 1, total: 1, label: "x" });
    logger.warn("important");
    assert.equal(stdout.output, "");
    assert.equal(stderr.output, "Warning: important\n");
  });
});

describe("ConsoleLogger in a terminal", () => {
  const CLEAR = "\r\x1b[2K";

  it("redraws progress in place until the final newline", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Uno" });
    logger.progress({ done: 2, total: 2, label: "Dos" });
    assert.equal(stdout.output, `${CLEAR}[1/2] Uno${CLEAR}[2/2] Dos\n`);
  });

  it("fits long labels to the terminal width", () => {
    const stdout = new CapturedStream(true, 20);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Una etiqueta larguísima de verdad" });
    assert.equal(stdout.output, `${CLEAR}[1/2] Una etiquet…`);
  });

  it("keeps the full label when the terminal width is unknown", () => {
    const stdout = new CapturedStream(true);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 2, label: "Etiqueta completa sin límite" });
    assert.ok(stdout.output.includes("Etiqueta completa sin límite"));
  });

  it("clears the active progress line before writing a message", () => {
    const stdout = new CapturedStream(true, 80);
    const stderr = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr, quiet: false });
    logger.progress({ done: 1, total: 3, label: "Uno" });
    logger.warn("retry");
    assert.equal(stderr.output, `${CLEAR}Warning: retry\n`);
    logger.info("fin");
    assert.equal(stdout.output, `${CLEAR}[1/3] Unofin\n`);
  });

  it("writes no clear sequence when there is no active progress line", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.info("hola");
    assert.equal(stdout.output, "hola\n");
  });
});

describe("ConsoleLogger results", () => {
  it("writes results to stdout in quiet mode", () => {
    const stdout = new CapturedStream();
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: true });
    logger.info("ruido");
    logger.result("/ruta/salida.pdf");
    assert.equal(stdout.output, "/ruta/salida.pdf\n");
  });

  it("clears the active progress line before writing the result", () => {
    const stdout = new CapturedStream(true, 80);
    const logger = new ConsoleLogger({ messages: en, stdout, stderr: new CapturedStream(), quiet: false });
    logger.progress({ done: 1, total: 3, label: "Uno" });
    logger.result("fin.pdf");
    assert.ok(stdout.output.endsWith("\r\x1b[2Kfin.pdf\n"));
  });
});
