/**
 * Una extensión describe una instalación concreta de una plataforma. Se identifica con un nombre
 * de paquete en dominio inverso (`ro.utcluj.kb`), y su código vive en la ruta equivalente
 * (`src/extensions/ro/utcluj/kb/`). Es solo configuración y sobrescrituras: no carga código dinámico.
 */
export interface Extension {
  readonly id: string;
  readonly baseUrl: string;
  /** Rutas candidatas del contenido de un curso, con `{courseId}`. */
  readonly contentsPaths: readonly string[];
  readonly defaultLocale: string;
}
