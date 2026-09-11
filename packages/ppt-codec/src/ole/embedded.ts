import { inflate } from "byte-codec";
import { decodeUtf16Le } from "../stream/current-user";
import { PptFormatError } from "../errors";
import {
  type PptRecord,
  childRecords,
  findChild,
  readRecordAt,
} from "../record/tree";
import {
  RT_CString,
  RT_ExternalObjectList,
  RT_ExternalObjectRefAtom,
  RT_ExternalOleEmbed,
  RT_ExternalOleObjectAtom,
  RT_ExternalOleObjectStg,
} from "../record/types";

// The document-wide OLE-embedding linkage a slide's own shape reaches through: OfficeArtClientData -> ExObjRefAtom (exObjIdRef) -> this module's exObjId-keyed map -> ExOleObjAtom's own persistIdRef -> the persist directory -> an ExOleObjStg record whose bytes are a raw [MS-CFB] compound file (compressed with a decompressedSize prefix, or not), never a further OLE "Package"-stream wrapper the way an OOXML host embeds one -- confirmed directly against [MS-PPT] 2.10.34/2.10.35/2.10.36 rather than assumed from ooxml.js's own, differently-shaped precedent. [MS-PPT] External Objects overview: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/330c2672-79fe-468b-965e-52519e4895dc ExObjListContainer 2.10.1: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/3b997d4d-7951-4478-acc5-1c9adbc2627a ExOleEmbedContainer 2.10.27: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/c687090c-a359-4ffc-918e-415117e10229 ExOleObjAtom 2.10.12: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/a3517016-8e32-4585-9a42-adae02eea798

// [MS-ODRAW]-style bit layout ([MS-PPT] 2.13.24's own DataViewAspectEnum/ExOleObjTypeEnum/ExOleObjSubTypeEnum are opaque integers this package has no reason to decode further than "present" -- the shape's own picture already carries the visual aspect PowerPoint chose to display, and a decode port is the only consumer that would ever need the type/subType distinction).

export interface ExternalOleEmbed {
  readonly exObjId: number;
  readonly progId: string | undefined;
  readonly persistIdRef: number;
}

// ExOleObjAtom's own 24-byte data (past its 8-byte rh): drawAspect(4) type(4) exObjId(4) subType(4) persistIdRef(4) unused(4), each a plain little-endian field -- [MS-PPT] 2.10.12's own field table, quoted in this module's own top comment.
const EX_OLE_OBJ_ATOM_LEN = 24;

function readExOleObjAtom(
  record: PptRecord,
): Pick<ExternalOleEmbed, "exObjId" | "persistIdRef"> {
  if (record.data.length < EX_OLE_OBJ_ATOM_LEN) {
    throw new PptFormatError(
      `ExOleObjAtom at offset ${record.offset} carries ${record.data.length} bytes, fewer than the ${EX_OLE_OBJ_ATOM_LEN} its fields need`,
    );
  }
  const view = new DataView(
    record.data.buffer,
    record.data.byteOffset,
    record.data.byteLength,
  );
  return {
    exObjId: view.getUint32(8, true),
    persistIdRef: view.getUint32(16, true),
  };
}

// ProgIDAtom is one of three optional sibling RT_CString children an ExOleEmbedContainer may carry (menuNameAtom, progIdAtom, clipboardNameAtom, in that fixed order) -- told apart from one another only by rh.recInstance, since all three share RT_CString as their own recType. [MS-PPT] 2.10.28 ProgIDAtom: "rh.recInstance MUST be 0x002." https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/4bfdd228-254e-40ab-a497-0e0407079fd0
const PROG_ID_ATOM_INSTANCE = 0x002;

