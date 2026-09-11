#!/usr/bin/env node
// Downloads this package's gitignored genuine-Word corpus under test/corpus/word/, ready for `pnpm test:corpus`. Every file is a real document saved by Microsoft Word itself -- the producer this package's reader had never been checked against before this corpus existed -- drawn from Apache POI's public test-data set (itself assembled from attachments to real bug reports and, for two files, from public university and orchestra websites). Provenance is verified per file, not assumed, at two tiers: the download must match the sha256 recorded here, the WordDocument stream must open with the 0xA5EC signature every Word Binary File carries, and the effective nFib ([MS-DOC] 2.5.1's "Determining the nFib" rule) must equal the version this manifest records; on top of that, every file stating a producer in this manifest must have the "\x05SummaryInformation" stream's own application-name property say so -- "Microsoft Word 8.0"/"9.0"/"10.0" for the era-explicit files, "Microsoft Office Word" with a .dot template for Word 2003, and "Microsoft Office Word" with a .dotm template for the one Word-2007-or-later compatibility save. The one file whose stream carries no application name at all is recorded at the nFib-only tier and flagged in its own origin note. A file failing any check fails the fetch loudly rather than landing in the corpus unverified. Run from the package root after a build: `pnpm build && node scripts/fetch-word-corpus.mjs` (requires network; writes test/corpus/word/ wholesale, leaving scripts/generate-corpus.mjs's own output beside it untouched).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCompoundFile, readPropertySetStream } from "archive-codec";
import {
  parseFib,
  peekFibBaseFlags,
  readDocContent,
  SUMMARY_INFORMATION_STREAM,
} from "../dist/index.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(packageRoot, "test", "corpus", "word");

// All files are addressed at one pinned POI commit so a fetch is reproducible: the manifest records the commit, not a moving branch.
const POI_COMMIT = "671a20eb38ec9ed1a84cce80483d790000514ba9";
const POI_BASE = `https://raw.githubusercontent.com/apache/poi/${POI_COMMIT}/test-data/document/`;

