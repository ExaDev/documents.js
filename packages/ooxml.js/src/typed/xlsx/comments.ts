import type { ContentSheetCellComment } from "document-schema.js";
import { parseCellReference } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlElement } from "../../model/node";
import {
  attr,
  childrenWithTag,
  elementsWithTag,
  resolveRelationships,
  rootElement,
  textContent,
} from "../util";

// xlsx's two cell-comment mechanisms, read into ContentSheetCell's own comment field. Both store the comment text in parts SEPARATE from the worksheet part, addressed not by part name but through the worksheet part's own relationships -- the same "never trust filename order" rule resolveSheetEntries (typed/xlsx/content.ts) applies to the sheets themselves:
//  - Legacy notes (Excel 97-2016, still written today for down-level readers): one xl/comments{N}.xml part per sheet, carrying <commentList><comment ref authorId><text> entries. The note's on-screen shape lives in a separate VML drawing part (the sheet's <legacyDrawing>); that part holds geometry only, never comment text, so it is not read here.
//  - Threaded comments (Office 365, the Microsoft extension documented in [MS-XLSX] "Threaded Comments"): one xl/threadedComments/threadedComment{N}.xml part per sheet, whose threadedComment elements form one thread per cell via parentId and name their authors through a shared xl/persons/person{N}.xml part.
// A cell carrying both (Excel 365 writes a legacy copy of every thread for down-level readers) reads as the THREAD: the strictly richer of the two -- replies, timestamps -- and the one Excel itself displays when both are present. The [MS-XLSX] vocabulary has one genuine older spelling in real files (attributes dCreation/displayName/parent/dId instead of dT/personId/parentId/id); producers of both eras exist, so both spellings are read.

const REL_COMMENTS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments";
const REL_THREADED_COMMENTS =
  "http://schemas.microsoft.com/office/2017/10/relationships/threadedComment";
const REL_PERSON =
  "http://schemas.microsoft.com/office/2017/10/relationships/person";

// A comment plus the 0-based cell position it is anchored to, so the caller can attach it to the matching ContentSheetCell (or materialise one) without re-parsing a reference.
export interface SheetCellComment {
  row: number;
  column: number;
  comment: ContentSheetCellComment;
}

// The threaded-comments vocabulary is a Microsoft extension, not ECMA-376, so unlike every ECMA-376 part this package reads -- whose producers all bind the schema namespace as the DEFAULT namespace, leaving element names unprefixed -- these elements arrive under whatever prefix the producer chose: Excel writes the part unprefixed, other producers bind one (conventionally tc:). The local name, the part after the last ':', is the only spelling-agnostic address for these elements.
function localName(tag: string): string {
  const colon = tag.lastIndexOf(":");
  return colon === -1 ? tag : tag.slice(colon + 1);
}

function childrenWithLocalName(
  element: XmlElement,
  local: string,
): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of element.children) {
    if (child.type === "element" && localName(child.tag) === local) {
      out.push(child);
    }
  }
  return out;
}

// ST_Guid as written in these parts is braced and upper case, but the brace spelling varies across producers, so both sides of every guid comparison (personId -> person/@id) go through this normaliser.
function normalizeGuid(value: string): string {
  return value.replaceAll("{", "").replaceAll("}", "").toLowerCase();
}

// Package-relative targets of every relationship of one type from one subject part, already resolved by resolveRelationships (external targets never carry these comment types, whose parts are always internal).
function relatedPartPaths(
  pkg: Package,
  partPath: string,
  relType: string,
): string[] {
  const paths: string[] = [];
  for (const rel of resolveRelationships(pkg, partPath).values()) {
    if (rel.type === relType) {
      paths.push(rel.target);
    }
  }
  return paths;
}

// --- legacy xl/comments{N}.xml ----------------------------------------------------------------------------------

// CT_Comment's <text> holds either a rich-text run sequence (<r><rPr/><t>...</t></r>..., what Excel and LibreOffice write) or the plain string itself (what openpyxl writes): the <t>-concatenation covers the run shape, and its own character content covers the plain one when no <t> exists.
function readLegacyCommentText(text: XmlElement): string {
  let value = "";
  for (const t of elementsWithTag(text.children, "t")) {
    value += textContent(t);
  }
  return value === "" ? textContent(text) : value;
}

// Legacy notes have no replies and no timestamp of their own (CT_Comment carries only ref and authorId), so the entry holds text plus the author the authors list's own authorId index names.
function readLegacyComments(
  pkg: Package,
  sheetPath: string,
  into: Map<string, SheetCellComment>,
): void {
  for (const path of relatedPartPaths(pkg, sheetPath, REL_COMMENTS)) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const authorsEl = childrenWithTag(root, "authors")[0];
    const authors =
      authorsEl === undefined
        ? []
        : childrenWithTag(authorsEl, "author").map(textContent);
    const commentList = childrenWithTag(root, "commentList")[0];
    if (commentList === undefined) {
      continue;
    }
    for (const comment of childrenWithTag(commentList, "comment")) {
      const ref = attr(comment, "ref");
      const position = ref === undefined ? undefined : parseCellReference(ref);
      const textEl = childrenWithTag(comment, "text")[0];
      if (position === undefined || textEl === undefined) {
        continue;
      }
      const entry: ContentSheetCellComment = {
        text: readLegacyCommentText(textEl),
      };
      const authorIdRaw = attr(comment, "authorId");
      const authorIndex =
        authorIdRaw === undefined
          ? undefined
          : Number.parseInt(authorIdRaw, 10);
      const author =
        authorIndex === undefined ? undefined : authors[authorIndex];
      if (author !== undefined) {
        entry.author = author;
      }
      into.set(`${position.row}:${position.column}`, {
        row: position.row,
        column: position.column,
        comment: entry,
      });
    }
  }
}

