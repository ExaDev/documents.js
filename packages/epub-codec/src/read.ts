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
import { readXhtmlBody } from "./xhtml/read";
import { dirname, resolvePackagePath } from "./path";
import { unzipPackage } from "./zip";

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

function readEpubInternal(
  bytes: Uint8Array<ArrayBuffer>,
  sink: EpubDiagnosticSink,
): ParsedEpub {
  const entries = unzipPackage(bytes);
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

  const sections: ContentSection[] = [];
  const spineFullPaths: string[] = [];
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
    const sectionDir = dirname(fullPath);
    const { blocks, source } = readXhtmlBody(decodeText(xhtmlBytes), {
      resolveImage: (src) => entries[resolvePackagePath(sectionDir, src)],
      sink,
      sourceHref: fullPath,
      contentWidthPt: CONTENT_WIDTH_PT,
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
