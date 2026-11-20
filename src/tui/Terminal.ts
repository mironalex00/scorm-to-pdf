export type KeyName =
  | "up" | "down" | "left" | "right" | "enter" | "escape" | "backspace" | "space" | "tab"
  | "pageup" | "pagedown" | "home" | "end" | "char" | "ctrl-c";

export interface KeyPress {
  readonly name: KeyName;
  /** Printable value for a character or space key. */
  readonly char?: string;
}

export interface TerminalSize {
  readonly columns: number;
  readonly rows: number;
}

/** Terminal I/O for interactive sessions and scripted tests. */
export interface Terminal {
  readonly interactive: boolean;
  size(): TerminalSize;
  /** Switches to raw input and the alternate screen. */
  open(): void;
  /** Restores the original terminal state. Safe to call more than once. */
  close(): void;
  render(lines: readonly string[]): void;
  readKey(signal?: AbortSignal): Promise<KeyPress>;
}

export type ScreenResult<T> =
  | { readonly kind: "stay" }
  | { readonly kind: "done"; readonly value: T }
  | { readonly kind: "back" }
  | { readonly kind: "cancel" };

/** Renders state and handles keys without terminal I/O. */
export interface Screen<T> {
  render(size: TerminalSize): string[];
  press(key: KeyPress): ScreenResult<T>;
}
