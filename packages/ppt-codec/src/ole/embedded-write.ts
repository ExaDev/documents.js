import type { ContentEmbeddedObjectKind } from "document-schema.js";
import {
  OfficeArtClientData,
  RT_CString,
  RT_ExternalObjectList,
  RT_ExternalObjectListAtom,
  RT_ExternalObjectRefAtom,
  RT_ExternalOleEmbed,
  RT_ExternalOleEmbedAtom,
  RT_ExternalOleObjectAtom,
  RT_ExternalOleObjectStg,
} from "../record/types";
import {
  concatBytes,
  u32le,
  utf16le,
  writeAtom,
  writeContainer,
} from "../record/write";

// The write-side mirror of ole/embedded.ts: one ExOleEmbedContainer per embedded object a slide's shape carries and a serialiser port actually recovered bytes for, wired into the document's ExObjListContainer, with the shape's own OfficeArtClientData naming which entry it displays through an ExObjRefAtom. Always writes the storage uncompressed (ExOleObjStgUncompressedAtom): compression is optional per [MS-PPT] 2.10.34 and a written .ppt is never the untrusted, size-constrained artifact a compressed read path exists to tolerate, so there is no real benefit to reproducing the compressed spelling. [MS-PPT] 2.10.12 ExOleObjAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3517016-8e32-4585-9a42-adae02eea798 [MS-PPT] 2.10.27 ExOleEmbedContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c687090c-a359-4ffc-918e-415117e10229

// ExOleObjTypeEnum ([MS-PPT] 2.10.13): only the embedded case is ever written here -- a linked object names a file this writer has no path of its own to resolve, and an ActiveX control is a different embedding kind this module does not produce.
const EX_OLE_TYPE_EMBEDDED = 0x00000000;
// ExOleObjSubTypeEnum ([MS-PPT] 2.10.14): the three ProgID-bearing kinds this writer can actually name (writeProgIdFor below), plus the default for anything else.
const EX_OLE_SUBTYPE_DEFAULT = 0x00000000;
const EX_OLE_SUBTYPE_WORD_DOC = 0x00000002;
const EX_OLE_SUBTYPE_EXCEL = 0x00000003;
// DataViewAspectEnum ([MS-OSHARED] 2.2.1.2): OR_Content, "the object is displayed as an embedded object inside of a container" -- the one aspect every shape this writer produces actually shows.
const DVASPECT_CONTENT = 0x00000001;
// ExColorFollowEnum ([MS-PPT] 2.10.11): ExColor_FollowNone -- this writer states no colour-scheme relationship for an embedded object, the same "nothing this package tracks" default its rotation/inset properties leave unstated fields at.
const EX_COLOR_FOLLOW_NONE = 0x00000000;
const PROG_ID_ATOM_INSTANCE = 0x002;

// ExOleObjAtom's own 24-byte data past its rh -- see ole/embedded.ts's identical field-offset comment for the read-side mirror of this layout.
function writeExOleObjAtom(
  exObjId: number,
  persistIdRef: number,
  subType: number,
): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_ExternalOleObjectAtom,
    concatBytes(
      u32le(DVASPECT_CONTENT),
      u32le(EX_OLE_TYPE_EMBEDDED),
      u32le(exObjId),
      u32le(subType),
      u32le(persistIdRef),
      u32le(0), // unused
    ),
    { recVer: 0x1 },
  );
}

function writeExOleEmbedAtom(): Uint8Array<ArrayBuffer> {
  return writeAtom(
    RT_ExternalOleEmbedAtom,
    concatBytes(
      u32le(EX_COLOR_FOLLOW_NONE),
      new Uint8Array([0, 0, 0, 0]), // fCantLockServer, fNoSizeToServer, fIsTable, unused -- all false/ignored
    ),
  );
}

function writeProgIdAtom(progId: string): Uint8Array<ArrayBuffer> {
  return writeAtom(RT_CString, utf16le(progId), {
    recInstance: PROG_ID_ATOM_INSTANCE,
  });
}

// The ProgID this writer states for a nested document's own kind, and the ExOleObjSubTypeEnum value ([MS-PPT] 2.10.14) that ProgID implies -- both taken directly from that enumeration's own name-to-ProgID table, so the two never disagree. A kind with no real legacy-Office ProgID (formula, drawing, chart) writes no ProgIDAtom at all: it is optional, and inventing a ProgID no real producer would ever state is worse than a shape that carries none.
function progIdFor(
  objectKind: ContentEmbeddedObjectKind,
): { readonly progId: string; readonly subType: number } | undefined {
  switch (objectKind) {
    case "wordprocessing":
      return { progId: "Word.Document.8", subType: EX_OLE_SUBTYPE_WORD_DOC };
    case "spreadsheet":
      return { progId: "Excel.Sheet.8", subType: EX_OLE_SUBTYPE_EXCEL };
    case "presentation":
    case "formula":
    case "drawing":
    case "chart":
      return undefined;
  }
}

export interface WritableOleEmbed {
  readonly exObjId: number;
  readonly persistIdRef: number;
  readonly objectKind: ContentEmbeddedObjectKind;
}

function writeExOleEmbedContainer(
  embed: WritableOleEmbed,
): Uint8Array<ArrayBuffer> {
  const named = progIdFor(embed.objectKind);
  const children = [
    writeExOleEmbedAtom(),
    writeExOleObjAtom(
      embed.exObjId,
      embed.persistIdRef,
      named?.subType ?? EX_OLE_SUBTYPE_DEFAULT,
    ),
  ];
  if (named !== undefined) {
    children.push(writeProgIdAtom(named.progId));
  }
  return writeContainer(RT_ExternalOleEmbed, children);
}

// The document-wide ExObjListContainer, written only when at least one embedded object was actually recovered -- a presentation with none carries no external-object list at all, matching a real producer's own habit of omitting a list with nothing to state.
export function writeExObjListContainer(
  embeds: readonly WritableOleEmbed[],
): Uint8Array<ArrayBuffer> | undefined {
  if (embeds.length === 0) {
    return undefined;
  }
  const seed = Math.max(...embeds.map((embed) => embed.exObjId)) + 1;
  const exObjListAtom = writeAtom(RT_ExternalObjectListAtom, u32le(seed));
  return writeContainer(RT_ExternalObjectList, [
    exObjListAtom,
    ...embeds.map((embed) => writeExOleEmbedContainer(embed)),
  ]);
}

// A shape's own OfficeArtClientData carries this when it displays one of the document's external objects -- see ole/embedded.ts's readExObjIdRef for the read-side mirror.
function writeExObjRefAtom(exObjId: number): Uint8Array<ArrayBuffer> {
  return writeAtom(RT_ExternalObjectRefAtom, u32le(exObjId));
}

// A whole shape's own OfficeArtClientData record, ready to hand to shapes-write.ts's DrawingShape.clientData the same way master-write.ts's placeholderClientData already builds one for a PlaceholderAtom.
export function writeOleClientData(exObjId: number): Uint8Array<ArrayBuffer> {
  return writeContainer(OfficeArtClientData, [writeExObjRefAtom(exObjId)]);
}

// The persist object an embed's own persistIdRef names: always the uncompressed spelling (rh.recInstance 0x000), the raw [MS-CFB] bytes a serialiser port returned with no further framing.
export function writeExOleObjStg(
  storageBytes: Uint8Array<ArrayBuffer>,
): Uint8Array<ArrayBuffer> {
  return writeAtom(RT_ExternalOleObjectStg, storageBytes, {
    recInstance: 0x000,
  });
}
