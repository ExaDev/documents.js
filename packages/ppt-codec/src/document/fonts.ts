import { type PptRecord, childRecords, findChild } from "../record/tree";
import { RT_FontCollection, RT_FontEntityAtom } from "../record/types";

// The document's font collection, resolved to plain typeface names. A character run names its font as a FontIndexRef -- a zero-based index into this collection -- rather than by name, so nothing downstream can report a typeface without this list. [MS-PPT] FontCollectionContainer: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/88da04bf-6838-4f87-9a87-adf067543837 [MS-PPT] FontEntityAtom: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/b5946b70-2fbc-4f7b-a119-b31fcbeb1794 [MS-PPT] FontIndexRef: https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/75b7196f-2d27-4aef-b841-5695fe584140

// [MS-PPT] FontEntityAtom: lfFaceName is a fixed 64-byte field holding at most 32 UTF-16 characters including its terminating null, so the tail past the name is padding rather than content.
const FACE_NAME_BYTES = 64;

function readFaceName(record: PptRecord): string | undefined {
  if (record.data.length < FACE_NAME_BYTES) {
    return undefined;
  }
  const view = new DataView(
    record.data.buffer,
    record.data.byteOffset,
    record.data.byteLength,
  );
  let name = "";
  for (let at = 0; at < FACE_NAME_BYTES; at += 2) {
    const unit = view.getUint16(at, true);
    if (unit === 0) {
      break;
    }
    name += String.fromCharCode(unit);
  }
  return name;
}

// Every typeface name in the document's environment, in collection order -- the order a FontIndexRef indexes. A document with no font collection yields an empty list rather than a failure: the collection is an optional field of the environment, and text can name no font at all.
export function readFontNames(environment: PptRecord): string[] {
  const collection = findChild(childRecords(environment), RT_FontCollection);
  if (collection === undefined) {
    return [];
  }
  const names: string[] = [];
  for (const entry of childRecords(collection)) {
    if (entry.header.recType !== RT_FontEntityAtom) {
      continue;
    }
    const name = readFaceName(entry);
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}
