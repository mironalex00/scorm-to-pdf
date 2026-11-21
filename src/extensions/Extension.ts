/** Configuration for a Moodle installation. The package ID matches its path under src/extensions. */
export interface Extension {
  readonly id: string;
  readonly baseUrl: string;
  /** Course paths with a placeholder for the course ID. */
  readonly contentsPaths: readonly string[];
  readonly defaultLocale: string;
}
