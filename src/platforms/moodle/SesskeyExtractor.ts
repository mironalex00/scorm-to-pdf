import { Secret } from "../../store/Secret.ts";

const PATTERNS: readonly RegExp[] = [
  /"sesskey":"([^"]+)"/,
  /name="sesskey"\s+value="([^"]+)"/,
  /sesskey=([A-Za-z0-9]+)/,
];

/** Extracts the session key from Moodle configuration, a hidden input, or the logout link. */
export class SesskeyExtractor {
  extract(html: string): Secret | undefined {
    for (const pattern of PATTERNS) {
      const match = pattern.exec(html);
      if (match) return Secret.of(match[1]!, "sesskey");
    }
    return undefined;
  }
}
