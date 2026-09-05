import { describe, expect, it } from "vitest";
import { EpubDiagnosticCodes, type EpubDiagnostic } from "./diagnostics";
import { EPUB_MIME_TYPE } from "./format";
import { readEpub, readEpubContent } from "./read";
import { readXhtmlBody } from "./xhtml/read";
import { writeEpubContent } from "./write";
import { zipPackage } from "./zip";

// Coverage sweep: every entry in EpubDiagnosticCodes must be reachable from some real input to this package's own read/write surface, matching markdown-codec's own identical diagnostics-coverage discipline (its src/diagnostics/diagnostics.test.ts) -- a code that exists in the table but that nothing ever fires is dead documentation, worse than no documentation at all. Each case here is deliberately minimal; more thoroughly asserted per-gap behaviour lives in src/opf/parse.test.ts, src/xhtml/read.test.ts, src/xhtml/style-residue.test.ts, and src/read.test.ts. The final test asserts every code fires at least once across this sweep, so EpubDiagnosticCodes can never grow a new, silently-unreachable entry.

const reached = new Set<string>();

function collect(): { sink: (d: EpubDiagnostic) => void; codes: Set<string> } {
  const codes = new Set<string>();
  return {
    sink: (d) => {
      codes.add(d.code);
      reached.add(d.code);
    },
    codes,
  };
}

const CONTENT_WIDTH_PT = 451.28;

