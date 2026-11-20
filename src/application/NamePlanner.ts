import type { CourseItem, Section } from "../domain/catalog.ts";
import type { FileNamer } from "./FileNamer.ts";

/**
 * Asigna de antemano un nombre base a cada ítem. Los duplicados de una misma sección se numeran
 * por orden de entrada, así el resultado no depende de qué descarga termine antes.
 */
export class NamePlanner {
  private readonly namer: FileNamer;

  constructor(deps: { namer: FileNamer }) {
    this.namer = deps.namer;
  }

  sectionFolders(sections: readonly Section[]): Map<number, string> {
    const ordered = [...sections].sort((a, b) => a.number - b.number);
    return this.namer.directoryNames(ordered.map(({ number, title }) => [number, title.trim() || String(number)]));
  }

  plan(items: readonly CourseItem[]): Map<string, string> {
    const counts = new Map<string, number>();
    const plan = new Map<string, string>();
    for (const item of items) {
      const base = this.namer.baseName(item.name);
      const key = `${item.sectionNumber}/${base.toLowerCase()}`;
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      plan.set(item.id, occurrence === 1 ? base : `${base} (${occurrence})`);
    }
    return plan;
  }
}
