import { NotFoundError } from "../domain/errors.ts";
import type { Logger } from "./ports.ts";
import type { MoodleSession } from "./MoodleSession.ts";
import type { Messages } from "../i18n/Messages.ts";

export interface LocateRequest {
  readonly baseUrl: URL;
  readonly scormId: number;
  readonly entry: string;
  readonly revision: number | undefined;
}

export interface LocatedScorm {
  readonly entryUrl: URL;
  readonly html: string;
  readonly revision: number;
}

/**
 * Traduce el ID del módulo SCORM en la URL de su documento de entrada.
 * El número de revisión de la URL suele ser un simple «cache-buster»; si el servidor
 * lo ignora, la revisión 1 acierta a la primera. Si no, se sondea por tandas.
 */
export class ScormLocator {
  private readonly session: MoodleSession;
  private readonly logger: Logger;
  private readonly maxRevision: number;
  private readonly probeBatchSize: number;
  private readonly messages: Messages;

  constructor(deps: {
    session: MoodleSession;
    logger: Logger;
    maxRevision: number;
    probeBatchSize: number;
    messages: Messages;
  }) {
    this.messages = deps.messages;
    this.session = deps.session;
    this.logger = deps.logger;
    this.maxRevision = deps.maxRevision;
    this.probeBatchSize = deps.probeBatchSize;
  }

  async locate(request: LocateRequest): Promise<LocatedScorm> {
    if (request.revision !== undefined) return this.fetchExplicit(request, request.revision);

    const first = await this.tryRevision(request, 1);
    if (first.kind === "found") return first.located;
    if (first.kind === "failed") throw first.error;

    this.logger.info(this.messages.locator.probingRevisions({ max: String(this.maxRevision) }));
    const others = [0, ...Array.from({ length: Math.max(0, this.maxRevision - 1) }, (_, index) => index + 2)];
    for (let start = 0; start < others.length; start += this.probeBatchSize) {
      const batch = others.slice(start, start + this.probeBatchSize);
      const outcomes = await Promise.all(batch.map((revision) => this.tryRevision(request, revision)));
      const found = outcomes.find((outcome) => outcome.kind === "found");
      if (found) return found.located;
      const failed = outcomes.find((outcome) => outcome.kind === "failed");
      if (failed) throw failed.error;
    }

    throw new NotFoundError(
      this.messages.locator.revisionsNotFound({
        entry: request.entry,
        id: String(request.scormId),
        max: String(this.maxRevision),
      }),
    );
  }

  private async fetchExplicit(request: LocateRequest, revision: number): Promise<LocatedScorm> {
    const outcome = await this.tryRevision(request, revision);
    if (outcome.kind === "found") return outcome.located;
    if (outcome.kind === "failed") throw outcome.error;
    throw new NotFoundError(this.messages.locator.explicitRevisionMissing({ path: outcome.url.pathname }));
  }

  private async tryRevision(request: LocateRequest, revision: number): Promise<RevisionOutcome> {
    const url = new URL(
      `pluginfile.php/${request.scormId}/mod_scorm/content/${revision}/${request.entry}`,
      request.baseUrl,
    );
    try {
      const { text, finalUrl } = await this.session.getText(url);
      return { kind: "found", located: { entryUrl: finalUrl, html: text, revision } };
    } catch (error) {
      if (error instanceof NotFoundError) return { kind: "missing", url };
      return { kind: "failed", error };
    }
  }
}

type RevisionOutcome =
  | { readonly kind: "found"; readonly located: LocatedScorm }
  | { readonly kind: "missing"; readonly url: URL }
  | { readonly kind: "failed"; readonly error: unknown };
