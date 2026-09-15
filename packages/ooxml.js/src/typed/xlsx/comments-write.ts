import type { ContentSheet, ContentSheetCellComment } from "document-schema.js";
import { cellReference } from "document-schema.js";
import type { XmlElement } from "../../model/node";
import { el, txt } from "../../xml/fragment";
import { encodeXmlText } from "../../xml/entities";

// This writer emits ONLY the [MS-XLSX] "Threaded Comments" extension (xl/threadedComments/threadedComment{N}.xml), never legacy xl/comments{N}.xml notes -- the read side's own readSheetCellComments (./comments.ts) reads a cell carrying both as the thread, the strictly richer of the two, and a legacy note structurally cannot carry replies or a timestamp at all (CT_Comment has neither), so it could only ever be a lossy encoding of ContentSheetCellCommentSchema's own full shape. Threading through this one mechanism keeps every field -- text, author, createdAt, replies -- round-tripping through this package's own reader without a second, narrower write path to keep in sync.
//
// Each thread's own author is written via the threadedComment element's own `displayName` attribute rather than a personId cross-referencing a separate xl/persons/person.xml part -- readThreadedAuthor (./comments.ts) checks displayName FIRST, before ever resolving personId, so this is read back correctly without needing the persons part, the GUID bookkeeping it requires, or the extra relationship and Content_Types entry that would come with it. displayName is the OLDER of the two spellings [MS-XLSX] itself defines (real modern Excel prefers personId+persons.xml for its own author-identity UI), not a workaround -- just the simpler of two spec-legitimate encodings of the same author name, which is all this package's own fidelity bar asks for.

// [MS-XLSX] "Threaded Comments" part namespace -- the threadedComments PART's own XML vocabulary, distinct from the relationship-TYPE URI (.../2017/10/relationships/threadedComment) typed/xlsx/comments.ts already uses to address the part itself.
const THREADED_COMMENTS_NS =
  "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";

// A deterministic, sequential ST_Guid-shaped id. A real producer mints a genuine random GUID per thread and reply; nothing this writer or its own reader (readThreadedComments' parentId matching) needs beyond uniqueness within the part and a reply's parentId correctly naming its own thread's root id, so a zero-padded counter in the same braced-hex shape is exactly as correct while keeping this writer's output reproducible. Exported purely for direct unit coverage of its own exact hex formatting.
export function threadedCommentId(counter: number): string {
  return `{00000000-0000-0000-0000-${counter.toString(16).padStart(12, "0").toUpperCase()}}`;
}

function buildThreadedCommentElement(
  ref: string,
  id: string,
  entry: { readonly text: string; readonly author?: string | undefined },
  createdAt: string | undefined,
  parentId: string | undefined,
): XmlElement {
  const attrs: Record<string, string> = { ref, id };
  if (parentId !== undefined) {
    attrs.parentId = parentId;
  }
  if (createdAt !== undefined) {
    attrs.dT = encodeXmlText(createdAt);
  }
  if (entry.author !== undefined) {
    attrs.displayName = encodeXmlText(entry.author);
  }
  return el("threadedComment", attrs, [
    el("text", {}, [txt(encodeXmlText(entry.text))]),
  ]);
}

// One <threadedComment> per commented cell's own root, immediately followed by one per reply (each pointing back to its own root via parentId) -- root-then-replies, contiguous, no interleaving between threads, exactly the document-order shape readThreadedComments (./comments.ts) expects when it falls back to "first entry is the root" for a group where every entry claims a parent.
export function buildThreadedCommentElements(
  sheet: ContentSheet,
): XmlElement[] {
  const elements: XmlElement[] = [];
  let counter = 0;
  for (const cell of sheet.cells) {
    const comment: ContentSheetCellComment | undefined = cell.comment;
    if (comment === undefined) {
      continue;
    }
    const ref = cellReference(cell.row, cell.column);
    const rootId = threadedCommentId(counter);
    counter += 1;
    elements.push(
      buildThreadedCommentElement(
        ref,
        rootId,
        comment,
        comment.createdAt,
        undefined,
      ),
    );
    for (const reply of comment.replies ?? []) {
      const replyId = threadedCommentId(counter);
      counter += 1;
      elements.push(
        buildThreadedCommentElement(ref, replyId, reply, undefined, rootId),
      );
    }
  }
  return elements;
}

export function sheetHasComments(sheet: ContentSheet): boolean {
  return sheet.cells.some((cell) => cell.comment !== undefined);
}

// The root <ThreadedComments> element for one sheet's own xl/threadedComments/threadedComment{N}.xml part -- callers gate on sheetHasComments first, since a sheet with nothing to write gets no part, no worksheet relationship, and no Content_Types override at all.
export function buildThreadedCommentsRoot(sheet: ContentSheet): XmlElement {
  return el(
    "ThreadedComments",
    { xmlns: THREADED_COMMENTS_NS },
    buildThreadedCommentElements(sheet),
  );
}
