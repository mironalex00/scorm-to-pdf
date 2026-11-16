import type { OutputStream } from "../../src/infra/ConsoleLogger.ts";

export class CapturedStream implements OutputStream {
  output = "";
  readonly isTTY: boolean;
  readonly columns: number | undefined;

  constructor(isTTY = false, columns?: number) {
    this.isTTY = isTTY;
    this.columns = columns;
  }

  write(text: string): boolean {
    this.output += text;
    return true;
  }
}
