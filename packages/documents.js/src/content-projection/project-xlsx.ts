import {
  type ContentProjection,
  type ProjectionOptions,
  type ProjectedCell,
  ProjectionBuilder,
  SHARED_FORMULA,
  TextContainers,
} from "./projection";
import {
  OFFICE_RELATIONSHIPS,
  PACKAGE_RELATIONSHIPS,
  SPREADSHEETML,
  THREADED_COMMENTS,
  type NamespaceRole,
} from "./ooxml-names";
import { MemoryBudget } from "./memory-budget";
import {
  listOpcParts,
  readContentTypes,
  type OpcPartEntry,
} from "./opc-package";
import { xlsxPartRole, type XlsxPartKind } from "./part-roles";
import { digestMediaPart, scanPart, type PartScanContext } from "./part-scan";
import { textPartHandler } from "./project-docx";
import type { ScannedElement, XmlScanHandler } from "./xml-scan";

const LETTERS_IN_ALPHABET = 26;
const FIRST_LETTER_CODE = "A".codePointAt(0) ?? 0;
const CELL_REFERENCE = /^([A-Z]+)([0-9]+)$/;

/** The 1-based column number of column letters: A is 1, Z is 26, AA is 27. */
function columnNumber(letters: string): number {
  let number = 0;
  for (const letter of letters) {
    number =
      number * LETTERS_IN_ALPHABET +
      ((letter.codePointAt(0) ?? FIRST_LETTER_CODE) - FIRST_LETTER_CODE + 1);
  }
  return number;
}

/** The column letters of a 1-based column number: the inverse of `columnNumber`. */
function columnLetters(number: number): string {
  let letters = "";
  let remaining = number;
  while (remaining > 0) {
    const digit = (remaining - 1) % LETTERS_IN_ALPHABET;
    letters = String.fromCodePoint(FIRST_LETTER_CODE + digit) + letters;
    remaining = Math.floor((remaining - 1) / LETTERS_IN_ALPHABET);
  }
  return letters;
}

function attributeOf(
  element: ScannedElement,
  local: string,
  namespace?: NamespaceRole,
): string | undefined {
  return element.attributes.find(
    (attribute) =>
      attribute.local === local &&
      (namespace === undefined
        ? attribute.uri === ""
        : namespace.has(attribute.uri)),
  )?.value;
}

const SHEET_FAMILIES: ReadonlySet<string> = new Set([
  "c",
  "f",
  "row",
  "mergeCell",
  "dataValidation",
  "conditionalFormatting",
  "hyperlink",
  "col",
  "drawing",
  "legacyDrawing",
]);

/** A number cell's value as the number it denotes, so `1.0` and `1` agree and so do exponent spellings; any other text is kept as written. */
function normalisedNumber(text: string): string {
  const trimmed = text.trim();
  const parsed = Number(trimmed);
  return trimmed !== "" && Number.isFinite(parsed) ? String(parsed) : trimmed;
}

interface OpenCell {
  readonly reference: string;
  readonly type: string | undefined;
  value: string;
  formula: string;
  sharedFormula: boolean;
  hasFormula: boolean;
  inline: string;
}

function resolvedCell(
  cell: OpenCell,
  sharedStrings: readonly string[],
): ProjectedCell | undefined {
  let value: string;
  switch (cell.type) {
    case "s":
      value =
        sharedStrings[Number(cell.value)] ?? "\u0000missing-shared-string";
      break;
    case "inlineStr":
      value = cell.inline;
      break;
    case "b":
      value = cell.value.trim() === "1" ? "TRUE" : "FALSE";
      break;
    case "str":
    case "e":
    case "d":
      value = cell.value;
      break;
    default:
      value = normalisedNumber(cell.value);
      break;
  }
  let formula: string | undefined;
  if (cell.hasFormula) {
    formula =
      cell.sharedFormula && cell.formula === "" ? SHARED_FORMULA : cell.formula;
  }
  if (value === "" && formula === undefined) {
    return undefined;
  }
  return { value, formula };
}

/**
 * Walks one worksheet and records each non-empty cell under `sheetIndex!reference`, its value resolved through the shared strings and its formula text beside it. A row or cell with no `r` takes the position the previous one implies (the next row, the next column), as the specification defines. Phonetic runs (`rPh`) are not part of a string's text.
 */
