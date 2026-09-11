#!/usr/bin/env node
// Generates this package's gitignored real-producer .doc corpus under test/corpus/, ready for `pnpm test:corpus`. The producer is LibreOffice's own MS Word 97 export filter: each fixture is authored as a flat-ODT source (construct-spanning, the constructs this package's reader documents itself as reading) and converted headlessly through `soffice --convert-to doc`, so every corpus file is genuine application output rather than hand-built bytes. Run from the package root: `node scripts/generate-corpus.mjs` (requires soffice at /opt/homebrew/bin/soffice or SOFFICE in the environment; replaces this generator's own outputs -- its fixtures, manifest.json and corpus.test.ts at the test/corpus/ root -- while leaving sibling corpus layers such as fetch-word-corpus.mjs's own test/corpus/word/ untouched). The generated corpus.test.ts carries each fixture's expectations -- authored beside the fixture's construction here, so the generator is the single source of truth for both. What this corpus is and is not is stated in the README: a real producer's Word 97 spelling, not Word 1997-2007 itself, which fetch-word-corpus.mjs's own layer supplies.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "test", "corpus");
const soffice = process.env.SOFFICE ?? "/opt/homebrew/bin/soffice";

// A 2x2 solid-red PNG (CRC-correct -- LibreOffice's libpng rejects a bad IHDR CRC by silently dropping the picture, which the first draft of this constant did).
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";

const NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/"';

const FIXTURES = [
  {
    name: "plain",
    body: "<text:p>Corpus plain paragraph.</text:p>",
    expect: {
      text: ["Corpus plain paragraph."],
    },
  },
  {
    name: "runs",
    body:
      "<text:p>" +
      '<text:span text:style-name="B">bold run</text:span> and ' +
      '<text:span text:style-name="I">italic run</text:span> and ' +
      '<text:span text:style-name="U">underlined run</text:span>' +
      "</text:p>",
    expect: {
      runs: [
        { text: "bold run", bold: true },
        { text: "italic run", italic: true },
        { text: "underlined run", underline: true },
      ],
    },
  },
  {
    name: "headings",
    body:
      '<text:h text:outline-level="1">Chapter One</text:h>' +
      '<text:h text:outline-level="2">Section A</text:h>' +
      "<text:p>Body under the section.</text:p>",
    expect: {
      headings: [
        { text: "Chapter One", level: 1 },
        { text: "Section A", level: 2 },
      ],
    },
  },
  {
    name: "lists",
    body:
      '<text:list text:style-name="L1"><text:list-item><text:p>bullet one</text:p></text:list-item><text:list-item><text:p>bullet two</text:p></text:list-item></text:list>' +
      '<text:list text:style-name="L2"><text:list-item><text:p>step one</text:p></text:list-item><text:list-item><text:p>step two</text:p></text:list-item></text:list>',
    expect: {
      listItems: ["bullet one", "bullet two", "step one", "step two"],
    },
  },
  {
    name: "table",
    body:
      '<table:table table:name="T1">' +
      "<table:table-column/><table:table-column/><table:table-column/>" +
      "<table:table-row>" +
      "<table:table-cell><text:p>alpha</text:p></table:table-cell>" +
      '<table:table-cell table:number-columns-spanned="2"><text:p>wide</text:p></table:table-cell>' +
      "<table:covered-table-cell/>" +
      "</table:table-row>" +
      "<table:table-row>" +
      "<table:table-cell><text:p>beta</text:p></table:table-cell>" +
      "<table:table-cell><text:p>gamma</text:p></table:table-cell>" +
      "<table:table-cell><text:p>delta</text:p></table:table-cell>" +
      "</table:table-row>" +
      "</table:table>",
    expect: {
      tables: [
        {
          rows: 2,
          cells: ["alpha", "wide", "beta", "gamma", "delta"],
          colSpanAt: { row: 0, cell: 1, span: 2 },
        },
      ],
    },
  },
  {
    name: "image",
    // Writer's import drops a draw:image carrying office:binary-data from a FLAT source (Calc accepts the same spelling), so this fixture's source is a minimal packaged .odt with the picture as a real media entry -- see packageOdt below.
    packagedMedia: { name: "Pictures/img.png", base64: TINY_PNG },
    body:
      "<text:p>Before the picture.</text:p>" +
      "<text:p>" +
      '<draw:frame draw:name="I1" text:anchor-type="as-char" svg:width="1cm" svg:height="1cm"><draw:image xlink:href="Pictures/img.png" xlink:type="simple"/></draw:frame>' +
      "</text:p>" +
      "<text:p>After the picture.</text:p>",
    expect: {
      text: ["Before the picture.", "After the picture."],
      images: 1,
    },
  },
  {
    name: "sections",
    body:
      "<text:p>First section body.</text:p>" +
      '<text:section text:name="S2"><text:p>Second section body.</text:p></text:section>',
    expect: {
      text: ["First section body.", "Second section body."],
    },
  },
  {
    name: "mixed",
    body:
      '<text:h text:outline-level="1">Mixed Chapter</text:h>' +
      '<text:p><text:span text:style-name="B">Weighted</text:span> lead-in.</text:p>' +
      '<text:list text:style-name="L1"><text:list-item><text:p>mixed bullet</text:p></text:list-item></text:list>' +
      "<text:p>Tail paragraph.</text:p>",
    expect: {
      headings: [{ text: "Mixed Chapter", level: 1 }],
      runs: [{ text: "Weighted", bold: true }],
      listItems: ["mixed bullet"],
      text: [
        "Mixed Chapter",
        "Weighted lead-in.",
        "mixed bullet",
        "Tail paragraph.",
      ],
    },
  },
];