// --- xl/threadedComments/threadedComment{N}.xml and xl/persons/person{N}.xml ([MS-XLSX]) -------------------------

interface ThreadedCommentEntry {
  row: number;
  column: number;
  text: string;
  author?: string;
  createdAt?: string;
  // Present exactly when this entry is a reply; ContentSheetCellComment's replies are flat, so the value itself is never needed beyond that presence test.
  parentId?: string;
}

function readPersons(pkg: Package, sheetPath: string): Map<string, string> {
  const persons = new Map<string, string>();
  for (const path of relatedPartPaths(pkg, sheetPath, REL_PERSON)) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    for (const person of childrenWithLocalName(root, "person")) {
      const id = attr(person, "id");
      const displayName = attr(person, "displayName");
      if (id !== undefined && displayName !== undefined) {
        persons.set(normalizeGuid(id), displayName);
      }
    }
  }
  return persons;
}

// dT is an xsd:dateTime carried verbatim (ContentSheetCellCommentSchema's own contract: createdAt keeps the source format's spelling and precision); dCreation is the older epoch-milliseconds spelling, which has no ISO spelling to keep and is converted. displayName is the older inline author spelling; the current vocabulary names authors only by personId, resolved through the persons part.
function readThreadedAuthor(
  element: XmlElement,
  persons: ReadonlyMap<string, string>,
): string | undefined {
  const displayName = attr(element, "displayName");
  if (displayName !== undefined) {
    return displayName;
  }
  const personId = attr(element, "personId");
  return personId === undefined
    ? undefined
    : persons.get(normalizeGuid(personId));
}

function readThreadedCreatedAt(element: XmlElement): string | undefined {
  const dT = attr(element, "dT");
  if (dT !== undefined) {
    return dT;
  }
  const dCreation = attr(element, "dCreation");
  if (dCreation === undefined) {
    return undefined;
  }
  const ms = Number(dCreation);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

// One thread per cell: the entry carrying no parentId is the thread's root, every other entry for the same cell is one of its replies in document order -- the flat one-level shape ContentSheetCellComment itself holds, regardless of whether the file's parentId chain nests replies under replies. A group whose every entry claims a parent (a producer bug, or a parent trimmed from the part) still keeps its content: the first entry becomes the root, matching how every real producer writes a thread -- contiguously, root first.
function readThreadedComments(
  pkg: Package,
  sheetPath: string,
  into: Map<string, SheetCellComment>,
): void {
  const partPaths = relatedPartPaths(pkg, sheetPath, REL_THREADED_COMMENTS);
  if (partPaths.length === 0) {
    return;
  }
  const persons = readPersons(pkg, sheetPath);
  for (const path of partPaths) {
    const root = rootElement(pkg.parts[path]);
    if (root === undefined) {
      continue;
    }
    const groups = new Map<string, ThreadedCommentEntry[]>();
    for (const element of childrenWithLocalName(root, "threadedComment")) {
      const ref = attr(element, "ref");
      const position = ref === undefined ? undefined : parseCellReference(ref);
      const textEl = childrenWithLocalName(element, "text")[0];
      if (position === undefined || textEl === undefined) {
        continue;
      }
      const entry: ThreadedCommentEntry = {
        row: position.row,
        column: position.column,
        text: textContent(textEl),
      };
      const author = readThreadedAuthor(element, persons);
      if (author !== undefined) {
        entry.author = author;
      }
      const createdAt = readThreadedCreatedAt(element);
      if (createdAt !== undefined) {
        entry.createdAt = createdAt;
      }
      const parentId = attr(element, "parentId") ?? attr(element, "parent");
      if (parentId !== undefined) {
        entry.parentId = parentId;
      }
      const key = `${position.row}:${position.column}`;
      const group = groups.get(key);
      if (group === undefined) {
        groups.set(key, [entry]);
      } else {
        group.push(entry);
      }
    }
    for (const [key, group] of groups) {
      // group holds at least one entry by construction; the find-or-first fallback covers a group whose every entry claims a parent.
      const rootEntry =
        group.find((entry) => entry.parentId === undefined) ?? group.at(0);
      if (rootEntry === undefined) {
        continue;
      }
      const comment: ContentSheetCellComment = { text: rootEntry.text };
      if (rootEntry.author !== undefined) {
        comment.author = rootEntry.author;
      }
      if (rootEntry.createdAt !== undefined) {
        comment.createdAt = rootEntry.createdAt;
      }
      const replies = group.filter((entry) => entry !== rootEntry);
      if (replies.length > 0) {
        comment.replies = replies.map((reply) => {
          const answer: { text: string; author?: string } = {
            text: reply.text,
          };
          if (reply.author !== undefined) {
            answer.author = reply.author;
          }
          return answer;
        });
      }
      into.set(key, { row: rootEntry.row, column: rootEntry.column, comment });
    }
  }
}

// Every comment of one worksheet, at most one per cell, keyed `${row}:${column}` -- legacy notes first, threads overwriting them where a cell carries both.
export function readSheetCellComments(
  pkg: Package,
  sheetPath: string,
): Map<string, SheetCellComment> {
  const comments = new Map<string, SheetCellComment>();
  readLegacyComments(pkg, sheetPath, comments);
  readThreadedComments(pkg, sheetPath, comments);
  return comments;
}
