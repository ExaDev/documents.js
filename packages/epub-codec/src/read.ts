import {
  assembleTree,
  PAGE_SIZE_A4,
  type ContentDocument,
  type ContentSection,
  type DocumentTree,
  type SourceResidue,
} from "document-schema.js";
import { resolveOpfPath } from "./ocf/container";
import {
  EpubDiagnosticCodes,
  EpubEmptySpineError,
  EpubInvalidContainerError,
  EpubInvalidMimetypeError,
  EpubInvalidOpfError,
  NOOP_EPUB_DIAGNOSTIC_SINK,
  type EpubDiagnosticSink,
} from "./diagnostics";
import { EPUB_MIME_TYPE } from "./format";
import { readNav3TocHrefs } from "./nav/nav3";
import { readNcxHrefs } from "./nav/ncx";
import { navMatchesSpine } from "./nav/reconcile";
import { parseOpf } from "./opf/parse";
import { attrValue } from "./xml/query";
import type { ResolvedAnchorTarget } from "./xhtml/context";
import { isFootnoteReference } from "./xhtml/footnote";
import {
  BLOCK_LEVEL_TAGS,
  readXhtmlBody,
  scanXhtmlAnchors,
} from "./xhtml/read";
import { resolveHrefTarget } from "./xhtml/link-target";
import { dirname, resolvePackagePath } from "./path";
import { parsePackage } from "./package-io/read";
import { packageToEntries } from "./package-io/write";

// The public read entry points: readEpubContent (the flat ContentDocument every codec's read side ultimately produces) and readEpub (the tree-form DocumentTree, assembleTree composed on top -- matching markdown-codec's own dual-level API exactly, at the "unsuffixed name is the tree, Content-suffixed is the flat pair one level down" convention). The tree is where a nav/NCX-vs-spine mismatch's raw XML lands as package-level residue (DocumentTreeSchema's own root `source` table) -- the flat ContentDocument has no root field to carry it, mirroring markdown-codec's identical "the flat pair never carries the tree-only residue table" precedent.

export interface ReadEpubOptions {
  readonly sink?: EpubDiagnosticSink;
}

const A4_MARGINS = { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 };
const CONTENT_WIDTH_PT =
  PAGE_SIZE_A4.widthPt - A4_MARGINS.leftPt - A4_MARGINS.rightPt;

interface ParsedEpub {
  readonly document: ContentDocument;
  readonly navResidue: SourceResidue | undefined;
}

