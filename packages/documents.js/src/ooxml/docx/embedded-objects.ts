import type {
  ContentBlock,
  ContentSection,
  ContentTable,
  PageSize,
} from "document-schema.js";
import type { XmlElement, XmlNode } from "ooxml.js";
import { childrenWithTag } from "ooxml.js";
import { buildDrawingBlock } from "../../model/embedded-drawing";
import { buildFormulaBlock } from "../../model/formula";
import type { BlockPlacement } from "../../model/block-splice";
import { spliceBlocks } from "../../model/block-splice";
import { collectOfficeMathElements, readOfficeMath } from "../../omml/read";
import type { DetectedParagraphVector } from "./vector";
import { collectParagraphVectors } from "./vector";
import type { OmmlDiagnosticSink } from "./formula";
import {
  collectBodyParagraphs,
  collectBodyTables,
  equationFrame,
  PARAGRAPH_NON_CONTENT_TAGS,
} from "./formula";

// A second, independent pass over the SAME word/document.xml the upstream reader already read, splicing every OOXML math equation AND every recovered vector-only shape it found into the ContentSections that reader produced -- the docx-side counterpart to src/odf/odt/read.ts's own combined embedded-formula/vector pass, and the direct replacement of what used to be a formula-only spliceDocxFormulas (src/ooxml/docx/formula.ts). Merging the two into ONE splice pass rather than running two sequential ones is load-bearing, not tidiness: a second pass run against the ALREADY-spliced block array would count paragraph ordinals against the wrong (post-formula-splice) indices, since formula.ts's own paragraph-to-block ordinal correspondence assumes nothing has moved yet.
//
// A formula's own detection (collectOfficeMathElements/readOfficeMath) is unchanged from the old spliceDocxFormulas; collectParagraphVectors (./vector.ts) is the vector-side detector, mirroring src/odf/odt/read.ts's own collectContainerVectors call exactly one paragraph at a time. This pass now also descends into every table's cells (and any table nested in a cell, recursively): collectBodyParagraphs/collectBodyTables were extended to collect w:tbl alongside w:p, and a table block is rebuilt with each of its cells' own blocks spliced independently -- so an equation inside a table cell is recovered into THAT cell's blocks, not dropped the way it was when this pass walked only top-level paragraphs.

function isVectorOnlyRun(
  run: XmlElement,
  vectors: readonly DetectedParagraphVector[],
): boolean {
  const elementChildren = run.children.filter(
    (child): child is XmlElement => child.type === "element",
  );
  if (elementChildren.length !== 1) {
    return false;
  }
  const hasNonWhitespaceText = run.children.some(
    (child) => child.type === "text" && child.value.trim().length > 0,
  );
  if (hasNonWhitespaceText) {
    return false;
  }
  return vectors.some(
    (detected) => detected.drawingElement === elementChildren[0],
  );
}

// The generalisation of the old isEquationOnlyParagraph: a paragraph carrying nothing but non-content markers, recognised equations, and recognised vector-only runs is itself the embedded object(s), not a paragraph that merely contains one.
function isEmbeddedObjectOnlyParagraph(
  paragraph: XmlElement,
  equations: readonly XmlElement[],
  vectors: readonly DetectedParagraphVector[],
): boolean {
  if (equations.length === 0 && vectors.length === 0) {
    return false;
  }
  for (const child of paragraph.children) {
    if (child.type === "text") {
      if (child.value.trim().length > 0) {
        return false;
      }
      continue;
    }
    if (child.type !== "element") {
      continue;
    }
    if (
      PARAGRAPH_NON_CONTENT_TAGS.has(child.tag) ||
      equations.includes(child)
    ) {
      continue;
    }
    // An m:oMathPara wrapping only equations this pass already collected is the display-equation container itself, not extra content.
    if (
      child.tag === "m:oMathPara" &&
      collectOfficeMathElements(child.children).every((math) =>
        equations.includes(math),
      )
    ) {
      continue;
    }
    if (child.tag === "w:r" && isVectorOnlyRun(child, vectors)) {
      continue;
    }
    return false;
  }
  return true;
}

interface ParagraphEmbeddings {
  readonly placements: readonly BlockPlacement[];
  readonly consume: boolean;
}