// The corpus, spanning Word 97 through Word 2003 plus one Word-2007-or-later compatibility save. `producer` is the verified in-file evidence; `origin` is where POI's copy of the file came from, recorded for provenance (a POI bug-report attachment, or the public website two files were fetched from).
const MANIFEST = [
  {
    file: "empty.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a blank document saved by Word 97",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "5f421a3970c70f12296073478380c0849a54c03fb2f4842392c7d3c5039bf1eb",
    expect: { sections: 1, needles: [] },
  },
  {
    file: "simple.doc",
    origin:
      "Apache POI test-data (bug-report attachment); self-describes as 'created with Word 97-SR2'",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "4876e828e62d490fa188c7c4e47013e2e0dfdf02f5903dfd374bc0d2b2049ca1",
    expect: {
      sections: 1,
      needles: ["This is a simple file created with Word 97-SR2."],
    },
  },
  {
    file: "simple-list.doc",
    origin: "Apache POI test-data (bug-report attachment)",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "666f851727aeb9013d34586fe3ab5df687a36108ca3eb2ba193954cbd084be70",
    expect: {
      sections: 1,
      needles: ["First item in list", "Second item in list"],
    },
  },
  {
    file: "simple-table.doc",
    origin: "Apache POI test-data (bug-report attachment)",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "67d7fe8e0555c16516354498a5935f24eeef90beb5efbf526f93a1d6c734da43",
    expect: {
      sections: 1,
      tablesAtLeast: 1,
      needles: ["Cell 1,1", "Cell 2,3"],
    },
  },
  {
    file: "AIOOB-Tap.doc",
    origin:
      "Apache POI test-data (bug-report attachment); Dutch government process forms",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "17d6b1596f539c53f06f3c84402b63bb13c38dcea14c2f71d87b87da925d2a01",
    expect: {
      sections: 1,
      tablesAtLeast: 4,
      needles: ["Bezwaar tegen inningsbesluiten"],
    },
  },
  {
    file: "saved-by-table.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a UK-published Iraq dossier",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "3081ba08abc538c9bdab871fb1d7e2ef7930d12412c3b3b72bda233983c31351",
    expect: {
      sections: 2,
      needles: ["IRAQ", "INFRASTRUCTURE OF CONCEALMENT"],
    },
  },
  {
    file: "Bug50936_3.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 50936); a French internship report",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "0b67898da842acf53824eb6fb025da7701d7a307ff478e6714ce5f7ccc546c39",
    expect: {
      sections: 1,
      tablesAtLeast: 3,
      needles: ["MULTIMEDIA SOLUTIONS", "Table des matières"],
    },
  },
  {
    file: "HeaderFooterProblematic.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a UK Statement of Insolvency Practice. Carries Word 97's placeholder Plcfhdd CPs (-1 entries, and one past ccpHdd), which this package now normalises rather than refusing",
    producer: { nFib: 0x00c1, appName: "Microsoft Word 8.0" },
    sha256: "cd28e07f2496a91c4dabf1bb9201beb1744b164266f868210c4c2c0d235dacd5",
    expect: {
      sections: 1,
      tablesAtLeast: 1,
      needles: ["STATEMENT OF INSOLVENCY PRACTICE"],
    },
  },
  {
    file: "53379.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 53379); UK Medicines Control Agency workshop guidance",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "3744731bc3e7869b4fc968a78d46a3e82f3ee85fd7e6599430558aef4eab88b8",
    expect: {
      sections: 8,
      tablesAtLeast: 4,
      needles: ["MEDICINES CONTROL AGENCY"],
    },
  },
  {
    file: "Bug53380_1.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 53380); UK MHRA guidance notes",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "d7673aa3afa6ace77b4fed0a77d3437b53623bd56275d97c54c03a0f08653db1",
    expect: {
      sections: 1,
      tablesAtLeast: 4,
      needles: ["CONTACT INFORMATION"],
    },
  },
  {
    file: "parentinvguid.doc",
    origin:
      "Apache POI test-data (bug-report attachment); US Department of Education non-regulatory guidance",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "1759d6fa68a1ab33b8d59d14e9a9ff040410b09867cb1bfaf298855ba01fcb4c",
    expect: {
      sections: 3,
      tablesAtLeast: 1,
      needles: ["Parental Involvement", "TABLE OF CONTENTS"],
    },
  },
  {
    file: "ListEntryNoListTable.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a list whose entries reference a list definition beyond the document's PlfLfo -- the shape the issue naming it tracked",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "bf4b76eeefad70e4ea104f20e6e38ded976a7a95595a650c05a8845def106dcc",
    expect: { sections: 1, needles: ["Coucou"] },
  },
  {
    file: "o_kurs.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a Russian coursework title page. Every body paragraph carries sprmPFInTable with no cell or row mark anywhere -- the not-a-table shape this package now degrades to paragraphs. Carries no \\x05SummaryInformation stream at all, so its producer evidence is its nFib alone (the weaker tier this manifest records where present)",
    producer: { nFib: 0x00d9 },
    sha256: "fd87d25008e5daad8ede2e17976250b1f2dd519102f32135af0a29cbf0789685",
    expect: { sections: 1, needles: ["ВЫСШАЯ КОММЕРЧЕСКАЯ ШКОЛА", "Москва"] },
  },
  {
    file: "Bug47958.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 47958); a quote request form",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "7d4aca2632ca8cd66401229f6cadb7813f6859bccc43d9e948b374263ebbc867",
    expect: {
      sections: 2,
      tablesAtLeast: 2,
      needles: ["QUOTE REQUEST FORM"],
    },
  },
  {
    file: "60279.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 60279); a cat-breed standard",
    producer: { nFib: 0x00d9, appName: "Microsoft Word 9.0" },
    sha256: "acd59256eb12abaa3c376e72d33601230edc19aaf343e16d714fe919e70224f9",
    expect: {
      sections: 1,
      needles: ["SCOTTISH", "well-rounded with prominent cheeks"],
    },
  },
  {
    file: "64132.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 64132); a Brazilian institute examination notice",
    producer: { nFib: 0x0101, appName: "Microsoft Word 10.0" },
    sha256: "87ea7aebae96ca6bd458aa8ea532f8753489f78f22cd4b826378756b86e2d614",
    expect: { sections: 1, needles: ["EDITAL"] },
  },
  {
    file: "Bug44603.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 44603); a bare 2x2 table",
    producer: { nFib: 0x0101, appName: "Microsoft Word 10.0" },
    sha256: "b85a58c766c852de3b0e7bb33b4852e3465c3a901f492db2c908fc6bc27488f3",
    expect: { sections: 1, tablesAtLeast: 1, needles: [] },
  },
  {
    file: "Bug52032_1.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 52032); personal details redacted by the reporter",
    producer: { nFib: 0x0101, appName: "Microsoft Word 10.0" },
    sha256: "ff920493f14c128529003d424669ecb79c6250732bbe2ac43a5b82c87e274716",
    expect: { sections: 1, needles: ["June 1, 2007"] },
  },
  {
    file: "vector_image.doc",
    origin:
      "Apache POI test-data (bug-report attachment); an anchored vector drawing -- the reader drops the unsupported blip and keeps the paragraph, which is the documented degrade this pins",
    producer: { nFib: 0x0101, appName: "Microsoft Word 10.0" },
    sha256: "747eb4c44a9ff7ac646f267fad6d4006b596a8beaec211fe27cb67f018800850",
    expect: { sections: 1, needles: [] },
  },
  {
    file: "Bug51890.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 51890); a French Internet Explorer tutorial, its tables interleaved with in-table-flagged separator paragraphs and its row marks split between inline grpprls and sprmPTableProps pointers",
    producer: { nFib: 0x0101, appName: "Microsoft Word 10.0" },
    sha256: "3117015717ef6a2817007c2f3e5a18d88feeda6899a858383ee7d3c353d26795",
    expect: {
      sections: 1,
      tablesAtLeast: 4,
      needles: ["Pour accéder à un favori", "EXERCICE"],
    },
  },
  {
    file: "Bug47742.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 47742); translation-memory source/target pairs",
    producer: {
      nFib: 0x010c,
      appName: "Microsoft Office Word",
      template: "Normal.dot",
    },
    sha256: "1a669e07ed942a41d36cb4249a96916673ed9aa64e7f594736588f76dd6128a4",
    expect: { sections: 1, needles: ["Der Aaa Satz"] },
  },
  {
    file: "FloatingPictures.doc",
    origin:
      "Apache POI test-data (bug-report attachment); a style gallery document with floating pictures, titled 'Sample documents'",
    producer: {
      nFib: 0x010c,
      appName: "Microsoft Office Word",
      template: "Normal.dot",
    },
    sha256: "41cc0cd8f2d7390266f844f5bddbcd29d08ac5338abc33832d9c9a6ed5d0f85d",
    expect: { sections: 2, needles: ["Heading 1", "Courier New"] },
  },
  {
    file: "Bug61268.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 61268); a 3GPP technical report whose seven-column history tables close their rows through sprmPHugePapx -- the indirect row-mark spelling this package now resolves",
    producer: {
      nFib: 0x0112,
      appName: "Microsoft Office Word",
      template: "3gpp_70.dot",
    },
    sha256: "24b47ad892871c80495c64b440c24200dbcaa16c367faf780aec43e3bf8ddae6",
    expect: {
      sections: 2,
      tablesAtLeast: 4,
      needles: ["3GPP", "Public Warning System"],
    },
  },
  {
    file: "two_images.doc",
    origin:
      "Apache POI test-data (bug-report attachment); one JPEG and one PNG inline picture",
    producer: {
      nFib: 0x010c,
      appName: "Microsoft Office Word",
      template: "Normal.dot",
    },
    sha256: "a2c2f835d2ab986ae367a787fcad04c2fa24c5135ae477bf934e7c074895312e",
    expect: {
      sections: 1,
      images: 2,
      needles: ["the jpg file", "the png file"],
    },
  },
  {
    file: "Bug46220.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 46220); four embedded images in a 2x2 table, built on the 'four-images.dot' template",
    producer: {
      nFib: 0x010c,
      appName: "Microsoft Office Word",
      template: "four-images.dot",
    },
    sha256: "0fafe63cd093ae418abbb795c3efb45fa5dd56523179d4aacd46cf075b422338",
    expect: { sections: 1, tablesAtLeast: 1, needles: ["Image 2"] },
  },
  {
    file: "57603-seven_columns.doc",
    origin:
      "Apache POI test-data (attachment to POI issue 57603); an empty seven-column table whose single row mark states its whole TAP through sprmPHugePapx",
    producer: {
      nFib: 0x0112,
      appName: "Microsoft Office Word",
      template: "Normal.dotm",
    },
    sha256: "1e37dac76f3690f88674b44558a73ff447946264250ed41ccb1a25e33b9988ef",
    expect: { sections: 1, tablesAtLeast: 1, needles: [] },
  },
  {
    file: "ca.kwsymphony.www_education_School_Concert_Seat_Booking_Form_2011-12.doc",
    origin:
      "Apache POI test-data, fetched by POI's own web crawl from the Kitchener-Waterloo Symphony's then-public education page (www.kwsymphony.ca, recorded in POI's filename convention)",
    producer: {
      nFib: 0x010c,
      appName: "Microsoft Office Word",
      template: "Normal",
    },
    sha256: "d8edfda1e7403795ea414d289d852ea324429e249aa65f9ec3b21ffbd1b4a802",
    expect: {
      sections: 1,
      tablesAtLeast: 2,
      needles: ["Seat Booking Form"],
    },
  },
  {
    file: "au.edu.utas.www___data_assets_word_doc_0003_154335_International-Travel-Approval-Request-Form.doc",
    origin:
      "Apache POI test-data, fetched by POI's own web crawl from the University of Tasmania's then-public forms page (utas.edu.au, recorded in POI's filename convention)",
    producer: {
      nFib: 0x0112,
      appName: "Microsoft Office Word",
      template: "Normal",
    },
    sha256: "b75b0afb94d942d583f5c0bd71dc85774e5477425bda576ec19b26a66d291112",
    expect: {
      sections: 1,
      tablesAtLeast: 4,
      needles: ["International Travel Approval Request Form"],
    },
  },
];