function sheetHandler(
  scratch: ProjectionBuilder,
  sheetIndex: number,
  sharedStrings: readonly string[],
): XmlScanHandler {
  let row = 0;
  let previousColumn = 0;
  let cell: OpenCell | undefined;
  let inValue = false;
  let inFormula = false;
  let inInline = false;
  let inText = false;
  let phoneticDepth = 0;

  return {
    startElement(element) {
      if (!SPREADSHEETML.has(element.uri)) {
        return;
      }
      if (SHEET_FAMILIES.has(element.local)) {
        scratch.countFamily("sheets", element.local);
      }
      switch (element.local) {
        case "row": {
          const declared = Number(attributeOf(element, "r"));
          row = Number.isInteger(declared) && declared > 0 ? declared : row + 1;
          previousColumn = 0;
          break;
        }
        case "c": {
          const declared = attributeOf(element, "r");
          const reference =
            declared ?? `${columnLetters(previousColumn + 1)}${row}`;
          const parts = CELL_REFERENCE.exec(reference);
          previousColumn =
            parts?.[1] === undefined
              ? previousColumn + 1
              : columnNumber(parts[1]);
          cell = {
            reference,
            type: attributeOf(element, "t"),
            value: "",
            formula: "",
            sharedFormula: false,
            hasFormula: false,
            inline: "",
          };
          break;
        }
        case "v":
          inValue = cell !== undefined;
          break;
        case "f":
          if (cell !== undefined) {
            inFormula = true;
            cell.hasFormula = true;
            cell.sharedFormula = attributeOf(element, "t") === "shared";
          }
          break;
        case "is":
          inInline = cell !== undefined;
          break;
        case "rPh":
          phoneticDepth += 1;
          break;
        case "t":
          inText = inInline && phoneticDepth === 0;
          break;
        default:
          break;
      }
    },
    text(value) {
      if (cell === undefined) {
        return;
      }
      if (inValue) {
        cell.value += value;
      } else if (inFormula) {
        cell.formula += value;
      } else if (inText) {
        cell.inline += value;
      }
    },
    endElement(name) {
      if (!SPREADSHEETML.has(name.uri)) {
        return;
      }
      switch (name.local) {
        case "c": {
          const projected =
            cell === undefined ? undefined : resolvedCell(cell, sharedStrings);
          if (cell !== undefined && projected !== undefined) {
            scratch.setCell(`${sheetIndex}!${cell.reference}`, projected);
          }
          cell = undefined;
          break;
        }
        case "v":
          inValue = false;
          break;
        case "f":
          inFormula = false;
          break;
        case "is":
          inInline = false;
          break;
        case "rPh":
          phoneticDepth -= 1;
          break;
        case "t":
          inText = false;
          break;
        default:
          break;
      }
    },
  };
}

/** Walks the shared strings part: each `si`'s words are counted under `shared-strings`, and its full text (phonetic runs excluded) is appended to `strings` for cells to resolve against. */
function sharedStringsHandler(
  scratch: ProjectionBuilder,
  strings: string[],
): XmlScanHandler {
  const containers = new TextContainers(scratch);
  let phoneticDepth = 0;
  let inText = false;
  return {
    startElement(element) {
      if (!SPREADSHEETML.has(element.uri)) {
        return;
      }
      if (element.local === "si") {
        scratch.countFamily("shared-strings", "si");
        containers.open("shared-strings");
      } else if (element.local === "rPh") {
        phoneticDepth += 1;
      } else if (element.local === "t") {
        inText = phoneticDepth === 0;
      }
    },
    text(value) {
      if (inText) {
        containers.append(value);
      }
    },
    endElement(name) {
      if (!SPREADSHEETML.has(name.uri)) {
        return;
      }
      if (name.local === "si") {
        strings.push(containers.close());
      } else if (name.local === "rPh") {
        phoneticDepth -= 1;
      } else if (name.local === "t") {
        inText = false;
      }
    },
  };
}

