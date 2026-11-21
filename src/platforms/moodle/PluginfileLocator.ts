const URL_BOUNDARY = /[\s"'<>=;,()]/;

/** Finds pluginfile.php first, then scans back a bounded distance to recover the URL prefix. */
export class PluginfileLocator {
  private readonly maxPrefix: number;

  constructor(deps: { maxPrefix: number }) {
    this.maxPrefix = deps.maxPrefix;
  }

  /** Matches the path starting at /pluginfile.php/ and includes the origin when present. */
  locate(text: string, pattern: RegExp): string | undefined {
    const match = pattern.exec(text);
    if (!match) return undefined;

    const floor = Math.max(0, match.index - this.maxPrefix);
    let start = match.index;
    while (start > floor && !URL_BOUNDARY.test(text[start - 1]!)) start -= 1;
    return text.slice(start, match.index + match[0].length);
  }
}