const NFIB_NAMES = new Map([
  [0x00c1, "Word 97"],
  [0x00d9, "Word 2000"],
  [0x0101, "Word 2002"],
  [0x010c, "Word 2003"],
  [0x0112, "Word 2003"],
]);

async function fetchVerified(entry) {
  const response = await fetch(POI_BASE + entry.file);
  if (!response.ok) {
    throw new Error(`${entry.file}: fetch returned ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== entry.sha256) {
    throw new Error(
      `${entry.file}: sha256 ${sha256} does not match the recorded ${entry.sha256}`,
    );
  }
  const streams = readCompoundFile(bytes);
  const wordDocument = streams.find((stream) => stream.path === "WordDocument");
  if (wordDocument === undefined) {
    throw new Error(`${entry.file}: no WordDocument stream`);
  }
  peekFibBaseFlags(wordDocument.bytes);
  parseFib(wordDocument.bytes);
  // The effective nFib per [MS-DOC]'s own "Determining the nFib" rule: FibBase.nFib when cswNew is 0, FibRgCswNew.nFibNew otherwise -- computed from the raw stream because parseFib surfaces only the base value.
  const wd = wordDocument.bytes;
  const view = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
  const cbRgFcLcb = view.getUint16(152, true);
  const cswNewOffset = 154 + cbRgFcLcb * 8;
  const cswNew = view.getUint16(cswNewOffset, true);
  const effectiveNfib =
    cswNew === 0
      ? view.getUint16(2, true)
      : view.getUint16(cswNewOffset + 2, true);
  if (effectiveNfib !== entry.producer.nFib) {
    throw new Error(
      `${entry.file}: effective nFib 0x${effectiveNfib.toString(16)} does not match the recorded 0x${entry.producer.nFib.toString(16)}`,
    );
  }
  const summary = streams.find(
    (stream) => stream.path === SUMMARY_INFORMATION_STREAM,
  );
  const appName =
    summary === undefined
      ? undefined
      : readPropertySetStream(summary.bytes).properties.get(0x0012);
  const appNameValue =
    appName !== undefined &&
    (appName.type === "VT_LPSTR" || appName.type === "VT_LPWSTR")
      ? appName.value
      : undefined;
  if (
    (entry.producer.appName ?? undefined) !== undefined &&
    appNameValue !== entry.producer.appName
  ) {
    throw new Error(
      `${entry.file}: SummaryInformation application name ${JSON.stringify(appNameValue)} does not match the recorded ${JSON.stringify(entry.producer.appName)}`,
    );
  }
  const document = readDocContent(bytes);
  if (document.sections.length !== entry.expect.sections) {
    throw new Error(
      `${entry.file}: reads ${document.sections.length} sections, expected ${entry.expect.sections}`,
    );
  }
  return bytes;
}

// The corpus harness: reads each verified file through this package's own reader and asserts the manifest's expectations against the recovered ContentDocument. Generated by the fetch script alongside the files -- the whole test/corpus/ layer is local-only by the family's convention, and this script plus its embedded manifest is the committed source of truth.
const CORPUS_TEST = `import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDocContent } from "../../../src/read";

const MANIFEST = JSON.parse(
  readFileSync(join(import.meta.dirname, "manifest.json"), "utf8"),
) as readonly {
  file: string;
  expect: {
    sections: number;
    tablesAtLeast?: number;
    images?: number;
    needles: readonly string[];
  };
}[];

describe("doc corpus (Microsoft-Word-produced Word 97-2003)", () => {
  for (const { file, expect: e } of MANIFEST) {
    it(file + " reads back what its producer wrote", { timeout: 120_000 }, () => {
      const bytes = new Uint8Array(
        readFileSync(join(import.meta.dirname, file)),
      );
      const document = readDocContent(bytes);
      if (document.kind !== "wordprocessing") {
        throw new Error("expected a wordprocessing document");
      }
      expect(document.sections).toHaveLength(e.sections);
      const blocks = document.sections.flatMap((s) => s.blocks);
      const text = collectText(blocks).replace(/\\s+/g, " ");
      for (const needle of e.needles) {
        expect(text).toContain(needle);
      }
      if (e.tablesAtLeast !== undefined) {
        expect(countTables(blocks)).toBeGreaterThanOrEqual(e.tablesAtLeast);
      }
      if (e.images !== undefined) {
        expect(
          blocks.filter((b) => b.kind === "image"),
        ).toHaveLength(e.images);
      }
    });
  }
});

function collectText(blocks: readonly unknown[]): string {
  let out = "";
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    if (b.kind === "paragraph") {
      out += (b.runs as Record<string, unknown>[]).map((r) => r.text).join("");
    } else if (b.kind === "table") {
      for (const row of b.rows as Record<string, unknown>[]) {
        for (const cell of row.cells as Record<string, unknown>[]) {
          out += collectText(cell.blocks as readonly unknown[]);
        }
      }
    }
  }
  return out;
}

function countTables(blocks: readonly unknown[]): number {
  let count = 0;
  for (const block of blocks) {
    const b = block as Record<string, unknown>;
    if (b.kind === "table") {
      count += 1;
      for (const row of b.rows as Record<string, unknown>[]) {
        for (const cell of row.cells as Record<string, unknown>[]) {
          count += countTables(cell.blocks as readonly unknown[]);
        }
      }
    }
  }
  return count;
}
`;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const manifest = [];
for (const entry of MANIFEST) {
  const bytes = await fetchVerified(entry);
  writeFileSync(join(outDir, entry.file), bytes);
  manifest.push({
    file: entry.file,
    producer: {
      version: NFIB_NAMES.get(entry.producer.nFib),
      appName: entry.producer.appName,
      ...(entry.producer.template === undefined
        ? {}
        : { template: entry.producer.template }),
    },
    origin: entry.origin,
    source: POI_BASE + entry.file,
    expect: entry.expect,
  });
}

writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
writeFileSync(join(outDir, "corpus.test.ts"), CORPUS_TEST);
console.log(
  "word corpus: " + manifest.length + " verified files under test/corpus/word/",
);