/** Walks a legacy comments part: each `comment`'s text is one container, phonetic runs excluded. */
function legacyCommentsHandler(scratch: ProjectionBuilder): XmlScanHandler {
  const containers = new TextContainers(scratch);
  let phoneticDepth = 0;
  let inText = false;
  return {
    startElement(element) {
      if (!SPREADSHEETML.has(element.uri)) {
        return;
      }
      if (element.local === "comment") {
        scratch.countFamily("comments", "comment");
        containers.open("comments");
      } else if (element.local === "rPh") {
        phoneticDepth += 1;
      } else if (element.local === "t") {
        inText = phoneticDepth === 0;
      }
    },
    text(value) {
      if (inText) {
        containers.append(value);
      }
    },
    endElement(name) {
      if (!SPREADSHEETML.has(name.uri)) {
        return;
      }
      if (name.local === "comment") {
        containers.close();
      } else if (name.local === "rPh") {
        phoneticDepth -= 1;
      } else if (name.local === "t") {
        inText = false;
      }
    },
  };
}

/** Walks a threaded comments part: each `threadedComment`'s `text` element is one container. */
function threadedCommentsHandler(scratch: ProjectionBuilder): XmlScanHandler {
  const containers = new TextContainers(scratch);
  return {
    startElement(element) {
      if (!THREADED_COMMENTS.has(element.uri)) {
        return;
      }
      if (element.local === "threadedComment") {
        scratch.countFamily("comments", "threadedComment");
      } else if (element.local === "text") {
        containers.open("comments");
      }
    },
    text(value) {
      containers.append(value);
    },
    endElement(name) {
      if (THREADED_COMMENTS.has(name.uri) && name.local === "text") {
        containers.close();
      }
    },
  };
}

interface WorkbookSheet {
  readonly name: string;
  readonly relationshipId: string | undefined;
}

interface WorkbookInfo {
  readonly sheets: WorkbookSheet[];
}

/** Walks the workbook part: the sheets in order, and each name defined. Sheet names and defined names are units of their own categories. */
function workbookHandler(
  scratch: ProjectionBuilder,
  info: WorkbookInfo,
): XmlScanHandler {
  let definedName: { name: string; scope: string } | undefined;
  return {
    startElement(element) {
      if (!SPREADSHEETML.has(element.uri)) {
        return;
      }
      if (element.local === "sheet") {
        scratch.countFamily("workbook", "sheet");
        const name = attributeOf(element, "name") ?? "";
        scratch.addUnit("sheet-names", name);
        info.sheets.push({
          name,
          relationshipId: attributeOf(element, "id", OFFICE_RELATIONSHIPS),
        });
      } else if (element.local === "definedName") {
        scratch.countFamily("workbook", "definedName");
        definedName = {
          name: attributeOf(element, "name") ?? "",
          scope: attributeOf(element, "localSheetId") ?? "",
        };
      }
    },
    endElement(name) {
      if (
        SPREADSHEETML.has(name.uri) &&
        name.local === "definedName" &&
        definedName !== undefined
      ) {
        scratch.addUnit(
          "defined-names",
          `${definedName.scope}:${definedName.name}`,
        );
        definedName = undefined;
      }
    },
  };
}

