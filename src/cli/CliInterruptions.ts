export type InterruptCode = 0 | 129 | 130 | 143;
const SIGNAL_CODES = [["SIGHUP", 129], ["SIGINT", 130], ["SIGTERM", 143]] as const;

export async function withProcessSignals<T>(
  work: () => Promise<T>, stop: (code: Exclude<InterruptCode, 0>) => void,
): Promise<T> {
  const handlers = SIGNAL_CODES.map(([signal, code]) => [signal, () => stop(code)] as const);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    return await work();
  } finally {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  }
}

/** Give a running command time to release its resources after an interruption. */
export class CliInterruptions {
  private readonly active = new Set<AbortController>();

  async run(work: (signal: AbortSignal) => Promise<number | void>): Promise<number> {
    const controller = new AbortController();
    this.active.add(controller);
    let result = 0;
    try {
      result = (await work(controller.signal)) ?? 0;
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      this.active.delete(controller);
    }
    return controller.signal.aborted ? controller.signal.reason as InterruptCode : result;
  }

  request(code: InterruptCode): boolean {
    for (const controller of this.active) controller.abort(code);
    return this.active.size > 0;
  }
}
