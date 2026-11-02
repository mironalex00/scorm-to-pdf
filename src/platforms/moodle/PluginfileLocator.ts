const URL_BOUNDARY = /[\s"'<>=;,()]/;

/**
 * Localiza una referencia a pluginfile.php dentro de un texto cualquiera (HTML, JavaScript…).
 * Primero busca la parte fija con una expresión lineal y después reconstruye el inicio de la URL
 * retrocediendo un máximo de caracteres: una sola expresión con prefijo opcional es cuadrática
 * frente a páginas con rachas largas de «http://» (8 s con 350 KB, en Node y en Bun).
 */
export class PluginfileLocator {
  private readonly maxPrefix: number;

  constructor(deps: { maxPrefix: number }) {
    this.maxPrefix = deps.maxPrefix;
  }

  /** `pattern` debe casar la ruta que empieza en «/pluginfile.php/»; el resultado incluye el dominio si lo había. */
  locate(text: string, pattern: RegExp): string | undefined {
    const match = pattern.exec(text);
    if (!match) return undefined;

    const floor = Math.max(0, match.index - this.maxPrefix);
    let start = match.index;
    while (start > floor && !URL_BOUNDARY.test(text[start - 1]!)) start -= 1;
    return text.slice(start, match.index + match[0].length);
  }
}
