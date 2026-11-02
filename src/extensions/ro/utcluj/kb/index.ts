import type { Extension } from "../../../Extension.ts";

/** Knowledge Base del Centro Universitario Nord Baia Mare (UTCN): Moodle con el tema moove. */
export const extension: Extension = {
  id: "ro.utcluj.kb",
  baseUrl: "https://kb.cunbm.utcluj.ro/",
  contentsPaths: ["course/view.php?id={courseId}"],
  defaultLocale: "es",
};
