import { describe, expect, it } from "vitest";
import {
  CONTENT_TYPE,
  docx,
  NS,
  paragraph,
  picture,
  table,
  textBox,
  zipParts,
  type DocxSpec,
  type PackagePart,
} from "../test-support/content-projection";
import { compareProjections } from "./compare-projections";
import { listOpcParts, readOpcPart } from "./opc-package";
import { projectDocxContent } from "./project-docx";

const BUDGET = 2 ** 30;
const project = async (bytes: Uint8Array) =>
  projectDocxContent(bytes, { memoryBudgetBytes: BUDGET });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const INTRO = paragraph("Intro words here");
const ROW_ONE = ["cell one", "cell two"] as const;
const ROW_TWO = ["row two", "x"] as const;
const TABLE = table([ROW_ONE, ROW_TWO]);
const HEADER = paragraph("running header");
const FOOTNOTE = `<w:footnote w:id="1">${paragraph("footnote text")}</w:footnote>`;
const COMMENT = `<w:comment w:id="0">${paragraph("review comment")}</w:comment>`;

const BASE: DocxSpec = {
  body: INTRO + TABLE + picture("rId5") + textBox("boxed text"),
  header: HEADER,
  footer: paragraph("page footer"),
  footnotes: FOOTNOTE,
  comments: COMMENT,
  chartValues: ["Q1", "Q2"],
  media: { "image1.png": PNG },
};

async function compare(original: DocxSpec, rewrite: DocxSpec) {
  return compareProjections(
    await project(docx(original)),
    await project(docx(rewrite)),
  );
}

function withPart(
  bytes: Uint8Array,
  name: string,
  content: string,
): Uint8Array {
  return zipParts(
    listOpcParts(bytes).map((entry): PackagePart => ({
      name: entry.name,
      content: entry.name === name ? content : readOpcPart(bytes, entry.name),
    })),
  );
}

