import { inspect } from "node:util";

/** Inspection and serialization show the label. Use `reveal()` to read the value. */
export class Secret {
  readonly #value: string;
  readonly #label: string;

  private constructor(value: string, label: string) {
    this.#value = value;
    this.#label = label;
  }

  static of(value: string, label: string): Secret {
    return new Secret(value, label);
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return `[secreto:${this.#label}]`;
  }

  toJSON(): string {
    return this.toString();
  }

  [inspect.custom](): string {
    return this.toString();
  }
}
