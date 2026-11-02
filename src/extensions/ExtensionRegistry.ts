import { UsageError } from "../domain/errors.ts";
import type { Messages } from "../i18n/Messages.ts";
import type { Extension } from "./Extension.ts";

const GENERIC_ID = "org.moodle";

export interface ResolvedPlatform {
  readonly extension: Extension;
  readonly baseUrl: URL;
}

/**
 * Elige la extensión a usar. El registro es una lista estática declarada en la raíz de composición:
 * nada se descubre ni se carga en tiempo de ejecución. Una URL de un host sin extensión usa Moodle estándar.
 */
export class ExtensionRegistry {
  private readonly extensions: readonly Extension[];
  private readonly defaultId: string;
  private readonly messages: Messages;

  constructor(deps: { extensions: readonly Extension[]; defaultId: string; messages: Messages }) {
    this.extensions = deps.extensions;
    this.defaultId = deps.defaultId;
    this.messages = deps.messages;
  }

  resolve(input: { spec: string | undefined; baseUrl: URL | undefined }): ResolvedPlatform {
    const { spec, baseUrl } = input;
    if (spec !== undefined) {
      if (/^https?:\/\//i.test(spec)) return this.byHost(this.parseUrl(spec));
      const known = this.extensions.find((extension) => extension.id === spec);
      if (!known) throw this.unknown(spec);
      return { extension: known, baseUrl: baseUrl ?? new URL(known.baseUrl) };
    }
    if (baseUrl) return this.byHost(baseUrl);
    const fallback = this.extensions.find((extension) => extension.id === this.defaultId)!;
    return { extension: fallback, baseUrl: new URL(fallback.baseUrl) };
  }

  private byHost(url: URL): ResolvedPlatform {
    const normalized = new URL(url.href);
    normalized.pathname = `${normalized.pathname.replace(/\/+$/, "")}/`;
    const known = this.extensions.find((extension) => new URL(extension.baseUrl).host === normalized.host);
    return { extension: known ?? this.generic(normalized), baseUrl: normalized };
  }

  private generic(url: URL): Extension {
    return { id: GENERIC_ID, baseUrl: url.href, contentsPaths: ["course/view.php?id={courseId}"], defaultLocale: "es" };
  }

  private parseUrl(spec: string): URL {
    try {
      return new URL(spec);
    } catch {
      throw this.unknown(spec);
    }
  }

  private unknown(spec: string): UsageError {
    return new UsageError(
      this.messages.platform.extensionUnknown({ spec, known: this.extensions.map((extension) => extension.id).join(", ") }),
    );
  }
}
