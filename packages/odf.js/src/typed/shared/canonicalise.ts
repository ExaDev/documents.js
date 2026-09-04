import type {
  Color,
  ContentImageBlock,
  ContentParagraph,
  ContentTable,
  ContentTableCell,
  ContentRun,
  LayoutMetadata,
} from "document-schema.js";
import { colorToRgbHex, rgbHexToColor } from "document-schema.js";
import { segmentOdfParagraphRuns } from "./paragraph";

// The write-side canonical form every ODF content writer in this package states its own round-trip law against: what reading a WRITTEN document back actually produces, for the pieces of the content model this package's writers already share verbatim (a paragraph's runs and formatting, a table's cells, an image block) -- factored out once typed/odt/write.ts's own normaliseOdtContent first stated it, now reused by typed/odp/write.ts (a shape's own text paragraphs, and a table nested inside a shape) rather than restated per format. See typed/odt/write.ts's own top-of-file note for the fuller philosophy this canonical-form discipline follows; this module owns only the pieces genuinely identical across every writer, not a format's own section/slide-level structure.

function unsupportedContent(what: string, where: string): Error {
  return new Error(
    `${where} carries ${what}, which no ODF writer in this package can produce yet -- refusing to state a canonical form for content that would be silently lost on write. See ExaDev/documents.js for the tracked follow-up covering the fidelity constructs and embedded objects.`,
  );
}

// ODF states every colour as six hex digits (its own text:color datatype -- see typed/shared/color.ts), so a Color component that is not a whole 1/255 step cannot be carried: 0.9 is written as "e6" and read back as 230/255. Round-tripping through document-schema.js's own hex pair IS that quantisation, stated once here rather than approximated with an epsilon comparison in a test.
export function canonicalColor(color: Color): Color {
  return rgbHexToColor(colorToRgbHex(color));
}

// One run carrying only the fields it actually states. The reader builds every run with all seven formatting fields present and most of them undefined (typed/shared/paragraph.ts's runFromText), while a hand-built document states only what it means -- the same run, spelled two ways. The canonical form is the spelled-only one, so the two are comparable at all.
export function canonicalRun(run: ContentRun): ContentRun {
  const canonical: ContentRun = { text: run.text };
  if (run.bold !== undefined) {
    canonical.bold = run.bold;
  }
  if (run.italic !== undefined) {
    canonical.italic = run.italic;
  }
  if (run.underline !== undefined) {
    canonical.underline = run.underline;
  }
  if (run.strike !== undefined) {
    canonical.strike = run.strike;
  }
  if (run.fontFamily !== undefined) {
    canonical.fontFamily = run.fontFamily;
  }
  if (run.sizePt !== undefined) {
    canonical.sizePt = run.sizePt;
  }
  if (run.color !== undefined) {
    canonical.color = canonicalColor(run.color);
  }
  if (run.hyperlink !== undefined) {
    canonical.hyperlink = run.hyperlink;
  }
  return canonical;
}

// One paragraph in the exact shape reading the written document back produces: runs segmented into what ODF's inline content model can carry (see segmentOdfParagraphRuns's own note), list membership renumbered onto the given canonical numId (undefined strips membership entirely -- a table cell, which never carries list membership, always passes undefined here), and every field the format has no spelling for dropped. styleId is the interesting one -- a heading's identity is STRUCTURAL in ODF (a text:h carrying text:outline-level), so a reader always re-derives it as "Heading{level}" and it survives exactly; every other paragraph's styleId is a producer's own style name, and this package's writers mint their own automatic-style names, so an incoming one cannot survive and is dropped rather than pretended about. Refuses (rather than silently dropping) a run-level construct extent, the same fidelity-construct stance every writer in this package takes.
export function canonicalParagraph(
  paragraph: ContentParagraph,
  listNumId: string | undefined,
): ContentParagraph {
  if (paragraph.constructs !== undefined && paragraph.constructs.length > 0) {
    throw unsupportedContent(
      "run-level construct extents (a field, bookmark, note, annotation, or tracked change)",
      "a paragraph",
    );
  }
  const canonical: ContentParagraph = {
    kind: "paragraph",
    runs: segmentOdfParagraphRuns(paragraph.runs).map(canonicalRun),
  };
  if (paragraph.headingLevel !== undefined) {
    canonical.headingLevel = paragraph.headingLevel;
    canonical.styleId = `Heading${paragraph.headingLevel}`;
  }
  if (paragraph.alignment !== undefined) {
    canonical.alignment = paragraph.alignment;
  }
  if (listNumId !== undefined && paragraph.list !== undefined) {
    canonical.list = { numId: listNumId, level: paragraph.list.level };
  }
  if (paragraph.spacingBeforePt !== undefined) {
    canonical.spacingBeforePt = paragraph.spacingBeforePt;
  }
  if (paragraph.spacingAfterPt !== undefined) {
    canonical.spacingAfterPt = paragraph.spacingAfterPt;
  }
  if (paragraph.lineSpacing !== undefined) {
    canonical.lineSpacing = paragraph.lineSpacing;
  }
  if (paragraph.indentLeftPt !== undefined) {
    canonical.indentLeftPt = paragraph.indentLeftPt;
  }
  if (paragraph.indentFirstLinePt !== undefined) {
    canonical.indentFirstLinePt = paragraph.indentFirstLinePt;
  }
  if (paragraph.pageBreakBefore !== undefined) {
    canonical.pageBreakBefore = paragraph.pageBreakBefore;
  }
  if (paragraph.pageBreakAfter !== undefined) {
    canonical.pageBreakAfter = paragraph.pageBreakAfter;
  }
  return canonical;
}

