import type { ContentDocument, DocumentTree } from "document-schema.js";
import { flattenTree } from "document-schema.js";
import type { Package } from "../../model/package";
import type { XmlNode } from "../../model/node";
import { ODF_MEDIA_TYPES } from "../../media-type";
import { writeMimetype } from "../../mimetype";
import { syncManifest } from "../../manifest";
import { el } from "../../xml/fragment";
import { writeOdfMetadata } from "../shared/metadata";
import { DEFAULT_ODF_VERSION } from "../../package-io/scaffold";
import type { OdfFormulaDocument } from "./read";

// OdfFormulaDocument / ContentDocument(kind 'formula') / DocumentTree -> a real .odf Package: the write-side inverse of typed/formula/read.ts's own three-level ladder, and the fifth content writer in this package's typed layer. The ladder mirrors the reader's exactly -- writeOdfFormula takes the DocumentTree readOdfFormula returns, writeOdfFormulaContent the flat ContentDocument readOdfFormulaContent returns, writeOdfFormulaMathMl the raw MathML-plus-StarMath document readOdfFormulaMathMl returns -- so a caller writes back at whichever level it read.
//
// The package shape is the one read.ts's own top-of-file note verified against genuine LibreOffice 26.2 output: there is NO office:document-content wrapper at all -- content.xml's root element IS the MathML document, an unprefixed <math> root carrying the MathML namespace as the part's DEFAULT namespace (xmlns, not xmlns:math -- the real producer's own spelling, and the reason read.ts matches a bare "math" tag first). The scaffold's createOdfPackage is therefore not used here: it fabricates the office:document-content/office:body wrapper every other ODF kind needs, and an .odf has none of it. Only the shared helpers are reused -- writeMimetype for the first-entry stored mimetype, writeOdfMetadata for meta.xml, syncManifest as the writer's last step, exactly as every other typed writer does.
//
// The MathML nodes themselves are written VERBATIM -- the same lossless-XmlNode philosophy the rest of this family's writers apply to content they did not author. That includes the StarMath annotation: read.ts recovers starMath from a <semantics><annotation encoding="StarMath ..."> element INSIDE the MathML children, so it round-trips as part of the nodes and is never re-synthesised or re-wrapped by this writer. A caller constructing an OdfFormulaDocument whose starMath disagrees with the annotation inside its own mathml is handing this writer two versions of one fact; the MathML wins, because it is the channel the format actually has.
const MATHML_NAMESPACE = "http://www.w3.org/1998/Math/MathML";
const MATH_PREFIX = "math:";

export interface OdfFormulaWriteOptions {
  // The ODF version stamped on meta.xml and on the manifest. Defaults to the current standard, matching every other writer's own option.
  readonly version?: string;
}

// True when any element in the MathML content carries a "math:"-prefixed tag -- a producer that bound the MathML namespace to an explicit prefix rather than the default namespace read.ts's real-LibreOffice verification observed. The root's namespace declaration has to match whichever spelling the content actually uses, or the part is not well-formed XML.
function contentUsesMathPrefix(nodes: readonly XmlNode[]): boolean {
  for (const node of nodes) {
    if (node.type === "element") {
      if (node.tag.startsWith(MATH_PREFIX)) {
        return true;
      }
      if (contentUsesMathPrefix(node.children)) {
        return true;
      }
    }
  }
  return false;
}

function mathDocumentNodes(mathml: readonly XmlNode[]): XmlNode[] {
  return [
    {
      type: "declaration",
      attributes: [
        { name: "version", value: "1.0" },
        { name: "encoding", value: "UTF-8" },
      ],
    },
    el(
      "math",
      contentUsesMathPrefix(mathml)
        ? { "xmlns:math": MATHML_NAMESPACE }
        : { xmlns: MATHML_NAMESPACE },
      [...mathml],
    ),
  ];
}

// The raw level: MathML nodes plus metadata, no pivot shaping. Throws for a document whose mathml is empty -- a <math> root with no content at all is not a formula any real producer writes, and refusing here is cheaper for a caller to diagnose than an .odf that opens as a blank formula canvas.
export function writeOdfFormulaMathMl(
  document: OdfFormulaDocument,
  options: OdfFormulaWriteOptions = {},
): Package {
  if (document.mathml.length === 0) {
    throw new Error(
      "writeOdfFormulaMathMl: a formula document's mathml is empty -- there is no MathML content to write",
    );
  }
  const version = options.version ?? DEFAULT_ODF_VERSION;
  const pkg: Package = { parts: {} };
  writeMimetype(pkg, ODF_MEDIA_TYPES.odf);
  pkg.parts["content.xml"] = {
    kind: "xml",
    nodes: mathDocumentNodes(document.mathml),
  };
  writeOdfMetadata(pkg, document.metadata, version);
  syncManifest(pkg, { version });
  return pkg;
}

// The flat pivot level: a ContentDocument of kind 'formula', the shape readOdfFormulaContent returns.
export function writeOdfFormulaContent(
  content: ContentDocument,
  options: OdfFormulaWriteOptions = {},
): Package {
  if (content.kind !== "formula") {
    throw new Error(
      `writeOdfFormulaContent: expected a 'formula' document, got '${content.kind}' -- odf.js writes .odf from the formula arm only`,
    );
  }
  return writeOdfFormulaMathMl(
    {
      mathml: content.formula.mathml,
      ...(content.formula.starMath !== undefined
        ? { starMath: content.formula.starMath }
        : {}),
      metadata: content.metadata,
    },
    options,
  );
}

// The primary entry point: a DocumentTree, the shape readOdfFormula returns. Flattened through document-schema.js's own flattenTree, mirroring writeOdt/writeOds's own relationship to their *Content siblings.
export function writeOdfFormula(
  tree: DocumentTree,
  options: OdfFormulaWriteOptions = {},
): Package {
  return writeOdfFormulaContent(flattenTree(tree), options);
}
