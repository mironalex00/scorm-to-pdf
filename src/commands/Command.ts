/** An initialized CLI command that returns an exit status. */
export interface Command {
  run(): Promise<number>;
}
