/**
 * Synthetic Moodle 4.x fixtures for parser and CLI tests.
 */
export const BASE = "https://moodle.example.org/";
export const SESSKEY = "Ab3dEf9ZqW";

export function coursesPage(sesskey = SESSKEY, title = "My courses"): string {
  return `<!DOCTYPE html><html><head><title>${title}</title><script>
//<![CDATA[
var M = {}; M.yui = {};
M.cfg = {"wwwroot":"https:\\/\\/moodle.example.org","sesskey":"${sesskey}","userId":42,"language":"ro"};
//]]>
</script></head><body class="path-my"></body></html>`;
}

export function coursesJson(courses: Array<{ id: number | string; fullname: string }>): string {
  const full = courses.map((course) => ({ shortname: "x", visible: true, ...course }));
  return JSON.stringify([{ error: false, data: { courses: full, nextoffset: courses.length } }]);
}

export const COURSE_INDEX = `<div id="courseindex-content">
<div id="courseindexsection10" class="courseindex-section" data-for="section" data-id="10" data-number="0">
  <div class="courseindex-item"><a class="courseindex-link courseindex-section-title" data-for="section_title" href="https://moodle.example.org/course/section.php?id=10">General</a></div>
  <ul class="courseindex-sectioncontent">
    <li class="courseindex-item courseindex-cm" data-for="cm" data-id="501"><a class="courseindex-link text-truncate" data-for="cm_name" href="https://moodle.example.org/mod/resource/view.php?id=501"><span class="courseindex-name">Programa</span></a></li>
    <li class="courseindex-item courseindex-cm" data-for="cm" data-id="502"><a class="courseindex-link" data-for="cm_name" href="https://moodle.example.org/mod/forum/view.php?id=502">Anun&#539;uri</a></li>
  </ul>
</div>
<div id="courseindexsection11" class="courseindex-section" data-for="section" data-id="11" data-number="1">
  <div class="courseindex-item"><a class="courseindex-link courseindex-section-title" data-for="section_title" href="#">S&#259;pt&#259;m&#226;na 1</a></div>
  <ul class="courseindex-sectioncontent">
    <li data-for="cm" data-id="511"><a class="courseindex-link" data-for="cm_name" href="https://moodle.example.org/mod/scorm/view.php?id=511"><span class="courseindex-name">Curs 5. Func&#539;ii</span></a></li>
    <li data-for="cm" data-id="512"><a class="courseindex-link" data-for="cm_name" href="https://moodle.example.org/mod/resource/view.php?id=512">Exerci&#539;ii &amp; teme</a></li>
    <li data-for="cm" data-id="513"><a class="courseindex-link" data-for="cm_name" href="https://moodle.example.org/mod/url/view.php?id=513">Enlace</a></li>
  </ul>
</div>
<div id="courseindexsection13" class="courseindex-section" data-for="section" data-id="13" data-number="3">
  <div class="courseindex-item"><span class="courseindex-section-title">Fără enlace</span></div>
  <ul class="courseindex-sectioncontent">
    <li data-for="cm" data-id="531"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=531">Complementar</a></li>
    <li data-for="cm" data-id="531"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=531">Complementar (repetido)</a></li>
    <li data-for="cm" data-id="532"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php?id=532">  </a></li>
    <li data-for="cm" data-id="533"><a class="courseindex-link" data-for="cm_name">Sin enlace</a></li>
    <li data-for="cm" data-id="534"><a class="courseindex-link" data-for="cm_name" href="/mod/resource/view.php">Sin id</a></li>
    <li data-for="cm" data-id="535"><a class="courseindex-link" data-for="cm_name" href="http://[::1">URL inválida</a></li>
    <li data-for="cm" data-id="536"><a class="courseindex-link" data-for="cm_name" href="/enlace/raro">Otro tipo</a></li>
  </ul>
</div>
<div class="courseindex-section" data-for="section" data-id="14" data-number="x"><a data-for="section_title">Sin número</a></div>
</div>`;

/** Synthetic UTCN course body without a sidebar index. */
export const COURSE_BODY = `<div id="region-main"><ul>
  <li id="section-1" data-for="section" data-number="1" data-id="404" data-sectionname="Săptămâna 1">
    <ul><li class="activity modtype_subsection" data-for="cmitem">
      <a href="/course/section.php?id=404#section-15">Introducere</a>
      <a role="button">Deschide</a>
      <ul><li id="section-15" data-for="section" data-number="15" data-id="537" data-sectionname="Curs 1: Introducere">
        <ul>
          <li class="activity modtype_scorm" data-for="cmitem">
            <a class="aalink stretched-link" href="/mod/scorm/view.php?id=511">
              <span class="instancename">Curs 1: <strong>prezentarea</strong> <span class="accesshide">Pachet SCORM</span></span>
            </a>
          </li>
          <li class="activity modtype_resource" data-for="cmitem">
            <a href="/mod/resource/view.php?id=512">Exerciții &amp; teme</a>
          </li>
          <li class="activity modtype_book" data-for="cmitem">
            <a href="/mod/book/view.php?id=513">Carte</a>
          </li>
        </ul>
      </li></ul>
    </li></ul>
  </li>
</ul></div>`;

export const PDF_URL = "https://moodle.example.org/pluginfile.php/55/mod_resource/content/1/Curs%201.pdf";

export const resourceViewer = {
  object: `<html><head><title>Curs 1</title></head><body><object id="resourceobject" data="${PDF_URL}" type="application/pdf"></object></body></html>`,
  iframe: `<html><body><iframe id="resourceobject" src="${PDF_URL}"></iframe></body></html>`,
  link: `<html><body><div class="resourceworkaround"><a href="${PDF_URL}?forcedownload=1">Descargar</a></div></body></html>`,
  scriptOnly: `<html><body><script>window.open("${PDF_URL.replace(/\//g, "\\/")}")</script></body></html>`,
  none: `<html><head><title>Sin archivo</title></head><body><p>nada</p></body></html>`,
  untitled: `<html><body><p>nada</p></body></html>`,
};

export const SCORM_VIEW_FORM = `<html><body><form id="scormviewform" method="post" action="https://moodle.example.org/mod/scorm/player.php">
<input type="hidden" name="mode" value="normal"><input type="hidden" name="scoid" value="6"><input type="hidden" name="cm" value="511"><input type="hidden" name="currentorg" value="ORG-1"><input type="submit" value="Entrar">
</form></body></html>`;

export const SCORM_VIEW_LINK = `<html><body><a href="https://moodle.example.org/mod/scorm/player.php?a=7&amp;currentorg=ORG-1&amp;scoid=9">Entrar</a></body></html>`;

export const ENTRY_URL = "https://moodle.example.org/pluginfile.php/10067/mod_scorm/content/3/index.html";
export const SCORM_LOAD_JS = `<html><body><script>window.location.replace("${ENTRY_URL.replace(/\//g, "\\/")}");</script></body></html>`;
