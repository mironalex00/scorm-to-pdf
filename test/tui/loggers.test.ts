import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuietLogger } from "../../src/application/QuietLogger.ts";
import { TuiLogger } from "../../src/tui/TuiLogger.ts";
import { MemoryLogger } from "../support/fakes.ts";

describe("TuiLogger", () => {
  it("guarda los avisos, ignora info y resultados y reenvía el progreso a quien lo escuche", () => {
    const logger = new TuiLogger();
    const seen: string[] = [];
    logger.progress({ done: 0, total: 1, label: "sin oyente" });
    logger.onProgress((update) => seen.push(update.label));
    logger.info("x");
    logger.result("y");
    logger.warn("cuidado");
    logger.progress({ done: 1, total: 1, label: "uno" });
    assert.deepEqual(seen, ["uno"]);
    assert.deepEqual(logger.warnings, ["cuidado"]);
  });
});

describe("QuietLogger", () => {
  it("solo deja pasar los avisos al registrador interior", () => {
    const inner = new MemoryLogger();
    const quiet = new QuietLogger({ inner });
    quiet.info("a");
    quiet.result("b");
    quiet.progress({ done: 1, total: 2, label: "c" });
    quiet.warn("d");
    assert.deepEqual([inner.infos, inner.results, inner.updates, inner.warnings], [[], [], [], ["d"]]);
  });
});