function decodeText(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

interface ResolvedSpineItem {
  readonly fullPath: string;
  readonly xml: string;
}

interface CrossDocumentAnchorRegistry {
  // This document's own ids that some OTHER document's href targets, mapped to the ResolvedAnchorTarget (always cross-document-qualified) the constructStart marker src/xhtml/read.ts's own readBlockElement/readAside wraps that id in must carry -- fed straight in as ReadXhtmlBodyOptions.extraAnchorTargets.
  readonly targetsByHref: ReadonlyMap<
    string,
    ReadonlyMap<string, ResolvedAnchorTarget>
  >;
  // The reference-side counterpart: resolves an href a document's own local (same-document) prescan could not, to the same ResolvedAnchorTarget targetsByHref would hand the target document -- fed in as ReadXhtmlBodyOptions.resolveCrossDocumentAnchorHref.
  readonly resolveHref: (
    sourceHref: string,
    href: string,
  ) => ResolvedAnchorTarget | undefined;
}

// Every href in the whole spine is walked exactly once here, resolved against its own source document's directory (src/xhtml/link-target.ts's resolveHrefTarget), and kept only when it names a real, block-level element (BLOCK_LEVEL_TAGS) in a DIFFERENT spine document -- a same-document href is entirely readXhtmlBody's own local prescan's job (it has this document's own idElements already, with no cross-document lookup needed), so this registry only ever holds cross-document entries. Every entry that does land here therefore has at least one genuine cross-document referrer by construction, which is exactly the condition src/xhtml/context.ts's own ResolvedAnchorTarget comment states for when a name must be qualified -- so every name this function mints is qualified, unconditionally, with no separate "does this collide" check required. footnote-vs-bookmark classification reuses src/xhtml/footnote.ts's own isFootnoteReference, the identical same-document logic readXhtmlBody's own local prescan already applies -- a cross-document footnote reference (ExaDev/documents.js#963's own "notes.xhtml" shape) is recognised exactly the same way, just resolved against a different document's own idElements.
function buildCrossDocumentAnchorRegistry(
  items: readonly ResolvedSpineItem[],
): CrossDocumentAnchorRegistry {
  const scans = new Map(
    items.map((item) => [item.fullPath, scanXhtmlAnchors(item.xml)]),
  );
  const spineHrefs = new Set(items.map((item) => item.fullPath));
  const targetsByHref = new Map<string, Map<string, ResolvedAnchorTarget>>();

  for (const item of items) {
    const scan = scans.get(item.fullPath);
    if (scan === undefined) {
      continue;
    }
    for (const anchor of scan.anchors) {
      const href = attrValue(anchor, "href");
      if (href === undefined) {
        continue;
      }
      const target = resolveHrefTarget(item.fullPath, href);
      if (
        target === undefined ||
        target.targetHref === item.fullPath ||
        !spineHrefs.has(target.targetHref)
      ) {
        continue;
      }
      const targetElement = scans
        .get(target.targetHref)
        ?.idElements.get(target.fragment);
      if (
        targetElement === undefined ||
        !BLOCK_LEVEL_TAGS.has(targetElement.tag)
      ) {
        continue;
      }
      const perDoc =
        targetsByHref.get(target.targetHref) ??
        new Map<string, ResolvedAnchorTarget>();
      // A footnote-shaped referrer always wins the same id (matching readXhtmlBody's own local prescan and appendAnchor's reference-side priority) -- two different referrers reading the identical target two different ways must not let iteration order decide which classification survives.
      if (perDoc.get(target.fragment)?.anchorType !== "footnote") {
        perDoc.set(target.fragment, {
          anchorType: isFootnoteReference(anchor, targetElement)
            ? "footnote"
            : "bookmark",
          name: `${target.targetHref}#${target.fragment}`,
        });
      }
      targetsByHref.set(target.targetHref, perDoc);
    }
  }

  return {
    targetsByHref,
    resolveHref: (sourceHref, href) => {
      const target = resolveHrefTarget(sourceHref, href);
      if (target === undefined || target.targetHref === sourceHref) {
        return undefined;
      }
      return targetsByHref.get(target.targetHref)?.get(target.fragment);
    },
  };
}

function readEpubInternal(
  bytes: Uint8Array<ArrayBuffer>,
  sink: EpubDiagnosticSink,
): ParsedEpub {
  // The lossless byte-level Package model (ExaDev/documents.js#963) is this function's own first step, not a separate entry point a caller must reach for themselves: readEpubContent/readEpub stay this package's one-shot bytes-in convenience, but internally they now cross the identical decodePackage boundary a caller reaching for decodePackage/encodePackage directly would. packageToEntries reconstitutes the same Record<string, Uint8Array> shape unzipPackage used to hand this function, so every entries[path] read below is unchanged.
  const entries = packageToEntries(parsePackage(bytes));
  const mimetypeBytes = entries.mimetype;
  if (
    mimetypeBytes === undefined ||
    decodeText(mimetypeBytes) !== EPUB_MIME_TYPE
  ) {
    throw new EpubInvalidMimetypeError();
  }

  const containerBytes = entries["META-INF/container.xml"];
  if (containerBytes === undefined) {
    throw new EpubInvalidContainerError(
      "the zip carries no META-INF/container.xml entry",
    );
  }
  const opfPath = resolveOpfPath(decodeText(containerBytes));
  const opfBytes = entries[opfPath];
  if (opfBytes === undefined) {
    throw new EpubInvalidOpfError(
      `META-INF/container.xml names an OPF rootfile ("${opfPath}") the zip does not contain`,
    );
  }
  const opfDir = dirname(opfPath);
  const opf = parseOpf(decodeText(opfBytes), sink);

  const manifestById = new Map(opf.manifest.map((item) => [item.id, item]));

  const spineFullPaths: string[] = [];
  const resolvedItems: ResolvedSpineItem[] = [];
  for (const itemref of opf.spine) {
    const manifestItem = manifestById.get(itemref.idref);
    if (manifestItem === undefined) {
      sink({
        code: EpubDiagnosticCodes.SPINE_ITEMREF_UNRESOLVED,
        severity: "warning",
        message: `spine itemref "${itemref.idref}" names no manifest item; skipped`,
      });
      continue;
    }
    const fullPath = resolvePackagePath(opfDir, manifestItem.href);
    spineFullPaths.push(fullPath);
    const xhtmlBytes = entries[fullPath];
    if (xhtmlBytes === undefined) {
      sink({
        code: EpubDiagnosticCodes.MANIFEST_ITEM_MISSING,
        severity: "warning",
        message: `manifest item "${manifestItem.id}" names a part ("${fullPath}") the zip does not contain; skipped`,
        href: fullPath,
      });
      continue;
    }
    resolvedItems.push({ fullPath, xml: decodeText(xhtmlBytes) });
  }

  // The whole-spine cross-document anchor registry (ExaDev/documents.js#963): which id in which document is targeted by a href living in a DIFFERENT document, whether that target is a footnote body or an ordinary internal link target, and under what canonical name -- see buildCrossDocumentAnchorRegistry below and src/xhtml/context.ts's own ResolvedAnchorTarget comment for the naming rule. A same-document href is entirely readXhtmlBody's own local prescan's job and never reaches this registry at all.
  const anchorRegistry = buildCrossDocumentAnchorRegistry(resolvedItems);

  const sections: ContentSection[] = [];
  for (const { fullPath, xml } of resolvedItems) {
    const sectionDir = dirname(fullPath);
    const { blocks, source } = readXhtmlBody(xml, {
      resolveImage: (src) => entries[resolvePackagePath(sectionDir, src)],
      sink,
      sourceHref: fullPath,
      contentWidthPt: CONTENT_WIDTH_PT,
      extraAnchorTargets: anchorRegistry.targetsByHref.get(fullPath),
      resolveCrossDocumentAnchorHref: (href) =>
        anchorRegistry.resolveHref(fullPath, href),
    });
    sections.push({
      pageSize: PAGE_SIZE_A4,
      margins: A4_MARGINS,
      blocks,
      ...(source !== undefined ? { source } : {}),
    });
  }

  if (sections.length === 0) {
    throw new EpubEmptySpineError();
  }

  sink({
    code: EpubDiagnosticCodes.INVENTED_PAGE_GEOMETRY,
    severity: "info",
    message:
      "EPUB has no page concept of its own; every section was given A4 + 1in default page geometry",
  });

  const navResidue = reconcileNavigation(
    opf,
    entries,
    opfDir,
    spineFullPaths,
    sink,
  );

  const document: ContentDocument = {
    kind: "wordprocessing",
    metadata: opf.metadata,
    sections,
  };
  return { document, navResidue };
}

function reconcileNavigation(
  opf: ReturnType<typeof parseOpf>,
  entries: Record<string, Uint8Array<ArrayBuffer>>,
  opfDir: string,
  spineFullPaths: readonly string[],
  sink: EpubDiagnosticSink,
): SourceResidue | undefined {
  const navItem = opf.manifest.find((item) => item.properties.includes("nav"));
  if (navItem !== undefined) {
    const navPath = resolvePackagePath(opfDir, navItem.href);
    const navBytes = entries[navPath];
    if (navBytes !== undefined) {
      const navXml = decodeText(navBytes);
      const navHrefs = readNav3TocHrefs(navXml);
      if (navHrefs === undefined) {
        sink({
          code: EpubDiagnosticCodes.NAV_DOCUMENT_MISSING,
          severity: "warning",
          message: `the nav document ("${navPath}") carries no <nav epub:type="toc">`,
          href: navPath,
        });
      } else {
        const resolvedNavHrefs = navHrefs.map((href) =>
          resolvePackagePath(dirname(navPath), href),
        );
        if (!navMatchesSpine(resolvedNavHrefs, spineFullPaths)) {
          sink({
            code: EpubDiagnosticCodes.NAV_SPINE_ORDER_MISMATCH,
            severity: "warning",
            message:
              "the EPUB 3 navigation document's own toc order disagrees with the spine; the spine's reading order wins and the nav document is quarantined as residue",
            href: navPath,
          });
          return { format: "epub", xml: navXml };
        }
      }
    }
  }
  if (opf.ncxId !== undefined) {
    const ncxItem = opf.manifest.find((item) => item.id === opf.ncxId);
    const ncxPath =
      ncxItem === undefined
        ? undefined
        : resolvePackagePath(opfDir, ncxItem.href);
    const ncxBytes = ncxPath === undefined ? undefined : entries[ncxPath];
    if (ncxBytes === undefined) {
      sink({
        code: EpubDiagnosticCodes.NCX_MISSING,
        severity: "warning",
        message: `the spine names an NCX ("${opf.ncxId}") the manifest does not resolve to a real part`,
      });
      return undefined;
    }
    const ncxXml = decodeText(ncxBytes);
    const ncxHrefs = readNcxHrefs(ncxXml);
    if (ncxHrefs !== undefined) {
      const resolvedNcxHrefs = ncxHrefs.map((href) =>
        resolvePackagePath(opfDir, href),
      );
      if (!navMatchesSpine(resolvedNcxHrefs, spineFullPaths)) {
        sink({
          code: EpubDiagnosticCodes.NAV_SPINE_ORDER_MISMATCH,
          severity: "warning",
          message:
            "the EPUB 2 NCX's own navMap order disagrees with the spine; the spine's reading order wins and the NCX is quarantined as residue",
          href: ncxPath,
        });
        return { format: "epub", xml: ncxXml };
      }
    }
  }
  return undefined;
}

export function readEpubContent(
  bytes: Uint8Array<ArrayBuffer>,
  options: ReadEpubOptions = {},
): ContentDocument {
  const { document } = readEpubInternal(
    bytes,
    options.sink ?? NOOP_EPUB_DIAGNOSTIC_SINK,
  );
  return document;
}

export function readEpub(
  bytes: Uint8Array<ArrayBuffer>,
  options: ReadEpubOptions = {},
): DocumentTree {
  const { document, navResidue } = readEpubInternal(
    bytes,
    options.sink ?? NOOP_EPUB_DIAGNOSTIC_SINK,
  );
  const tree = assembleTree(document);
  return navResidue === undefined
    ? tree
    : { ...tree, source: { nav: navResidue } };
}
