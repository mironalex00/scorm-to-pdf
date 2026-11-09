/** Una orden de la CLI ya construida con sus dependencias; devuelve el código de salida. */
export interface Command {
  run(): Promise<number>;
}
