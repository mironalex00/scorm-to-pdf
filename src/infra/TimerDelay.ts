import { setTimeout } from "node:timers/promises";
import type { Delay } from "../application/ports.ts";

export class TimerDelay implements Delay {
  private readonly signal: AbortSignal | undefined;

  constructor(signal?: AbortSignal) {
    this.signal = signal;
  }

  wait(milliseconds: number): Promise<void> {
    return setTimeout(milliseconds, undefined, { signal: this.signal });
  }
}
