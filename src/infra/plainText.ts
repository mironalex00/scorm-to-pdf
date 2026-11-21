const INLINE_BREAKS = /[\t\n\r\u2028\u2029]+/g;
const TERMINAL_CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Strip terminal and directional controls from unstyled output. */
export function plainOutput(text: string): string {
  return text.replace(TERMINAL_CONTROLS, "");
}

export function plainLine(text: string): string {
  return plainOutput(text.replace(INLINE_BREAKS, " "));
}

export function jsonOutput(value: unknown): string {
  return JSON.stringify(value, null, 2).replace(TERMINAL_CONTROLS, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
