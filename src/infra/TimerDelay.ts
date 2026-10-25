import type { Delay } from "../application/ports.ts";

export class TimerDelay implements Delay {
  wait(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
