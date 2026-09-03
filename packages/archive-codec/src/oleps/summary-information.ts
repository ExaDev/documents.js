import { PropertySetFormatError, readPropertySetStream } from "./read";
import { CP_WINUNICODE, PID_CODEPAGE, type PropertyValue } from "./wire";
import { writePropertySetStream } from "./write";

// The one named [MS-OLEPS] property set every legacy binary Office document ([MS-OSHARED] 2.3.3.2.2) carries its title/author/dates in: the fixed SummaryInformation property set, conventionally stored as a "\x05SummaryInformation" stream in the document's own [MS-CFB] compound file. This is the layer that knows PID 2 means a title -- ../cfb/read.ts and ./read.ts/./write.ts below it know nothing about SummaryInformation specifically, exactly as ../cfb/ole-package.ts knows the OLE Package stream's own field layout while ../cfb/read.ts knows only generic compound-file structure.
//
// Deliberately narrower than the full SummaryInformation property set [MS-OLEPS] 3.1 documents: only the seven fields a caller (doc-codec, xls-codec, ppt-codec) actually needs are read and written -- title, subject, author, keywords, comments, and the three FILETIME timestamps (created, last saved, last printed). PIDSI_TEMPLATE, PIDSI_LASTAUTHOR, PIDSI_REVNUMBER, PIDSI_APPNAME, PIDSI_EDITTIME, PIDSI_PAGECOUNT, PIDSI_WORDCOUNT, PIDSI_CHARCOUNT, and PIDSI_DOC_SECURITY are not read or written -- an honest, explicitly out-of-scope remainder, alongside DocumentSummaryInformation's own extended and user-defined property sets (a different stream, "\x05DocumentSummaryInformation", carrying company/manager/custom properties -- not attempted at all).
//
// KEYWORDS is [MS-OLEPS] 2.19/2.20's own single free-text string, not a vector -- there is no delimiter [MS-OLEPS] mandates, so this joins/splits on ", ", the convention already established for the identical shape in ooxml.js's cp:keywords and pdf-codec's /Keywords (see packages/ooxml.js/src/typed/shared/metadata.ts and packages/pdf-codec/src/read.ts).

// [MS-OLEPS] 3.1: the FMTID every SummaryInformation property set declares as its FMTID0.
export const FMTID_SUMMARY_INFORMATION =
  "{F29F85E0-4FF9-1068-AB91-08002B27B3D9}";

// [MS-OSHARED] 2.3.3.2.2 / [MS-OLEPS] 3.1: the property identifiers this module reads and writes, verified against the spec's own worked SummaryInformation Property Set example.
const PID_TITLE = 2;
const PID_SUBJECT = 3;
const PID_AUTHOR = 4;
const PID_KEYWORDS = 5;
const PID_COMMENTS = 6;
const PID_LASTPRINTED = 11;
const PID_CREATE_DTM = 12;
const PID_LASTSAVE_DTM = 13;

const KEYWORDS_DELIMITER = ", ";

export interface SummaryInformationProperties {
  readonly title?: string;
  readonly subject?: string;
  readonly author?: string;
  readonly keywords?: readonly string[];
  readonly comments?: string;
  readonly createdIso?: string;
  readonly lastSavedIso?: string;
  readonly lastPrintedIso?: string;
}

function splitKeywords(value: string): string[] | undefined {
  const parts = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : undefined;
}

function stringValue(
  value: PropertyValue | undefined,
  pid: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (value.type !== "VT_LPSTR" && value.type !== "VT_LPWSTR") {
    throw new PropertySetFormatError(
      `SummaryInformation property ${pid} has type ${value.type}, not a string type as [MS-OLEPS]'s SummaryInformation Property Set defines`,
    );
  }
  return value.value.length > 0 ? value.value : undefined;
}

// [MS-OLEPS] 2.15: a producer that has never printed/saved/created-tracked a document conventionally writes an all-zero FILETIME (decoding to the FILETIME epoch itself, 1601-01-01) for that PID rather than omitting the property. Reading that back as absent, not as the year 1601, matches how a caller should only ever see a genuinely-set timestamp.
const FILETIME_UNSET_ISO = "1601-01-01T00:00:00.000Z";