function readExOleEmbedContainer(
  container: PptRecord,
): ExternalOleEmbed | undefined {
  const children = childRecords(container);
  const objAtom = findChild(children, RT_ExternalOleObjectAtom);
  // A required child record missing from a real container is second-order structural damage to one embedded object, not to the host slide -- degrading this one entry to absent (readExternalOleEmbeds simply omits it) rather than throwing keeps a malformed embedding from failing the whole document read, the same tiered-read policy ooxml.js's own embedded-object recovery states for its analogous case.
  if (objAtom === undefined) {
    return undefined;
  }
  const progIdAtom = children.find(
    (child) =>
      child.header.recType === RT_CString &&
      child.header.recInstance === PROG_ID_ATOM_INSTANCE,
  );
  return {
    ...readExOleObjAtom(objAtom),
    progId:
      progIdAtom === undefined ? undefined : decodeUtf16Le(progIdAtom.data),
  };
}

// The document's own external-object list, resolved once per document and keyed by exObjId -- the identifier a slide shape's own ExObjRefAtom names. A document with no ExObjListContainer at all (no external objects of any kind) reads as an empty map rather than a special case its one caller has to branch on. Linked OLE objects (RT_ExternalOleLink) name an external file this package has no path to resolve independently of the host document, so they are left out of this map entirely -- a shape referencing one degrades exactly as a shape referencing nothing here does.
export function readExternalOleEmbeds(
  documentChildren: readonly PptRecord[],
): ReadonlyMap<number, ExternalOleEmbed> {
  const embeds = new Map<number, ExternalOleEmbed>();
  const objList = findChild(documentChildren, RT_ExternalObjectList);
  if (objList === undefined) {
    return embeds;
  }
  for (const child of childRecords(objList)) {
    if (child.header.recType !== RT_ExternalOleEmbed) {
      continue;
    }
    const embed = readExOleEmbedContainer(child);
    if (embed !== undefined) {
      embeds.set(embed.exObjId, embed);
    }
  }
  return embeds;
}

// A shape's own OfficeArtClientData carries an ExObjRefAtom naming which external object (by exObjId) it displays, when it displays one at all -- most client data is a PlaceholderAtom or nothing, so this returns undefined for every shape but the ones this module cares about. [MS-PPT] 2.7.7 ExObjRefAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/d6e17fee-7d53-453f-962b-b671a4f8869f
export function readExObjIdRef(clientData: PptRecord): number | undefined {
  const record = findChild(childRecords(clientData), RT_ExternalObjectRefAtom);
  if (record === undefined || record.data.length < 4) {
    return undefined;
  }
  const view = new DataView(
    record.data.buffer,
    record.data.byteOffset,
    record.data.byteLength,
  );
  return view.getUint32(0, true);
}

// rh.recInstance distinguishes ExOleObjStg's two spellings ([MS-PPT] 2.10.34): 0x000 is a raw, uncompressed storage; 0x001 is zlib-compressed ([RFC1950]) behind a 4-byte decompressedSize. Either way the recovered bytes are a [MS-CFB] compound file with no further wrapper -- not, as an OOXML host's own OLE embedding needs, a further "Package" stream inside it (see this module's own top comment).
const EX_OLE_OBJ_STG_INSTANCE_COMPRESSED = 0x001;

// Resolves a persistIdRef to the [MS-CFB] compound-file bytes it names, soft-failing to undefined for every unresolvable case (a missing persist entry, a storage record of the wrong type, corrupt compressed data) rather than throwing: an OLE object this package cannot recover its storage for degrades to whatever the shape's own picture already renders, the identical soft degrade resolvePersistObject's own doc comment contrasts itself against -- this function is deliberately the soft counterpart that helper is not.
export function resolveOleObjectStorage(
  streamBytes: Uint8Array<ArrayBuffer>,
  directory: ReadonlyMap<number, number>,
  persistIdRef: number,
): Uint8Array<ArrayBuffer> | undefined {
  const offset = directory.get(persistIdRef);
  if (offset === undefined) {
    return undefined;
  }
  let record: PptRecord;
  try {
    record = readRecordAt(streamBytes, offset);
  } catch {
    return undefined;
  }
  if (record.header.recType !== RT_ExternalOleObjectStg) {
    return undefined;
  }
  if (record.header.recInstance !== EX_OLE_OBJ_STG_INSTANCE_COMPRESSED) {
    return record.data;
  }
  if (record.data.length < 4) {
    return undefined;
  }
  try {
    return inflate(record.data.subarray(4));
  } catch {
    return undefined;
  }
}