const AUTOSTYLES =
  " <office:automatic-styles>" +
  '<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>' +
  '<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>' +
  '<style:style style:name="U" style:family="text"><style:text-properties style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"/></style:style>' +
  '<text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:min-label-width="0.5cm"/></text:list-level-style-bullet></text:list-style>' +
  '<text:list-style style:name="L2"><text:list-level-style-number text:level="1" style:num-format="1"><style:list-level-properties text:min-label-width="0.5cm"/></text:list-level-style-number></text:list-style>' +
  " </office:automatic-styles>";

// CRC-32 (IEEE) over one buffer, the zip central-directory spelling needs.
function crc32(bytes) {
  let c = ~0;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

// A minimal STORED (uncompressed) .odt package: mimetype first with no extra fields, then content.xml, the manifest naming the media entry, and the media bytes. Just enough package for Writer to load a picture a flat source cannot carry.
function packageOdt(contentXml, mediaName, mediaBytes) {
  const enc = new TextEncoder();
  const entries = [
    {
      name: "mimetype",
      data: enc.encode("application/vnd.oasis.opendocument.text"),
    },
    { name: "content.xml", data: enc.encode(contentXml) },
    {
      name: "META-INF/manifest.xml",
      data: enc.encode(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
          '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
          '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
          '<manifest:file-entry manifest:full-path="' +
          mediaName +
          '" manifest:media-type="image/png"/></manifest:manifest>',
      ),
    },
    { name: mediaName, data: mediaBytes },
  ];
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const localHeader = new DataView(new ArrayBuffer(30));
    localHeader.setUint32(0, 0x04034b50, true);
    localHeader.setUint16(4, 20, true);
    localHeader.setUint16(6, 0, true);
    localHeader.setUint16(8, 0, true); // stored
    localHeader.setUint16(10, 0, true);
    localHeader.setUint16(12, 0, true);
    localHeader.setUint32(14, crc, true);
    localHeader.setUint32(18, entry.data.length, true);
    localHeader.setUint32(22, entry.data.length, true);
    localHeader.setUint16(26, nameBytes.length, true);
    localHeader.setUint16(28, 0, true);
    chunks.push(new Uint8Array(localHeader.buffer), nameBytes, entry.data);
    central.push({ nameBytes, crc, size: entry.data.length, offset });
    offset += 30 + nameBytes.length + entry.data.length;
  }
  const centralStart = offset;
  for (const e of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint32(16, e.crc, true);
    h.setUint32(20, e.size, true);
    h.setUint32(24, e.size, true);
    h.setUint16(28, e.nameBytes.length, true);
    h.setUint32(42, e.offset, true);
    chunks.push(new Uint8Array(h.buffer), e.nameBytes);
    offset += 46 + e.nameBytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - centralStart, true);
  end.setUint32(16, centralStart, true);
  chunks.push(new Uint8Array(end.buffer));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function fodt(body) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n<office:document ' +
    NS +
    ' office:version="1.3" office:mimetype="application/vnd.oasis.opendocument.text">\n' +
    AUTOSTYLES +
    "\n <office:body><office:text>" +
    body +
    "</office:text></office:body>\n</office:document>"
  );
}

// The corpus harness: reads each converted .doc through this package's own reader and asserts the manifest's expectations against the recovered ContentDocument. Regenerated by the script alongside the fixtures -- the whole test/corpus/ layer is local-only by the family's convention, and the script is the committed source of truth.
const CORPUS_TEST = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocContent } from "../../src/read";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
) as readonly {
  file: string;
  expect: Record<string, unknown>;
}[];