// The shared paragraph-detection both the section-level walk and the per-cell recursion go through: given one paragraph block and its matching w:p element, recover every equation and vector-only shape it carries, returning the placements to splice in immediately AFTER it (index: blockIndex + 1) and whether the paragraph itself is consumed (it carried nothing but the recovered objects). Diagnostics for an equation that produced no MathML are reported eagerly against the block's own sourcePath, whether or not the paragraph is consumed.
function paragraphEmbeddings(
  block: Extract<ContentBlock, { kind: "paragraph" }>,
  paragraph: XmlElement,
  blockIndex: number,
  onMathDiagnostic?: OmmlDiagnosticSink,
): ParagraphEmbeddings {
  const equations = collectOfficeMathElements(paragraph.children);
  const vectors = collectParagraphVectors(paragraph);
  if (equations.length === 0 && vectors.length === 0) {
    return { placements: [], consume: false };
  }

  const converted = equations.map((equation) => ({
    equation,
    ...readOfficeMath(equation),
  }));
  const rendered = converted.filter((result) => result.mathml.length > 0);

  if (rendered.length === 0 && vectors.length === 0) {
    for (const result of converted) {
      for (const diagnostic of result.diagnostics) {
        onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
      }
    }
    return { placements: [], consume: false };
  }

  const insertAt = blockIndex + 1;
  const placements: BlockPlacement[] = [];
  for (const result of rendered) {
    // Diagnostics for a rendered equation are reported from inside its own build thunk, at the exact sourcePath the resulting formula block receives -- spliceBlocks only learns that position once it actually places the block, so eagerly computing one here is not available to this lazily-built placement.
    placements.push({
      index: insertAt,
      build: (sourcePath) => {
        for (const diagnostic of result.diagnostics) {
          onMathDiagnostic?.(diagnostic, { sourcePath });
        }
        return buildFormulaBlock(
          { mathml: result.mathml },
          equationFrame(result.equation),
          sourcePath,
        );
      },
    });
  }
  // An equation whose OMML produced no MathML at all (an empty m:oMath) is not a formula to carry, so nothing is spliced in for it -- but a caller still wants to know it was attempted.
  for (const result of converted) {
    if (result.mathml.length > 0) {
      continue;
    }
    for (const diagnostic of result.diagnostics) {
      onMathDiagnostic?.(diagnostic, { sourcePath: block.sourcePath });
    }
  }
  if (vectors.length > 0) {
    const vectorValues = vectors.map((detected) => detected.vector);
    placements.push({
      index: insertAt,
      build: (sourcePath) => ({
        ...buildDrawingBlock({ widthPt: 0, heightPt: 0 }, vectorValues),
        sourcePath,
      }),
    });
  }

  return {
    placements,
    consume: isEmbeddedObjectOnlyParagraph(paragraph, equations, vectors),
  };
}

// A block list (a section's, or a cell's) walked against its own container's children: every paragraph block is matched to its w:p (advancing paragraphOrdinal), every table block to its w:tbl (advancing tableOrdinal), and a table's own cells are each recursed through the same function so an equation nested in a cell is spliced into that cell's blocks. Returns the spliced block list, or the input array unchanged when nothing was recovered at this level or any cell beneath it.
function spliceContainerBlocks(
  blocks: readonly ContentBlock[],
  containerChildren: readonly XmlNode[],
  pageSize: PageSize,
  sourcePathPrefix: string,
  onMathDiagnostic?: OmmlDiagnosticSink,
): ContentBlock[] {
  const paragraphElements: XmlElement[] = [];
  collectBodyParagraphs(containerChildren, paragraphElements);
  const tableElements: XmlElement[] = [];
  collectBodyTables(containerChildren, tableElements);

  let paragraphOrdinal = 0;
  let tableOrdinal = 0;
  const placements: BlockPlacement[] = [];
  const consumedIndices = new Set<number>();

  const rebuiltBlocks: ContentBlock[] = blocks.map((block, blockIndex) => {
    if (block.kind === "paragraph") {
      const paragraph = paragraphElements[paragraphOrdinal];
      paragraphOrdinal += 1;
      if (paragraph === undefined) {
        return block;
      }
      const { placements: paragraphPlacements, consume } = paragraphEmbeddings(
        block,
        paragraph,
        blockIndex,
        onMathDiagnostic,
      );
      if (paragraphPlacements.length > 0) {
        placements.push(...paragraphPlacements);
      }
      if (consume) {
        consumedIndices.add(blockIndex);
      }
      return block;
    }
    if (block.kind === "table") {
      const tableElement = tableElements[tableOrdinal];
      tableOrdinal += 1;
      if (tableElement === undefined) {
        return block;
      }
      return rebuildTable(
        block,
        tableElement,
        pageSize,
        `${sourcePathPrefix}[${blockIndex}]`,
        onMathDiagnostic,
      );
    }
    return block;
  });

  // Derived from the walk's own output rather than tracked by a flag: a rebuilt table is observable as a changed element, and a consumed paragraph is already recorded in consumedIndices. A flag assigned inside the map callback would also read as its initialiser here, since TypeScript ignores nested-function assignments when narrowing the enclosing scope.
  const rebuiltAnyBlock =
    consumedIndices.size > 0 ||
    rebuiltBlocks.some((block, index) => block !== blocks[index]);
  if (!rebuiltAnyBlock && placements.length === 0) {
    return [...blocks];
  }
  return spliceBlocks(
    rebuiltBlocks,
    placements,
    consumedIndices,
    (position) => `${sourcePathPrefix}[${position}]`,
  );
}

