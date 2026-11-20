/** Centra un cuadro de texto y recorta los bordes cuando la terminal es más pequeña. */
export function fitAsciiFrame(frame: readonly string[], columns: number, rows: number): string[] {
  const width = frame.reduce((longest, line) => Math.max(longest, line.length), 0);
  const top = Math.max(0, Math.floor((rows - frame.length) / 2));
  const firstRow = Math.max(0, Math.floor((frame.length - rows) / 2));
  const firstColumn = Math.max(0, Math.floor((width - columns) / 2));
  const indent = " ".repeat(Math.max(0, Math.floor((columns - width) / 2)));
  return [
    ...Array<string>(top).fill(""),
    ...frame.slice(firstRow, firstRow + rows).map((line) => indent + line.slice(firstColumn, firstColumn + columns)),
  ];
}
