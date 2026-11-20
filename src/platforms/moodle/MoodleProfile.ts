/** Configuration that varies across Moodle installations. */
export interface MoodleProfile {
  readonly id: string;
  readonly baseUrl: URL;
  /** Course paths tried in order with the course ID substituted. */
  readonly contentsPaths: readonly string[];
  readonly maxFileBytes: number;
}