// A covered grid position is a table:covered-table-cell in ODF, which carries no content, no span and no style of its own -- so whatever an incoming placeholder happened to hold, reading one back yields exactly an empty cell. A non-paragraph block (a table cell can hold only text:p/text:h, per typed/shared/table.ts's own readTableCell) is refused by name, matching every writer's own fidelity-construct stance.
function canonicalCell(
  cell: ContentTableCell,
  covered: boolean,
): ContentTableCell {
  if (covered) {
    return { blocks: [] };
  }
  const canonical: ContentTableCell = {
    blocks: cell.blocks.map((block) => {
      if (block.kind !== "paragraph") {
        throw unsupportedContent(`a "${block.kind}" block`, "a table cell");
      }
      return canonicalParagraph(block, undefined);
    }),
  };
  if (cell.colSpan !== undefined) {
    canonical.colSpan = cell.colSpan;
  }
  if (cell.rowSpan !== undefined) {
    canonical.rowSpan = cell.rowSpan;
  }
  if (cell.background !== undefined) {
    canonical.background = canonicalColor(cell.background);
  }
  if (cell.borders !== undefined) {
    // An absent border style is written as "solid", which is what ContentBorderSchema already documents an absent style to mean -- so it comes back stated rather than absent.
    const borders: NonNullable<ContentTableCell["borders"]> = {};
    for (const edge of ["left", "right", "top", "bottom"] as const) {
      const border = cell.borders[edge];
      if (border !== undefined) {
        borders[edge] = {
          color: canonicalColor(border.color),
          widthPt: border.widthPt,
          style: border.style ?? "solid",
        };
      }
    }
    canonical.borders = borders;
  }
  return canonical;
}

// The one canonical ContentTable a written-and-reread table equals, wherever writeOdfTable places it (odt's own top-level tables, or one nested inside an odp/odg shape's draw:frame) -- every mapping forced by ODF's own table:table content model rather than chosen here, matching typed/shared/table.ts's own writeOdfTable/readOdfTable as the single writer/reader pair every caller shares.
export function canonicalTable(table: ContentTable): ContentTable {
  const covered = new Set<string>();
  return {
    kind: "table",
    columnWidthsPt: [...table.columnWidthsPt],
    rows: table.rows.map((row, rowIndex) => {
      const cells = row.cells.map((cell, columnIndex) => {
        const key = `${rowIndex},${columnIndex}`;
        const isCovered = covered.has(key);
        if (!isCovered) {
          const colSpan = cell.colSpan ?? 1;
          const rowSpan = cell.rowSpan ?? 1;
          for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
            for (let c = columnIndex; c < columnIndex + colSpan; c += 1) {
              if (r !== rowIndex || c !== columnIndex) {
                covered.add(`${r},${c}`);
              }
            }
          }
        }
        return canonicalCell(cell, isCovered);
      });
      return row.heightPt === undefined
        ? { cells }
        : { cells, heightPt: row.heightPt };
    }),
  };
}

// The one canonical LayoutMetadata a written-and-reread document's own metadata equals: exactly the seven fields typed/shared/metadata.ts's writeOdfMetadata puts into meta.xml and readOdfMetadata reads back, each passed through when stated and dropped when absent (an empty keywords array writes no meta:keyword elements at all, so it reads back absent rather than empty). Every other LayoutMetadata field -- `producer`, `language`, and the rest -- is dropped: none has a meta.xml spelling this package writes or reads, so carrying it would be claiming a fidelity meta.xml does not have. Shared by every content writer here rather than restated per format: what meta.xml can carry is a property of the part, not of which body element sits beside it.
export function canonicalMetadata(metadata: LayoutMetadata): LayoutMetadata {
  const canonical: LayoutMetadata = {};
  if (metadata.title !== undefined) {
    canonical.title = metadata.title;
  }
  if (metadata.author !== undefined) {
    canonical.author = metadata.author;
  }
  if (metadata.subject !== undefined) {
    canonical.subject = metadata.subject;
  }
  if (metadata.keywords !== undefined && metadata.keywords.length > 0) {
    canonical.keywords = [...metadata.keywords];
  }
  if (metadata.creator !== undefined) {
    canonical.creator = metadata.creator;
  }
  if (metadata.createdIso !== undefined) {
    canonical.createdIso = metadata.createdIso;
  }
  if (metadata.modifiedIso !== undefined) {
    canonical.modifiedIso = metadata.modifiedIso;
  }
  return canonical;
}

// The one canonical ContentImageBlock a written-and-reread image equals: format/base64/size/altText survive verbatim (an image part is copied byte-for-byte into the package, never re-encoded), and every other field (sourcePath, source, frames -- a reader's and a layout pass's own facts, never content) is dropped.
export function canonicalImage(image: ContentImageBlock): ContentImageBlock {
  const canonical: ContentImageBlock = {
    kind: "image",
    format: image.format,
    base64: image.base64,
    widthPt: image.widthPt,
    heightPt: image.heightPt,
  };
  if (image.altText !== undefined) {
    canonical.altText = image.altText;
  }
  return canonical;
}
