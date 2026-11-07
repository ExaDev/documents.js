import {
  type ContentProjection,
  type ProjectionCategory,
  type ProjectionOptions,
  ProjectionBuilder,
  TextContainers,
} from "./projection";
import {
  CHART,
  DRAWINGML,
  MARKUP_COMPATIBILITY,
  OFFICE_MATH,
  WORDPROCESSINGML,
  type NamespaceRole,
} from "./ooxml-names";
import { MemoryBudget } from "./memory-budget";
import { listOpcParts, readContentTypes } from "./opc-package";
import { docxPartRole } from "./part-roles";
import { digestMediaPart, scanPart } from "./part-scan";
import type { XmlScanHandler } from "./xml-scan";

interface FamilyTable {
  readonly role: NamespaceRole;
  readonly locals: ReadonlySet<string>;
}

// The element families the census counts. A family is a fixed (namespace role, local name) pair, so `a:p` (DrawingML) is not confused with `w:p`. Both are chosen for what a rewrite could silently drop: paragraphs and table structure (including empty ones, which carry no words), notes, comments, drawings and their pictures, text boxes, content controls, links, fields, bookmarks, section properties, header and footer references, equations and embedded objects.
const DOCX_FAMILIES: readonly FamilyTable[] = [
  {
    role: WORDPROCESSINGML,
    locals: new Set([
      "p",
      "tbl",
      "tr",
      "tc",
      "sdt",
      "hyperlink",
      "drawing",
      "pict",
      "txbxContent",
      "bookmarkStart",
      "fldSimple",
      "instrText",
      "sectPr",
      "headerReference",
      "footerReference",
      "footnote",
      "endnote",
      "comment",
      "object",
    ]),
  },
  { role: DRAWINGML, locals: new Set(["blip"]) },
  { role: OFFICE_MATH, locals: new Set(["oMath", "oMathPara"]) },
];

function familyOf(uri: string, local: string): string | undefined {
  const table = DOCX_FAMILIES.find(
    (candidate) => candidate.role.has(uri) && candidate.locals.has(local),
  );
  return table === undefined ? undefined : local;
}

interface Frame {
  fallback: boolean;
  textBox: boolean;
  container: boolean;
  text: boolean;
}

/**
 * Walks one XML part that holds word-processing, DrawingML or chart text (xlsx drawings and charts use it too). Words are gathered per paragraph, with tabs and breaks as spaces, and are filed under the part's category, except that a paragraph inside a text box, and every DrawingML paragraph, is filed under `drawings` (and a chart's text under `charts`). Field codes (`w:instrText`) are not display text and are counted by the census only. The `mc:Fallback` branch of a Markup Compatibility choice is skipped whole, text and census alike: it repeats what the `mc:Choice` branch holds for readers that do not understand it, so counting both would count the content twice.
 */
export function textPartHandler(
  scratch: ProjectionBuilder,
  category: ProjectionCategory,
): XmlScanHandler {
  const containers = new TextContainers(scratch);
  const stack: Frame[] = [];
  let fallbackDepth = 0;
  let textBoxDepth = 0;
  let textDepth = 0;

  return {
    startElement(element) {
      const frame: Frame = {
        fallback: false,
        textBox: false,
        container: false,
        text: false,
      };
      stack.push(frame);
      if (
        MARKUP_COMPATIBILITY.has(element.uri) &&
        element.local === "Fallback"
      ) {
        frame.fallback = true;
        fallbackDepth += 1;
      }
      if (fallbackDepth > 0) {
        return;
      }
      const family = familyOf(element.uri, element.local);
      if (family !== undefined) {
        scratch.countFamily(category, family);
      }
      if (WORDPROCESSINGML.has(element.uri)) {
        switch (element.local) {
          case "txbxContent":
            frame.textBox = true;
            textBoxDepth += 1;
            break;
          case "p":
            containers.open(textBoxDepth > 0 ? "drawings" : category);
            frame.container = true;
            break;
          case "t":
          case "delText":
            frame.text = true;
            textDepth += 1;
            break;
          case "tab":
          case "br":
          case "cr":
            containers.append(" ");
            break;
          default:
            break;
        }
      } else if (DRAWINGML.has(element.uri)) {
        switch (element.local) {
          case "p":
            containers.open(category === "charts" ? "charts" : "drawings");
            frame.container = true;
            break;
          case "t":
            frame.text = true;
            textDepth += 1;
            break;
          case "br":
            containers.append(" ");
            break;
          default:
            break;
        }
      } else if (OFFICE_MATH.has(element.uri) && element.local === "t") {
        frame.text = true;
        textDepth += 1;
      } else if (CHART.has(element.uri) && element.local === "v") {
        containers.open("charts");
        frame.container = true;
        frame.text = true;
        textDepth += 1;
      }
    },
    text(value) {
      if (fallbackDepth === 0 && textDepth > 0) {
        containers.append(value);
      }
    },
    endElement() {
      const frame = stack.pop();
      if (frame === undefined) {
        return;
      }
      if (frame.text) {
        textDepth -= 1;
      }
      if (frame.textBox) {
        textBoxDepth -= 1;
      }
      if (frame.container) {
        containers.close();
      }
      if (frame.fallback) {
        fallbackDepth -= 1;
      }
    },
  };
}

/**
 * Projects a docx package onto what it says: words per category (body, headers and footers, notes, comments, drawings and text boxes, charts), an element census, and the images and embedded objects by content hash. The package is read one part at a time through a streaming scanner, so memory is bounded by the largest part and the units kept, never by a document tree.
 *
 * A part the memory budget does not cover, or that is not well-formed XML (a document type declaration included), is listed in `skippedParts` and contributes nothing. Parts of kinds that carry content this projection does not read are listed in `unmodelledParts`.
 */
export async function projectDocxContent(
  bytes: Uint8Array,
  options: ProjectionOptions,
): Promise<ContentProjection> {
  const builder = new ProjectionBuilder("docx");
  const context = {
    bytes,
    builder,
    budget: new MemoryBudget(options.memoryBudgetBytes),
  };
  const types = readContentTypes(bytes);
  for (const entry of listOpcParts(bytes)) {
    const role = docxPartRole(entry.name, types.typeOf(entry.name));
    if (role.kind === "text") {
      scanPart(context, entry, (scratch) =>
        textPartHandler(scratch, role.category),
      );
    } else if (role.kind === "media") {
      await digestMediaPart(context, entry, role.media);
    } else if (role.kind === "unmodelled") {
      builder.addUnmodelled(entry.name);
    }
  }
  return builder.build();
}
