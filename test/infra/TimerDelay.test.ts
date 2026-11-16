import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { TimerDelay } from "../../src/infra/TimerDelay.ts";

describe("TimerDelay", () => {
  it("resuelve cuando transcurre el tiempo pedido", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let resolved = false;
      const pending = new TimerDelay().wait(250).then(() => {
        resolved = true;
      });
      mock.timers.tick(249);
      await Promise.resolve();
      assert.equal(resolved, false);
      mock.timers.tick(1);
      await pending;
      assert.equal(resolved, true);
    } finally {
      mock.timers.reset();
    }
  });
});
