export type InterruptCode = 0 | 129 | 130 | 143;

/** Las órdenes con recursos temporales pueden completar su limpieza antes de salir. */
export class CliInterruptions {
  private readonly active = new Set<AbortController>();

  async run(work: (signal: AbortSignal) => Promise<void>): Promise<number> {
    const controller = new AbortController();
    this.active.add(controller);
    try {
      await work(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) throw error;
    } finally {
      this.active.delete(controller);
    }
    return controller.signal.aborted ? controller.signal.reason as InterruptCode : 0;
  }

  request(code: InterruptCode): boolean {
    for (const controller of this.active) controller.abort(code);
    return this.active.size > 0;
  }
}
