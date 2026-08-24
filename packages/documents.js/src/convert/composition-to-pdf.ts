// The write half of the composition engine: executeToPdf (the X-to-PDF renderer executor), the LAYOUT_ENGINES registry it dispatches through, and the full convertDocument that binds bridge + fromPdf + toPdf into one plan runner. Everything here is split out of composition.ts so that module can stay the read half -- a consumer that only ever converts FROM pdf (the documents.js/read entry, src/convert/from-pdf.ts) reaches composition.ts's registry, pathfinder, and read executors without ever reaching this module, and therefore without statically importing writePdf, a font registry, a font measurer, or the vendored font assets those pull in. The package's read-graph guard test (src/read-graph.test.ts) holds that boundary; the executors themselves are unchanged -- only their module moved.

import {
  assembleTree,
  type ContentDocument,
  type MathFontMetrics,
  type PageSize,
  type PositionedFormula,
} from "document-schema.js";
import {
  createFontMeasurer,
  createFontRegistry,
  loadMathFont,
  writePdf,
  type FontRegistry,
} from "pdf-codec";
import type { LayoutDocument } from "pdf-codec";

import { convertDrawingToLayout } from "../layout/drawing";
import { convertWordprocessingToLayout } from "../layout/engine";
import { convertSpreadsheetToLayout } from "../layout/sheets";
import { convertPresentationToLayout } from "../layout/slides";
import { throwIfAborted } from "../ports/abort";
import { resolveMetadataTimestamps } from "../model/metadata";
import {
  createDocumentFontRegistry,
  type FontSourcePackage,
} from "../fonts/registry";
import {
  executeBridge,
  executeFromPdf,
  FORMAT_NODES,
  isTextFormatNode,
  LAYOUT_CAPABLE,
  resolveCompositionPlan,
  runCompositionPlan,
  type ContentFormat,
  type UnifiedConversionOptions,
} from "./composition";
import { UnsupportedConversionError } from "./capability";
import { type DocumentFormat } from "./port";

// A thin factory over pdf-codec's cached loadMathFont singleton, injected into each formula-placing layout engine's options as `mathMetricsAt` -- the identical one-liner convert.ts defines, restated here so this module owns no dependency on convert.ts. The drawing engine takes no mathMetricsAt (formulas cannot embed in a drawing), so it is wired per-variant in executeToPdf rather than unconditionally.
const mathMetricsAt = (sizePt: number): MathFontMetrics =>
  loadMathFont().metricsAt(sizePt);

// Layout engines keyed by variant -- the declarative registry executeToPdf dispatches through. Each maps a LayoutVariant to the concrete function the corresponding convert.ts path already calls: convertWordprocessingToLayout for the flow/pagination engine docx/odt/markdown feed, convertPresentationToLayout for the direct-placement engine pptx/odp feed, convertSpreadsheetToLayout for ods/xlsx's own column/row-band pagination, convertDrawingToLayout for odg's vector-primitive vocabulary. The reconstruct* counterparts (the read direction's registry) stay in composition.ts.
const LAYOUT_ENGINES = {
  wordprocessing: convertWordprocessingToLayout,
  presentation: convertPresentationToLayout,
  spreadsheet: convertSpreadsheetToLayout,
  drawing: convertDrawingToLayout,
} as const;