/** Resolves a relationship target against the directory of the part that owns the relationships. An absolute target is relative to the package root. */
function resolveTarget(ownerPart: string, target: string): string {
  const segments = target.startsWith("/")
    ? []
    : ownerPart.split("/").slice(0, -1);
  for (const segment of target.split("/")) {
    if (segment === "..") {
      segments.pop();
    } else if (segment !== "." && segment !== "") {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

function relationshipsPartOf(ownerPart: string): string {
  const slash = ownerPart.lastIndexOf("/");
  return `${ownerPart.slice(0, slash + 1)}_rels/${ownerPart.slice(slash + 1)}.rels`;
}

function relationshipHandler(targets: Map<string, string>): XmlScanHandler {
  return {
    startElement(element) {
      if (
        !PACKAGE_RELATIONSHIPS.has(element.uri) ||
        element.local !== "Relationship" ||
        attributeOf(element, "TargetMode") === "External"
      ) {
        return;
      }
      const id = attributeOf(element, "Id");
      const target = attributeOf(element, "Target");
      if (id !== undefined && target !== undefined) {
        targets.set(id, target);
      }
    },
  };
}

type TextPartKind = Exclude<
  XlsxPartKind,
  "workbook" | "worksheet" | "shared-strings"
>;

const TEXT_PART_KINDS: readonly TextPartKind[] = [
  "comments",
  "threaded-comments",
  "drawings",
  "charts",
];

function handlerFor(
  kind: TextPartKind,
  scratch: ProjectionBuilder,
): XmlScanHandler {
  if (kind === "comments") {
    return legacyCommentsHandler(scratch);
  }
  if (kind === "threaded-comments") {
    return threadedCommentsHandler(scratch);
  }
  return textPartHandler(scratch, kind === "drawings" ? "drawings" : "charts");
}

/** Reads the sheets the workbook lists, in its order, and returns each sheet's part name. */
function sheetParts(
  context: PartScanContext,
  entries: readonly OpcPartEntry[],
  workbook: OpcPartEntry,
): (string | undefined)[] {
  const info: WorkbookInfo = { sheets: [] };
  if (
    !scanPart(context, workbook, (scratch) => workbookHandler(scratch, info))
  ) {
    return [];
  }
  const targets = new Map<string, string>();
  const relationships = entries.find(
    (entry) => entry.name === relationshipsPartOf(workbook.name),
  );
  if (relationships !== undefined) {
    scanPart(context, relationships, () => relationshipHandler(targets));
  }
  return info.sheets.map((sheet) => {
    const target =
      sheet.relationshipId === undefined
        ? undefined
        : targets.get(sheet.relationshipId);
    return target === undefined
      ? undefined
      : resolveTarget(workbook.name, target);
  });
}

/**
 * Projects an xlsx (or xlsm) package onto what it says: every non-empty cell keyed by sheet position and resolved reference with its value and formula, the sheet names and defined names, words in shared strings, comments (legacy and threaded), drawings and charts, an element census, and the images and embedded objects by content hash. Cells are keyed by the sheet's position in the workbook, not its name, so a changed name is reported as a name difference and does not make every cell on the sheet look lost.
 *
 * The package is read one part at a time through a streaming scanner, so memory is bounded by the largest part and the units kept. A part the memory budget does not cover, or that is not well-formed XML, is listed in `skippedParts` and contributes nothing. Defined-name formulas, table definitions and pivot data are not compared; pivot, external-link, macro and similar parts are listed in `unmodelledParts`.
 */
export async function projectXlsxContent(
  bytes: Uint8Array,
  options: ProjectionOptions,
): Promise<ContentProjection> {
  const builder = new ProjectionBuilder("xlsx");
  const context: PartScanContext = {
    bytes,
    builder,
    budget: new MemoryBudget(options.memoryBudgetBytes),
  };
  const types = readContentTypes(bytes);
  const entries = listOpcParts(bytes);
  const byKind = new Map<XlsxPartKind, OpcPartEntry[]>();
  for (const entry of entries) {
    const role = xlsxPartRole(entry.name, types.typeOf(entry.name));
    if (role.kind === "xlsx") {
      byKind.set(role.part, [...(byKind.get(role.part) ?? []), entry]);
    } else if (role.kind === "media") {
      await digestMediaPart(context, entry, role.media);
    } else if (role.kind === "unmodelled") {
      builder.addUnmodelled(entry.name);
    }
  }

  const sharedStrings: string[] = [];
  for (const entry of byKind.get("shared-strings") ?? []) {
    scanPart(context, entry, (scratch) =>
      sharedStringsHandler(scratch, sharedStrings),
    );
  }

  const workbook = byKind.get("workbook")?.[0];
  if (workbook !== undefined) {
    const worksheets = byKind.get("worksheet") ?? [];
    sheetParts(context, entries, workbook).forEach((partName, sheetIndex) => {
      const sheet = worksheets.find((entry) => entry.name === partName);
      if (sheet !== undefined) {
        scanPart(context, sheet, (scratch) =>
          sheetHandler(scratch, sheetIndex, sharedStrings),
        );
      }
    });
  }

  for (const kind of TEXT_PART_KINDS) {
    for (const entry of byKind.get(kind) ?? []) {
      scanPart(context, entry, (scratch) => handlerFor(kind, scratch));
    }
  }
  return builder.build();
}
