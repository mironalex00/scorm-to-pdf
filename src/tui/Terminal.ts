export type KeyName =
  | "up" | "down" | "left" | "right" | "enter" | "escape" | "backspace" | "space" | "tab"
  | "pageup" | "pagedown" | "home" | "end" | "char" | "ctrl-c";

export interface KeyPress {
  readonly name: KeyName;
  /** Carácter tecleado (solo con `char` y `space`). */
  readonly char?: string;
}

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/** La pantalla y el teclado. En producción son stdin/stdout en modo raw; en las pruebas, un guion de teclas. */
export interface Terminal {
  readonly interactive: boolean;
  size(): TerminalSize;
  /** Entra en pantalla alternativa con el cursor oculto y el teclado en modo raw. */
  open(): void;
  /** Restaura la terminal. Debe ser seguro llamarlo aunque no se haya abierto. */
  close(): void;
  render(lines: readonly string[]): void;
  readKey(): Promise<KeyPress>;
}

export type ScreenResult<T> =
  | { readonly kind: "stay" }
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" };

/** Una pantalla es pura: dibuja un estado y reacciona a una tecla; no toca la terminal. */
export interface Screen<T> {
  render(size: TerminalSize): string[];
  press(key: KeyPress): ScreenResult<T>;
}
