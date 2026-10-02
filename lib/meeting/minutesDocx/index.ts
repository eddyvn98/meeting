/**
 * lib/meeting/minutesDocx/index.ts
 *
 * Assembles the generated MOM .docx package from document.ts's data-driven
 * word/document.xml and parts.ts's static parts, using the existing
 * `jszip` dependency (no LibreOffice / no new dependency — see the export
 * route's header comment for why). This is the only export other modules
 * should import from lib/meeting/minutesDocx/**.
 */

import JSZip from "jszip";
import { escapeXml } from "./xml";
import {
  CONTENT_TYPES_XML,
  ROOT_RELS_XML,
  DOCUMENT_RELS_XML,
  STYLES_XML,
  NUMBERING_XML,
  SETTINGS_XML,
  docPropsCoreXml,
  DOC_PROPS_APP_XML,
} from "./parts";
import { buildDocumentXml, type MinutesDocxData } from "./document";

export type { MinutesDocxData } from "./document";

/** Builds a complete .docx (OOXML WordprocessingML package) buffer for the
 *  given MOM data. Pure/no I/O beyond the in-memory zip — safe to call
 *  from a Next.js route handler. */
export async function buildMinutesDocx(data: MinutesDocxData): Promise<Buffer> {
  const zip = new JSZip();

  zip.file("[Content_Types].xml", CONTENT_TYPES_XML);
  zip.folder("_rels")!.file(".rels", ROOT_RELS_XML);
  const wordFolder = zip.folder("word")!;
  wordFolder.file("document.xml", buildDocumentXml(data));
  wordFolder.file("styles.xml", STYLES_XML);
  wordFolder.file("numbering.xml", NUMBERING_XML);
  wordFolder.file("settings.xml", SETTINGS_XML);
  wordFolder.folder("_rels")!.file("document.xml.rels", DOCUMENT_RELS_XML);

  const docPropsFolder = zip.folder("docProps")!;
  const title = escapeXml(data.minutes.title ?? "Minutes of Meeting");
  docPropsFolder.file("core.xml", docPropsCoreXml(title, new Date().toISOString()));
  docPropsFolder.file("app.xml", DOC_PROPS_APP_XML);

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  return buffer;
}