function minimalEpubEntries(
  chapterXml: string,
  extra: { opfExtra?: string; manifestExtra?: string; ncxItem?: boolean } = {},
): [string, { bytes: Uint8Array<ArrayBuffer>; stored?: boolean }][] {
  const encoder = new TextEncoder();
  const container = `<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const opf = `<package xmlns="http://www.idpf.org/2007/opf">
    <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>T</dc:title></metadata>
    <manifest>
      <item id="chapter1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
      ${extra.manifestExtra ?? ""}
    </manifest>
    <spine${extra.ncxItem === true ? ' toc="ncx"' : ""}>
      <itemref idref="chapter1"/>
      ${extra.opfExtra ?? ""}
    </spine>
  </package>`;
  return [
    ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
    ["META-INF/container.xml", { bytes: encoder.encode(container) }],
    ["OEBPS/content.opf", { bytes: encoder.encode(opf) }],
    ["OEBPS/chapter1.xhtml", { bytes: encoder.encode(chapterXml) }],
  ];
}

describe("every EpubDiagnosticCodes entry is reachable from real input", () => {
  it("INVENTED_PAGE_GEOMETRY fires on every read", () => {
    const { sink, codes } = collect();
    readEpubContent(
      zipPackage(minimalEpubEntries("<html><body><p>x</p></body></html>")),
      { sink },
    );
    expect(codes.has(EpubDiagnosticCodes.INVENTED_PAGE_GEOMETRY)).toBe(true);
  });

  it("SPINE_ITEMREF_UNRESOLVED fires when a spine itemref names no manifest item", () => {
    const { sink, codes } = collect();
    readEpubContent(
      zipPackage(
        minimalEpubEntries("<html><body><p>x</p></body></html>", {
          opfExtra: '<itemref idref="ghost"/>',
        }),
      ),
      { sink },
    );
    expect(codes.has(EpubDiagnosticCodes.SPINE_ITEMREF_UNRESOLVED)).toBe(true);
  });

  it("MANIFEST_ITEM_MISSING fires when a manifest item's own part is not in the zip", () => {
    const { sink, codes } = collect();
    const entries = minimalEpubEntries("<html><body><p>x</p></body></html>", {
      manifestExtra:
        '<item id="ghost" href="ghost.xhtml" media-type="application/xhtml+xml"/>',
      opfExtra: '<itemref idref="ghost"/>',
    });
    readEpubContent(zipPackage(entries), { sink });
    expect(codes.has(EpubDiagnosticCodes.MANIFEST_ITEM_MISSING)).toBe(true);
  });

  it("NAV_DOCUMENT_MISSING fires when the nav-flagged manifest item carries no toc nav", () => {
    const { sink, codes } = collect();
    const encoder = new TextEncoder();
    const entries = [
      ...minimalEpubEntries("<html><body><p>x</p></body></html>", {
        manifestExtra:
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      }),
      [
        "OEBPS/nav.xhtml",
        {
          bytes: encoder.encode("<html><body><p>no nav here</p></body></html>"),
        },
      ] as [string, { bytes: Uint8Array<ArrayBuffer> }],
    ];
    readEpub(zipPackage(entries), { sink });
    expect(codes.has(EpubDiagnosticCodes.NAV_DOCUMENT_MISSING)).toBe(true);
  });

  it("NAV_SPINE_ORDER_MISMATCH fires when the nav's own toc order disagrees with the spine", () => {
    const { sink, codes } = collect();
    const encoder = new TextEncoder();
    const entries = [
      ...minimalEpubEntries("<html><body><p>x</p></body></html>", {
        manifestExtra:
          '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      }),
      [
        "OEBPS/nav.xhtml",
        {
          bytes: encoder.encode(
            '<html xmlns:epub="urn"><body><nav epub:type="toc"><ol><li><a href="other.xhtml">Other</a></li></ol></nav></body></html>',
          ),
        },
      ] as [string, { bytes: Uint8Array<ArrayBuffer> }],
    ];
    const tree = readEpub(zipPackage(entries), { sink });
    expect(codes.has(EpubDiagnosticCodes.NAV_SPINE_ORDER_MISMATCH)).toBe(true);
    expect(tree.source?.nav).toBeDefined();
  });

  it("NCX_MISSING fires when the spine's toc attribute resolves to no real part", () => {
    const { sink, codes } = collect();
    readEpubContent(
      zipPackage(
        minimalEpubEntries("<html><body><p>x</p></body></html>", {
          ncxItem: true,
        }),
      ),
      { sink },
    );
    expect(codes.has(EpubDiagnosticCodes.NCX_MISSING)).toBe(true);
  });

  it("METADATA_FIELD_UNMAPPED fires for dc:publisher/dc:contributor/dc:rights", () => {
    const { sink, codes } = collect();
    const encoder = new TextEncoder();
    const opf = `<package xmlns="http://www.idpf.org/2007/opf">
      <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:publisher>P</dc:publisher></metadata>
      <manifest><item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/></manifest>
      <spine><itemref idref="c1"/></spine>
    </package>`;
    const entries: [
      string,
      { bytes: Uint8Array<ArrayBuffer>; stored?: boolean },
    ][] = [
      ["mimetype", { bytes: encoder.encode(EPUB_MIME_TYPE), stored: true }],
      [
        "META-INF/container.xml",
        {
          bytes: encoder.encode(
            '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
          ),
        },
      ],
      ["OEBPS/content.opf", { bytes: encoder.encode(opf) }],
      [
        "OEBPS/chapter1.xhtml",
        { bytes: encoder.encode("<html><body><p>x</p></body></html>") },
      ],
    ];
    readEpubContent(zipPackage(entries), { sink });
    expect(codes.has(EpubDiagnosticCodes.METADATA_FIELD_UNMAPPED)).toBe(true);
  });

  it("IMAGE_UNRESOLVED / ELEMENT_UNMAPPED / STYLE_RESIDUE / LINK_TARGET_EXTERNAL_ONLY fire from XHTML content", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      '<html xmlns:epub="urn"><head><style>p{color:red}</style></head><body><p>x<sup>2</sup></p><p><img src="missing.png" alt="a"/></p><p><a href="chapter2.xhtml">next</a></p></body></html>',
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.IMAGE_UNRESOLVED)).toBe(true);
    expect(codes.has(EpubDiagnosticCodes.ELEMENT_UNMAPPED)).toBe(true);
    expect(codes.has(EpubDiagnosticCodes.STYLE_RESIDUE)).toBe(true);
    expect(codes.has(EpubDiagnosticCodes.LINK_TARGET_EXTERNAL_ONLY)).toBe(true);
  });

  it("IMAGE_INLINE_UNSUPPORTED fires for an <img> nested inside inline markup", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      '<html><body><p><span><img src="a.png" alt="a"/></span></p></body></html>',
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.IMAGE_INLINE_UNSUPPORTED)).toBe(true);
  });

  it("IMAGE_PRE_UNSUPPORTED fires for an <img> inside a <pre>/<code> block", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      '<html><body><pre>x<img src="a.png" alt="a"/>y</pre></body></html>',
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.IMAGE_PRE_UNSUPPORTED)).toBe(true);
  });

  it("TABLE_CAPTION_UNSUPPORTED fires for a <table>'s own <caption>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><table><caption>Cap</caption><tr><td>x</td></tr></table></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.TABLE_CAPTION_UNSUPPORTED)).toBe(true);
  });

  it("LIST_CONTENT_OUTSIDE_ITEM fires for a <ul>/<ol> nested directly as a sibling of <li>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><ul><li>a</li><ul><li>b</li></ul></ul></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.LIST_CONTENT_OUTSIDE_ITEM)).toBe(true);
  });

  it("DEFINITION_LIST_CONTENT_OUTSIDE_ENTRY fires for a stray <p> sitting directly inside a <dl>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><dl><dt>Term</dt><p>stray</p><dd>Def</dd></dl></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(
      codes.has(EpubDiagnosticCodes.DEFINITION_LIST_CONTENT_OUTSIDE_ENTRY),
    ).toBe(true);
  });

  it("TABLE_ROW_CONTENT_OUTSIDE_CELL fires for stray text sitting directly inside a <tr>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><table><tr>stray<td>x</td></tr></table></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.TABLE_ROW_CONTENT_OUTSIDE_CELL)).toBe(
      true,
    );
  });

  it("TABLE_CONTENT_UNRECOGNIZED fires for a stray <p> sitting directly inside a <table>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><table><p>stray</p><tr><td>x</td></tr></table></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.TABLE_CONTENT_UNRECOGNIZED)).toBe(
      true,
    );
  });

  it("TABLE_DUPLICATE_CAPTION fires for a <table> carrying a second <caption>", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      "<html><body><table><caption>One</caption><caption>Two</caption><tr><td>x</td></tr></table></body></html>",
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.TABLE_DUPLICATE_CAPTION)).toBe(true);
  });

  it("IMAGE_FORMAT_UNSUPPORTED fires for a resolved but non-PNG/JPEG image", () => {
    const { sink, codes } = collect();
    readXhtmlBody('<html><body><img src="a.gif" alt="a"/></body></html>', {
      resolveImage: () => new Uint8Array([0x47, 0x49, 0x46, 0x38]),
      sink,
      sourceHref: "chapter1.xhtml",
      contentWidthPt: CONTENT_WIDTH_PT,
    });
    expect(codes.has(EpubDiagnosticCodes.IMAGE_FORMAT_UNSUPPORTED)).toBe(true);
  });

  it("FOOTNOTE_TARGET_UNRESOLVED fires for a footnote aside with no id", () => {
    const { sink, codes } = collect();
    readXhtmlBody(
      '<html xmlns:epub="urn"><body><aside epub:type="footnote"><p>x</p></aside></body></html>',
      {
        resolveImage: () => undefined,
        sink,
        sourceHref: "chapter1.xhtml",
        contentWidthPt: CONTENT_WIDTH_PT,
      },
    );
    expect(codes.has(EpubDiagnosticCodes.FOOTNOTE_TARGET_UNRESOLVED)).toBe(
      true,
    );
  });

  it("CONSTRUCT_UNREPRESENTED fires for a construct kind the writer has no XHTML spelling for", () => {
    const { sink, codes } = collect();
    writeEpubContent(
      {
        kind: "wordprocessing",
        metadata: {},
        sections: [
          {
            pageSize: { widthPt: 595.28, heightPt: 841.89 },
            margins: { topPt: 72, rightPt: 72, bottomPt: 72, leftPt: 72 },
            blocks: [
              {
                kind: "constructStart",
                descriptor: { kind: "field", instruction: "PAGE" },
              },
              { kind: "paragraph", runs: [{ text: "1" }] },
              { kind: "constructEnd" },
            ],
          },
        ],
      },
      { sink },
    );
    expect(codes.has(EpubDiagnosticCodes.CONSTRUCT_UNREPRESENTED)).toBe(true);
  });

  it("covers the whole EpubDiagnosticCodes table -- no entry is left unreachable", () => {
    const allCodes = Object.values(EpubDiagnosticCodes);
    for (const code of allCodes) {
      expect(
        reached.has(code),
        `${code} was never fired by any test above`,
      ).toBe(true);
    }
  });
});