function dateIsoValue(
  value: PropertyValue | undefined,
  pid: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (value.type !== "VT_FILETIME") {
    throw new PropertySetFormatError(
      `SummaryInformation property ${pid} has type ${value.type}, not VT_FILETIME as [MS-OLEPS]'s SummaryInformation Property Set defines`,
    );
  }
  const iso = value.value.toISOString();
  return iso === FILETIME_UNSET_ISO ? undefined : iso;
}

// Parses a "\x05SummaryInformation" stream's bytes into the seven fields this module covers. Throws PropertySetFormatError if the stream is not a SummaryInformation property set (wrong FMTID) or structurally malformed; a property this module does not project (see the scope note above) is present in the stream but simply not read.
export function readSummaryInformation(
  bytes: Uint8Array<ArrayBuffer>,
): SummaryInformationProperties {
  const propertySet = readPropertySetStream(bytes);
  if (propertySet.formatId !== FMTID_SUMMARY_INFORMATION) {
    throw new PropertySetFormatError(
      `property set stream declares FMTID ${propertySet.formatId}, not FMTID_SummaryInformation (${FMTID_SUMMARY_INFORMATION}); this is not a "\\x05SummaryInformation" stream`,
    );
  }
  const { properties } = propertySet;
  const keywords = stringValue(properties.get(PID_KEYWORDS), PID_KEYWORDS);
  return {
    title: stringValue(properties.get(PID_TITLE), PID_TITLE),
    subject: stringValue(properties.get(PID_SUBJECT), PID_SUBJECT),
    author: stringValue(properties.get(PID_AUTHOR), PID_AUTHOR),
    keywords: keywords === undefined ? undefined : splitKeywords(keywords),
    comments: stringValue(properties.get(PID_COMMENTS), PID_COMMENTS),
    createdIso: dateIsoValue(properties.get(PID_CREATE_DTM), PID_CREATE_DTM),
    lastSavedIso: dateIsoValue(
      properties.get(PID_LASTSAVE_DTM),
      PID_LASTSAVE_DTM,
    ),
    lastPrintedIso: dateIsoValue(
      properties.get(PID_LASTPRINTED),
      PID_LASTPRINTED,
    ),
  };
}

// Builds a well-formed "\x05SummaryInformation" stream's bytes from the same shape readSummaryInformation returns. Only the fields actually present are written -- a real SummaryInformation stream need not carry every property, and a caller wanting an honestly-empty stream (just the CodePage property every real producer includes) can pass {}.
export function writeSummaryInformationStream(
  properties: SummaryInformationProperties,
): Uint8Array<ArrayBuffer> {
  const entries = new Map<number, PropertyValue>();
  // CP_WINUNICODE, since every string this module writes is VT_LPWSTR (see ./write.ts's own scope note on why it never writes VT_LPSTR).
  entries.set(PID_CODEPAGE, { type: "VT_I2", value: CP_WINUNICODE });
  if (properties.title !== undefined) {
    entries.set(PID_TITLE, { type: "VT_LPWSTR", value: properties.title });
  }
  if (properties.subject !== undefined) {
    entries.set(PID_SUBJECT, { type: "VT_LPWSTR", value: properties.subject });
  }
  if (properties.author !== undefined) {
    entries.set(PID_AUTHOR, { type: "VT_LPWSTR", value: properties.author });
  }
  if (properties.keywords !== undefined && properties.keywords.length > 0) {
    entries.set(PID_KEYWORDS, {
      type: "VT_LPWSTR",
      value: properties.keywords.join(KEYWORDS_DELIMITER),
    });
  }
  if (properties.comments !== undefined) {
    entries.set(PID_COMMENTS, {
      type: "VT_LPWSTR",
      value: properties.comments,
    });
  }
  if (properties.createdIso !== undefined) {
    entries.set(PID_CREATE_DTM, {
      type: "VT_FILETIME",
      value: new Date(properties.createdIso),
    });
  }
  if (properties.lastSavedIso !== undefined) {
    entries.set(PID_LASTSAVE_DTM, {
      type: "VT_FILETIME",
      value: new Date(properties.lastSavedIso),
    });
  }
  if (properties.lastPrintedIso !== undefined) {
    entries.set(PID_LASTPRINTED, {
      type: "VT_FILETIME",
      value: new Date(properties.lastPrintedIso),
    });
  }
  return writePropertySetStream({
    formatId: FMTID_SUMMARY_INFORMATION,
    properties: entries,
  });
}
