/** Todo lo que varía de una instalación de Moodle a otra y no es código. */
export interface MoodleProfile {
  readonly id: string;
  readonly baseUrl: URL;
  /** Rutas candidatas del contenido de un curso, con `{courseId}`; se prueban en orden. */
  readonly contentsPaths: readonly string[];
  readonly maxFileBytes: number;
}