// decode(source) -> [extract source fonts] -> build font registry -> read(source) -> resolve metadata -> layout engine by variant -> writePdf, reproducing the exact sequence and option-threading of convert.ts's *ToPdf functions (docxToPdf/odtToPdf/odpToPdf/odsToPdf/odgToPdf/markdownToPdf). The font registry is built from the source package's own embedded faces for package formats (createDocumentFontRegistry) and from caller-supplied faces alone for markdown (createFontRegistry), matching markdownToPdf's own documented divergence. The drawing engine takes no mathMetricsAt and produces no positioned formulas, so writePdf is called without `formulas` for that variant -- byte-identical to odgToPdf. markdownToPdf's leading throwIfAborted (decodeMarkdownText has no abort hook of its own) is reproduced; the package paths match docxToPdf/odtToPdf by not checking abort until writePdf's own loops do.
export function executeToPdf(
  format: ContentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  if (!LAYOUT_CAPABLE.has(format)) {
    throw new Error(
      `executeToPdf: '${format}' has no layout engine of its own`,
    );
  }
  const node = FORMAT_NODES[format];

  let content: ContentDocument;
  let fonts: FontRegistry;
  if (isTextFormatNode(node)) {
    throwIfAborted(options?.signal);
    const text = node.decode(bytes);
    const read = node.read(text, options);
    content = {
      ...read,
      metadata: resolveMetadataTimestamps(read.metadata, options?.clock),
    };
    fonts = createFontRegistry({
      fonts: options?.fonts,
      onSubstitution: options?.onFontSubstitution,
    });
  } else {
    const pkg = node.decode(bytes);
    const read = node.read(pkg, options);
    content = {
      ...read,
      metadata: resolveMetadataTimestamps(read.metadata, options?.clock),
    };
    const fontSource: FontSourcePackage =
      node.family === "odf"
        ? { kind: "odf", package: pkg }
        : format === "pptx"
          ? { kind: "pptx", package: pkg }
          : { kind: "docx", package: pkg };
    fonts = createDocumentFontRegistry(fontSource, {
      fonts: options?.fonts,
      onFontSubstitution: options?.onFontSubstitution,
    });
  }
  const measurer = createFontMeasurer(fonts);

  // Layout by variant. Every engine returns { document, pages } plus (for the three that render embedded formulas) positioned MathML; the drawing engine takes no mathMetricsAt and produces no positioned formulas, so writePdf omits `formulas` for it -- the exact odgToPdf divergence. Each engine also stamps the placements it computed onto `content`'s own nodes in place (frames), so the content reported below is the fused unified package half, not the bare read output.
  let layout: LayoutDocument;
  let pages: readonly PageSize[];
  let formulas: readonly PositionedFormula[] | undefined;
  switch (content.kind) {
    case "wordprocessing": {
      const result = LAYOUT_ENGINES.wordprocessing(content, {
        measurer,
        mathMetricsAt,
      });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case "presentation": {
      const result = LAYOUT_ENGINES.presentation(content, {
        measurer,
        mathMetricsAt,
      });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case "spreadsheet": {
      const result = LAYOUT_ENGINES.spreadsheet(content, {
        measurer,
        mathMetricsAt,
        signal: options?.signal,
      });
      layout = result.document;
      pages = result.pages;
      formulas = result.formulas;
      break;
    }
    case "drawing": {
      const result = LAYOUT_ENGINES.drawing(content, { measurer });
      layout = result.document;
      pages = result.pages;
      break;
    }
    default: {
      throw new Error(
        `executeToPdf: cannot lay out a '${content.kind}' document`,
      );
    }
  }

  // The output bytes are built first and the package reported after them (the ownership rule every construction site follows), with assembleTree decomposing the framed content + rendered page sizes into the tree-form DocumentTree onDocument's contract now states.
  if (formulas === undefined) {
    const out = writePdf(layout, {
      signal: options?.signal,
      onSubstitution: options?.onSubstitution,
      fonts,
    });
    options?.onDocument?.(assembleTree(content, pages));
    return out;
  }
  const out = writePdf(layout, {
    signal: options?.signal,
    onSubstitution: options?.onSubstitution,
    formulas,
    fonts,
  });
  options?.onDocument?.(assembleTree(content, pages));
  return out;
}

// The full entry point: resolves a path between any two DocumentFormats and runs it with every executor bound -- the forward target of convert.ts's named functions and src/convert/local.ts's DocumentConverter port, and the one conversion entry whose module graph includes the X-to-PDF renderers. Identical in behaviour to the pre-split convertDocument: the same pathfinder, the same runner, the same executors; only the binding of executeToPdf lives here now. Throws UnsupportedConversionError (from capability.ts) for any pair the pathfinder cannot route.
export function convertDocument(
  source: DocumentFormat,
  target: DocumentFormat,
  bytes: Uint8Array<ArrayBuffer>,
  options?: UnifiedConversionOptions,
): Uint8Array<ArrayBuffer> {
  const plan = resolveCompositionPlan(source, target);
  if (plan === undefined) {
    throw new UnsupportedConversionError(source, target);
  }
  return runCompositionPlan(plan, bytes, options, {
    bridge: executeBridge,
    fromPdf: executeFromPdf,
    toPdf: executeToPdf,
  });
}