describe("projectDocxContent", () => {
  it("files words under the part's category and counts element families", async () => {
    const projection = await project(docx(BASE));
    expect(projection.format).toBe("docx");
    expect(projection.units.get("body")).toEqual(
      new Map([
        ["Intro", 1],
        ["words", 1],
        ["here", 1],
        ["cell", 2],
        ["one", 1],
        ["two", 2],
        ["row", 1],
        ["x", 1],
      ]),
    );
    expect(projection.units.get("headers-footers")?.get("running")).toBe(1);
    expect(projection.units.get("notes")?.get("footnote")).toBe(1);
    expect(projection.units.get("comments")?.get("review")).toBe(1);
    expect(projection.units.get("charts")?.get("Q1")).toBe(1);
    expect(projection.census.get("body")?.get("tr")).toBe(2);
    expect(projection.census.get("body")?.get("tc")).toBe(4);
    expect(projection.census.get("body")?.get("blip")).toBe(1);
    expect(projection.census.get("notes")?.get("footnote")).toBe(1);
    expect(projection.census.get("comments")?.get("comment")).toBe(1);
  });

  it("files text-box text under drawings and counts it once, not again for the legacy fallback branch", async () => {
    const projection = await project(docx(BASE));
    expect(projection.units.get("drawings")?.get("boxed")).toBe(1);
    expect(projection.units.get("body")?.has("boxed")).toBe(false);
    expect(projection.census.get("body")?.get("txbxContent")).toBe(1);
  });

  it("gathers words per paragraph, so a different split into runs changes nothing", async () => {
    const split = await project(
      docx({
        body: "<w:p><w:r><w:t>Hel</w:t></w:r><w:r><w:t>lo wor</w:t></w:r><w:r><w:t>ld</w:t></w:r></w:p>",
      }),
    );
    const whole = await project(docx({ body: paragraph("Hello world") }));
    expect(split.units.get("body")).toEqual(whole.units.get("body"));
  });

  it("reads tabs and breaks as word separators", async () => {
    const projection = await project(
      docx({
        body: "<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>",
      }),
    );
    expect([...(projection.units.get("body")?.keys() ?? [])]).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("counts deleted tracked text and equation text as words and field codes only in the census", async () => {
    const projection = await project(
      docx({
        body: `<w:p><w:del><w:r><w:delText>struck</w:delText></w:r></w:del></w:p><w:p><m:oMath><m:r><m:t>xy</m:t></m:r></m:oMath></w:p><w:p><w:r><w:instrText> HYPERLINK "x" </w:instrText></w:r></w:p>`,
      }),
    );
    const words = projection.units.get("body");
    expect(words?.has("struck")).toBe(true);
    expect(words?.has("xy")).toBe(true);
    expect(words?.has("HYPERLINK")).toBe(false);
    expect(projection.census.get("body")?.get("instrText")).toBe(1);
    expect(projection.census.get("body")?.get("oMath")).toBe(1);
  });

  it("reads the Strict namespaces exactly as the Transitional ones", async () => {
    const strict = docx({
      body: INTRO,
      rootNamespaces: `xmlns:w="http://purl.oclc.org/ooxml/wordprocessingml/main" xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"`,
    });
    const transitional = docx({ body: INTRO });
    expect((await project(strict)).units.get("body")).toEqual(
      (await project(transitional)).units.get("body"),
    );
    expect((await project(strict)).census).toEqual(
      (await project(transitional)).census,
    );
  });

  it("hashes media by content and lists parts of kinds it does not read, digits normalised", async () => {
    const projection = await project(
      docx({
        body: INTRO,
        media: { "image1.png": PNG },
        extraParts: [
          { name: "customXml/item1.xml", content: "<d/>" },
          { name: "customXml/itemProps1.xml", content: "<p/>" },
          { name: "word/vbaProject.bin", content: new Uint8Array([1]) },
          {
            name: "word/embeddings/oleObject1.bin",
            content: new Uint8Array([2]),
          },
        ],
        extraOverrides: { "word/vbaProject.bin": CONTENT_TYPE.vba },
      }),
    );
    expect(
      [...projection.media.keys()]
        .map((key) => key.split(":")[0])
        .sort((a, b) => (a ?? "").localeCompare(b ?? "")),
    ).toEqual(["embedding", "image"]);
    expect(projection.unmodelledParts).toEqual([
      "customXml/itemN.xml",
      "word/vbaProject.bin",
    ]);
  });

  it("skips a part that is not well-formed, contributes none of its text, and says why without quoting it", async () => {
    const broken = withPart(
      docx({ body: INTRO }),
      "word/document.xml",
      `<w:document xmlns:w="${NS.w}"><w:body><w:p><w:r><w:t>SENTINEL</w:t></w:r></w:p><w:p></w:body></w:document>`,
    );
    const projection = await project(broken);
    expect(projection.skippedParts).toEqual([
      { name: "word/document.xml", reason: "unparsed:XmlScanError" },
    ]);
    expect(projection.units.has("body")).toBe(false);
    expect(JSON.stringify(projection.skippedParts)).not.toContain("SENTINEL");
  });

  it("skips a part carrying a document type declaration instead of reading around it", async () => {
    const hostile = withPart(
      docx({ body: INTRO }),
      "word/document.xml",
      `<!DOCTYPE d [<!ENTITY e "hidden">]><w:document xmlns:w="${NS.w}"><w:body>${paragraph("&e;")}</w:body></w:document>`,
    );
    expect((await project(hostile)).skippedParts).toEqual([
      { name: "word/document.xml", reason: "unparsed:XmlDoctypeError" },
    ]);
  });

  it("skips parts the memory budget does not cover and reads none of them", async () => {
    const projection = await projectDocxContent(docx(BASE), {
      memoryBudgetBytes: 1,
    });
    expect(projection.skippedParts.length).toBeGreaterThan(0);
    expect(
      projection.skippedParts.every(
        (part) => part.reason === "exceeds-memory-budget",
      ),
    ).toBe(true);
    expect(projection.units.size).toBe(0);
  });
});

describe("a clean rewrite is silent", () => {
  it("finds nothing in an identical package", async () => {
    const comparison = await compare(BASE, BASE);
    expect(comparison.findings).toEqual([]);
    expect(comparison.verdict).toBe("equivalent");
  });

  it("finds nothing across container, serialiser and prefix noise", async () => {
    const original = docx(BASE);
    const noisy = zipParts(
      listOpcParts(original).map((entry): PackagePart => {
        const bytes = readOpcPart(original, entry.name);
        if (entry.name !== "word/document.xml") {
          return { name: entry.name, content: bytes };
        }
        const text = new TextDecoder()
          .decode(bytes)
          .replaceAll("<w:", "<x:")
          .replaceAll("</w:", "</x:")
          .replaceAll("xmlns:w=", "xmlns:x=")
          .replace("Intro words here", "&#73;ntro &#x77;ords here")
          .replaceAll("/>", " />");
        return { name: entry.name, content: text };
      }),
      { reverse: true, store: true, mtime: new Date(Date.UTC(2030, 0, 1)) },
    );
    const comparison = compareProjections(
      await project(original),
      await project(noisy),
    );
    expect(comparison.findings).toEqual([]);
    expect(comparison.verdict).toBe("equivalent");
  });

  it("finds nothing when only identifiers, revision stamps and properties differ", async () => {
    const left = docx({
      ...BASE,
      creator: "Ada",
      body: `<w:p w:rsidR="0001"><w:r><w:t>Same</w:t></w:r></w:p>`,
    });
    const right = docx({
      ...BASE,
      creator: "Grace",
      body: `<w:p w:rsidR="0002" w14:paraId="7"><w:r><w:t>Same</w:t></w:r></w:p>`,
      rootNamespaces: `xmlns:w="${NS.w}" xmlns:w14="urn:w14" xmlns:r="${NS.r}" xmlns:a="${NS.a}" xmlns:wp="${NS.wp}" xmlns:pic="${NS.pic}" xmlns:mc="${NS.mc}" xmlns:wps="${NS.wps}" xmlns:v="${NS.v}" xmlns:m="${NS.m}"`,
    });
    const comparison = compareProjections(
      await project(left),
      await project(right),
    );
    expect(comparison.verdict).toBe("equivalent");
  });
});

describe("each simulated loss is caught and attributed", () => {
  it("a dropped paragraph", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      body: BASE.body.replace(INTRO, ""),
    });
    expect(comparison.units.get("body")).toEqual({
      original: 10,
      missing: 3,
      extra: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:p",
      count: 1,
      class: "loss",
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped table row", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      body: BASE.body.replace(TABLE, table([ROW_ONE])),
    });
    expect(comparison.units.get("body")?.missing).toBe(3);
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:tr",
      count: 1,
      class: "loss",
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:tc",
      count: 2,
      class: "loss",
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped empty table row, which holds no words at all", async () => {
    const withEmptyRow = {
      ...BASE,
      body: BASE.body.replace(TABLE, table([ROW_ONE, ROW_TWO, ["", ""]])),
    };
    const comparison = await compare(withEmptyRow, BASE);
    expect(comparison.units.get("body")?.missing).toBe(0);
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:tr",
      count: 1,
      class: "loss",
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped footnote", async () => {
    const comparison = await compare(BASE, { ...BASE, footnotes: "" });
    expect(comparison.units.get("notes")).toEqual({
      original: 2,
      missing: 2,
      extra: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "notes:footnote",
      count: 1,
      class: "loss",
    });
  });

  it("a dropped comment", async () => {
    const comparison = await compare(BASE, { ...BASE, comments: "" });
    expect(comparison.units.get("comments")).toEqual({
      original: 2,
      missing: 2,
      extra: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "comments:comment",
      count: 1,
      class: "loss",
    });
  });

  it("a dropped image, its picture and its media part together", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      body: BASE.body.replace(picture("rId5"), ""),
      media: {},
    });
    expect(comparison.media).toMatchObject({ original: 1, missing: 1 });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:blip",
      count: 1,
      class: "loss",
    });
    expect(comparison.findings).toContainEqual({
      area: "media",
      subject: "missing",
      count: 1,
      class: "loss",
    });
  });

  it("a dropped media part whose picture markup survives", async () => {
    const comparison = await compare(BASE, { ...BASE, media: {} });
    expect(comparison.census.size).toBe(0);
    expect(comparison.verdict).toBe("loss");
    expect(comparison.findings).toEqual([
      { area: "media", subject: "missing", count: 1, class: "loss" },
    ]);
  });

  it("a dropped header paragraph", async () => {
    const comparison = await compare(BASE, { ...BASE, header: "" });
    expect(comparison.units.get("headers-footers")).toEqual({
      original: 4,
      missing: 2,
      extra: 0,
    });
  });

  it("a dropped text box", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      body: BASE.body.replace(textBox("boxed text"), ""),
    });
    expect(comparison.units.get("drawings")).toEqual({
      original: 2,
      missing: 2,
      extra: 0,
    });
    expect(comparison.findings).toContainEqual({
      area: "census",
      subject: "body:txbxContent",
      count: 1,
      class: "loss",
    });
  });

  it("dropped chart text", async () => {
    const comparison = await compare(BASE, { ...BASE, chartValues: ["Q1"] });
    expect(comparison.units.get("charts")).toEqual({
      original: 2,
      missing: 1,
      extra: 0,
    });
  });

  it("one changed word, with the paragraph count unchanged", async () => {
    const comparison = await compare(BASE, {
      ...BASE,
      body: BASE.body.replace("Intro words here", "Intro word here"),
    });
    expect(comparison.units.get("body")).toEqual({
      original: 10,
      missing: 1,
      extra: 1,
    });
    expect(comparison.verdict).toBe("loss");
  });

  it("a dropped content control, hyperlink and bookmark that held no text of their own", async () => {
    const rich = {
      ...BASE,
      body: `${BASE.body}<w:p><w:bookmarkStart w:id="0" w:name="b"/><w:hyperlink><w:r><w:t>link</w:t></w:r></w:hyperlink><w:sdt><w:sdtContent><w:r><w:t>ctl</w:t></w:r></w:sdtContent></w:sdt></w:p>`,
    };
    const comparison = await compare(rich, {
      ...rich,
      body: `${BASE.body}<w:p><w:r><w:t>link</w:t></w:r><w:r><w:t>ctl</w:t></w:r></w:p>`,
    });
    expect(comparison.units.get("body")?.missing).toBe(0);
    for (const family of ["hyperlink", "sdt", "bookmarkStart"]) {
      expect(comparison.findings).toContainEqual({
        area: "census",
        subject: `body:${family}`,
        count: 1,
        class: "loss",
      });
    }
  });
});

describe("a skipped part makes a clean comparison incomplete, never equivalent", () => {
  it("when both sides skip the same unreadable part", async () => {
    const hostile = (bytes: Uint8Array) =>
      withPart(
        bytes,
        "word/document.xml",
        `<!DOCTYPE d><w:document xmlns:w="${NS.w}"/>`,
      );
    const comparison = compareProjections(
      await project(hostile(docx(BASE))),
      await project(hostile(docx(BASE))),
    );
    expect(comparison.findings).toEqual([]);
    expect(comparison.verdict).toBe("incomplete");
  });
});

describe("an unrelated declaration is not mistaken for text", () => {
  it("does not read a processing instruction or comment as words", async () => {
    const projection = await project(
      docx({
        body: `<w:p><!-- hidden words --><?pi more hidden?><w:r><w:t>shown</w:t></w:r></w:p>`,
      }),
    );
    expect([...(projection.units.get("body")?.keys() ?? [])]).toEqual([
      "shown",
    ]);
  });
});