describe("doc corpus (LibreOffice-produced Word 97)", () => {
  for (const { file, expect: e } of MANIFEST) {
    it(file + " reads back what its flat-ODT source authored", () => {
      const bytes = new Uint8Array(
        readFileSync(join(import.meta.dirname, file)),
      );
      const document = readDocContent(bytes);
      if (document.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing document");
      }
      const paragraphs = document.sections.flatMap((s) =>
        s.blocks.filter((b) => b.kind === "paragraph"),
      );
      const blocks = document.sections.flatMap((s) => s.blocks);
      const text = blocks
        .flatMap((b) => (b.kind === "paragraph" ? b.runs.map((r) => r.text) : []))
        .join(" ")
        .replace(/\\s+/g, " ")
        .trim();
      if (Array.isArray(e.text)) {
        for (const needle of e.text as string[]) {
          expect(text).toContain(needle);
        }
      }
      if (Array.isArray(e.runs)) {
        const all = paragraphs.flatMap((b) => (b.kind === "paragraph" ? b.runs : []));
        for (const want of e.runs as { text: string; bold?: boolean; italic?: boolean; underline?: boolean }[]) {
          const run = all.find((r) => r.text === want.text);
          expect(run, "run " + want.text + " recovered").toBeDefined();
          if (want.bold !== undefined) expect(run!.bold ?? false).toBe(want.bold);
          if (want.italic !== undefined) expect(run!.italic ?? false).toBe(want.italic);
          if (want.underline !== undefined) expect(run!.underline ?? false).toBe(want.underline);
        }
      }
      if (Array.isArray(e.headings)) {
        const all = blocks.filter(
          (b): b is Extract<typeof b, { kind: "paragraph" }> => b.kind === "paragraph",
        );
        for (const want of e.headings as { text: string; level: number }[]) {
          const heading = all.find(
            (p) => p.runs.map((r) => r.text).join("") === want.text,
          );
          expect(heading, "heading " + want.text).toBeDefined();
          expect(heading!.headingLevel).toBe(want.level);
        }
      }
      if (Array.isArray(e.listItems)) {
        const all = blocks.filter(
          (b): b is Extract<typeof b, { kind: "paragraph" }> => b.kind === "paragraph",
        );
        for (const item of e.listItems as string[]) {
          const para = all.find((p) => p.runs.map((r) => r.text).join("") === item);
          expect(para, "list item " + item).toBeDefined();
          expect(para!.list).toBeDefined();
        }
      }
      if (Array.isArray(e.tables)) {
        const tables = blocks.filter(
          (b): b is Extract<typeof b, { kind: "table" }> => b.kind === "table",
        );
        expect(tables).toHaveLength((e.tables as unknown[]).length);
        for (const [ti, want] of (e.tables as { rows: number; cells: string[]; colSpanAt?: { row: number; cell: number; span: number } }[]).entries()) {
          const table = tables[ti]!;
          expect(table.rows).toHaveLength(want.rows);
          const cells = table.rows.flatMap((r) => r.cells);
          expect(cells.map((c) => c.blocks.map((b) => (b.kind === "paragraph" ? b.runs.map((r) => r.text).join("") : "")).join(""))).toEqual(want.cells);
          if (want.colSpanAt !== undefined) {
            expect(table.rows[want.colSpanAt.row]!.cells[want.colSpanAt.cell]!.colSpan).toBe(want.colSpanAt.span);
          }
        }
      }
      if (typeof e.images === "number") {
        const images = blocks.filter(
          (b) => b.kind === "image",
        );
        expect(images).toHaveLength(e.images);
      }
    });
  }
});
`;

// Clear only this generator's own outputs rather than the whole of test/corpus/, which is also home to fetch-word-corpus.mjs's own test/corpus/word/ layer -- wiping wholesale would destroy that neighbour on every regeneration.
rmSync(join(outDir, ".staging"), { recursive: true, force: true });
for (const fixture of FIXTURES) {
  rmSync(join(outDir, fixture.name + ".doc"), { force: true });
}
rmSync(join(outDir, "manifest.json"), { force: true });
rmSync(join(outDir, "corpus.test.ts"), { force: true });
mkdirSync(outDir, { recursive: true });
const staging = join(outDir, ".staging");
mkdirSync(staging, { recursive: true });

const manifest = [];
for (const fixture of FIXTURES) {
  const src = join(
    staging,
    fixture.name + (fixture.packagedMedia === undefined ? ".fodt" : ".odt"),
  );
  if (fixture.packagedMedia === undefined) {
    writeFileSync(src, fodt(fixture.body));
  } else {
    // The packaged source's content.xml uses the document-content root and carries the manifest-named media the frame points at.
    const contentXml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      "<office:document-content " +
      NS +
      ' office:version="1.3"><office:body><office:text>' +
      fixture.body +
      "</office:text></office:body></office:document-content>";
    const media = Buffer.from(fixture.packagedMedia.base64, "base64");
    writeFileSync(
      src,
      packageOdt(contentXml, fixture.packagedMedia.name, media),
    );
  }
  execFileSync(
    soffice,
    [
      "--headless",
      "--norestore",
      "--convert-to",
      "doc",
      "--outdir",
      staging,
      src,
    ],
    { stdio: "pipe" },
  );
  rmSync(src, { force: true });
  const converted = join(staging, fixture.name + ".doc");
  writeFileSync(join(outDir, fixture.name + ".doc"), readFileSync(converted));
  manifest.push({ file: fixture.name + ".doc", expect: fixture.expect });
}
rmSync(staging, { recursive: true, force: true });

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "corpus.test.ts"), CORPUS_TEST);
console.log("doc corpus: " + manifest.length + " fixtures under test/corpus/");
