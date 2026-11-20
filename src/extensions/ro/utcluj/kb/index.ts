import type { Extension } from "../../../Extension.ts";

/** Moodle installation for the North University Centre of Baia Mare using the Moove theme. */
export const extension: Extension = {
  id: "ro.utcluj.kb",
  baseUrl: "https://kb.cunbm.utcluj.ro/",
  contentsPaths: ["course/view.php?id={courseId}"],
  defaultLocale: "en",
};