// Rebuilds a table block with each of its cells' own blocks spliced independently. The cell correspondence is positional: the Nth ContentTableRow maps to the Nth w:tr child of `tblElement`, and within it the Nth ContentTableCell to the Nth w:tc -- exactly the row-major order ooxml.js's own readTable produces them in (one cell per real w:tc, since a horizontal merge collapses to one w:tc carrying w:gridSpan). Returns the original table unchanged when no cell carried a recoverable embedded object.
function rebuildTable(
  table: ContentTable,
  tblElement: XmlElement,
  pageSize: PageSize,
  blockPath: string,
  onMathDiagnostic?: OmmlDiagnosticSink,
): ContentTable {
  const rowElements = childrenWithTag(tblElement, "w:tr");
  const rows = table.rows.map((row, rowIndex) => {
    const rowElement = rowElements[rowIndex];
    const cellElements =
      rowElement === undefined ? [] : childrenWithTag(rowElement, "w:tc");
    const cells = row.cells.map((cell, cellIndex) => {
      const cellElement = cellElements[cellIndex];
      if (cellElement === undefined) {
        return cell;
      }
      const blocks = spliceContainerBlocks(
        cell.blocks,
        cellElement.children,
        pageSize,
        `${blockPath}.rows[${rowIndex}].cells[${cellIndex}].blocks`,
        onMathDiagnostic,
      );
      return blocks === cell.blocks ? cell : { ...cell, blocks };
    });
    // Per row, not a function-scoped flag: the flag this replaces stayed true once any earlier row changed, so every later row was rebuilt into an element-wise identical copy for nothing.
    return cells.some((cell, index) => cell !== row.cells[index])
      ? { ...row, cells }
      : row;
  });
  return rows.some((row, index) => row !== table.rows[index])
    ? { ...table, rows }
    : table;
}

// Rebuilds every section's block list with each recovered equation and vector-only shape spliced in at its own true position, descending into every table's cells (and nested tables) along the way. Returns the sections unchanged (a fresh array, never the input array) when the document carries no OOXML math and no recovered vectors at all, which is the overwhelmingly common case and costs one shallow walk to establish.
export function spliceDocxEmbeddedObjects(
  sections: readonly ContentSection[],
  bodyChildren: readonly XmlNode[],
  onMathDiagnostic?: OmmlDiagnosticSink,
): ContentSection[] {
  const paragraphElements: XmlElement[] = [];
  collectBodyParagraphs(bodyChildren, paragraphElements);
  const tableElements: XmlElement[] = [];
  collectBodyTables(bodyChildren, tableElements);

  let paragraphOrdinal = 0;
  let tableOrdinal = 0;
  const out: ContentSection[] = [];
  for (const [sectionIndex, section] of sections.entries()) {
    const placements: BlockPlacement[] = [];
    const consumedIndices = new Set<number>();

    const rebuiltBlocks: ContentBlock[] = section.blocks.map(
      (block, blockIndex) => {
        if (block.kind === "paragraph") {
          const paragraph = paragraphElements[paragraphOrdinal];
          paragraphOrdinal += 1;
          if (paragraph === undefined) {
            return block;
          }
          const { placements: paragraphPlacements, consume } =
            paragraphEmbeddings(block, paragraph, blockIndex, onMathDiagnostic);
          if (paragraphPlacements.length > 0) {
            placements.push(...paragraphPlacements);
          }
          if (consume) {
            consumedIndices.add(blockIndex);
          }
          return block;
        }
        if (block.kind === "table") {
          const tableElement = tableElements[tableOrdinal];
          tableOrdinal += 1;
          if (tableElement === undefined) {
            return block;
          }
          return rebuildTable(
            block,
            tableElement,
            section.pageSize,
            `sections[${sectionIndex}].blocks`,
            onMathDiagnostic,
          );
        }
        return block;
      },
    );

    // Same derivation as spliceContainerBlocks above.
    const rebuiltAnyBlock = rebuiltBlocks.some(
      (block, index) => block !== section.blocks[index],
    );
    if (
      placements.length === 0 &&
      consumedIndices.size === 0 &&
      !rebuiltAnyBlock
    ) {
      out.push(section);
      continue;
    }
    const blocks = spliceBlocks(
      rebuiltBlocks,
      placements,
      consumedIndices,
      (position) => `sections[${sectionIndex}].blocks[${position}]`,
    );
    out.push({ ...section, blocks });
  }
  return out;
}
