import { Secret } from "../../store/Secret.ts";

const PATTERNS: readonly RegExp[] = [
  /"sesskey":"([^"]+)"/,
  /name="sesskey"\s+value="([^"]+)"/,
  /sesskey=([A-Za-z0-9]+)/,
];

/** Localiza la clave de sesión de Moodle en una página: M.cfg, un input oculto o un enlace de logout. */
export class SesskeyExtractor {
  extract(html: string): Secret | undefined {
    for (const pattern of PATTERNS) {
      const match = pattern.exec(html);
      if (match) return Secret.of(match[1]!, "sesskey");
    }
    return undefined;
  }
}
