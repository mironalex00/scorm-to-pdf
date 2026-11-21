import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QuietLogger } from "../../src/application/QuietLogger.ts";
import { TuiLogger } from "../../src/tui/TuiLogger.ts";
import { MemoryLogger } from "../support/fakes.ts";

describe("TuiLogger", () => {
  it("forwards progress only while a listener is attached", () => {
    const logger = new TuiLogger();
    const seen: string[] = [];
    logger.progress({ done: 0, total: 1, label: "sin oyente" });
    logger.onProgress((update) => seen.push(update.label));
    logger.info("x");
    logger.result("y");
    logger.warn("watch out");
    logger.progress({ done: 1, total: 1, label: "uno" });
    logger.onProgress(undefined);
    logger.progress({ done: 1, total: 1, label: "detached" });
    assert.deepEqual(seen, ["uno"]);
  });
});

describe("QuietLogger", () => {
  it("forwards warnings to the wrapped logger", () => {
    const inner = new MemoryLogger();
    const quiet = new QuietLogger({ inner });
    quiet.info("a");
    quiet.result("b");
    quiet.progress({ done: 1, total: 2, label: "c" });
    quiet.warn("d");
    assert.deepEqual([inner.infos, inner.results, inner.updates, inner.warnings], [[], [], [], ["d"]]);
  });
});
