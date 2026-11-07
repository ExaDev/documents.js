import { zipSync, type Zippable } from "fflate";

// Hand-built, tiny OPC packages for the content-projection tests. Every part is written out here as a string, so a test can say exactly which construct a fixture holds and which one a simulated loss removes.

const encoder = new TextEncoder();

/** Content types the tests name for extra parts. */
export const CONTENT_TYPE = {
  vba: "application/vnd.ms-office.vbaProject",
  pivotTable:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.pivotTable+xml",
} as const;

export const NS = {
  w: "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  wp: "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
  pic: "http://schemas.openxmlformats.org/drawingml/2006/picture",
  mc: "http://schemas.openxmlformats.org/markup-compatibility/2006",
  wps: "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
  v: "urn:schemas-microsoft-com:vml",
  m: "http://schemas.openxmlformats.org/officeDocument/2006/math",
  s: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  tc: "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments",
  rels: "http://schemas.openxmlformats.org/package/2006/relationships",
  types: "http://schemas.openxmlformats.org/package/2006/content-types",
} as const;

export interface PackagePart {
  readonly name: string;
  readonly content: string | Uint8Array;
}

export interface ZipOptions {
  /** Store instead of deflate. */
  readonly store?: boolean;
  /** Write entries in reverse order. */
  readonly reverse?: boolean;
  readonly mtime?: Date;
}

const DEFAULT_MTIME = new Date(Date.UTC(2001, 1, 3, 4, 6, 8));
const DEFLATE_LEVEL = 6;

/** Zips parts into a package. Order, timestamps and compression are the only things the options change, which is what the container-normalisation tests vary. */
export function zipParts(
  parts: readonly PackagePart[],
  options: ZipOptions = {},
): Uint8Array {
  const ordered = options.reverse === true ? [...parts].reverse() : parts;
  const data: Zippable = {};
  for (const part of ordered) {
    data[part.name] = [
      typeof part.content === "string"
        ? encoder.encode(part.content)
        : part.content,
      {
        level: options.store === true ? 0 : DEFLATE_LEVEL,
        mtime: options.mtime ?? DEFAULT_MTIME,
      },
    ];
  }
  return zipSync(data);
}

const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function xmlPart(name: string, root: string): PackagePart {
  return { name, content: XML_DECLARATION + root };
}

function contentTypes(
  defaults: Record<string, string>,
  overrides: Record<string, string>,
): PackagePart {
  const defaultXml = Object.entries(defaults)
    .map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`)
    .join("");
  const overrideXml = Object.entries(overrides)
    .map(
      ([name, type]) => `<Override PartName="/${name}" ContentType="${type}"/>`,
    )
    .join("");
  return xmlPart(
    "[Content_Types].xml",
    `<Types xmlns="${NS.types}">${defaultXml}${overrideXml}</Types>`,
  );
}

const TYPE = {
  rels: "application/vnd.openxmlformats-package.relationships+xml",
  xml: "application/xml",
  png: "image/png",
  docxMain:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
  docxHeader:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml",
  docxFooter:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml",
  docxFootnotes:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml",
  docxComments:
    "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml",
  chart: "application/vnd.openxmlformats-officedocument.drawingml.chart+xml",
  xlsxMain:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  worksheet:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  sharedStrings:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
  xlsxComments:
    "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml",
  threaded: "application/vnd.ms-excel.threadedcomments+xml",
  drawing: "application/vnd.openxmlformats-officedocument.drawing+xml",
  core: "application/vnd.openxmlformats-package.core-properties+xml",
} as const;

// ---- docx ----

/** A paragraph of one run. */
export function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

/** A table of rows of cell texts; an empty string is an empty cell (a paragraph with no run). */
export function table(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map(
      (cells) =>
        `<w:tr>${cells
          .map(
            (text) =>
              `<w:tc>${text === "" ? "<w:p/>" : paragraph(text)}</w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  return `<w:tbl>${body}</w:tbl>`;
}

/** A paragraph holding an inline picture that points at relationship `rId`. */
export function picture(rId: string): string {
  return `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

/** A paragraph holding a text box in a Markup Compatibility choice, with the legacy VML branch repeating the text as a fallback. */
export function textBox(text: string): string {
  const inner = `<w:txbxContent>${paragraph(text)}</w:txbxContent>`;
  return `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:inline><a:graphic><a:graphicData><wps:wsp><wps:txbx>${inner}</wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></mc:Choice><mc:Fallback><w:pict><v:shape><v:textbox>${inner}</v:textbox></v:shape></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`;
}

export interface DocxSpec {
  /** The children of `w:body`. */
  readonly body: string;
  /** The children of `w:hdr`. */
  readonly header?: string;
  /** The children of `w:ftr`. */
  readonly footer?: string;
  /** The `w:footnote` elements. */
  readonly footnotes?: string;
  /** The `w:comment` elements. */
  readonly comments?: string;
  /** Text for a chart part, as `c:v` values. */
  readonly chartValues?: readonly string[];
  /** Media parts by name (under `word/media/`). */
  readonly media?: Readonly<Record<string, Uint8Array>>;
  /** Parts added as they are. */
  readonly extraParts?: readonly PackagePart[];
  /** Content type overrides for the extra parts, by part name. */
  readonly extraOverrides?: Readonly<Record<string, string>>;
  /** The `docProps/core.xml` creator. */
  readonly creator?: string;
  /** Declared namespace attributes on `w:document`, to vary prefixes. Defaults to the usual `w` prefix set. */
  readonly rootNamespaces?: string;
  readonly zip?: ZipOptions;
}

const DOCX_ROOT_NAMESPACES = `xmlns:w="${NS.w}" xmlns:r="${NS.r}" xmlns:a="${NS.a}" xmlns:wp="${NS.wp}" xmlns:pic="${NS.pic}" xmlns:mc="${NS.mc}" xmlns:wps="${NS.wps}" xmlns:v="${NS.v}" xmlns:m="${NS.m}" mc:Ignorable="wps"`;

/** Assembles a docx package. The parts a spec leaves out are not written. */
export function docx(spec: DocxSpec): Uint8Array {
  const overrides: Record<string, string> = {
    "word/document.xml": TYPE.docxMain,
    "docProps/core.xml": TYPE.core,
  };
  const parts: PackagePart[] = [
    xmlPart(
      "_rels/.rels",
      `<Relationships xmlns="${NS.rels}"><Relationship Id="rId1" Type="${NS.r}/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
    xmlPart(
      "word/document.xml",
      `<w:document ${spec.rootNamespaces ?? DOCX_ROOT_NAMESPACES}><w:body>${spec.body}</w:body></w:document>`,
    ),
    xmlPart(
      "docProps/core.xml",
      `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>${spec.creator ?? "Author"}</dc:creator></cp:coreProperties>`,
    ),
  ];
  const optional: readonly [string, string, string | undefined, string][] = [
    ["word/header1.xml", TYPE.docxHeader, spec.header, "hdr"],
    ["word/footer1.xml", TYPE.docxFooter, spec.footer, "ftr"],
    ["word/footnotes.xml", TYPE.docxFootnotes, spec.footnotes, "footnotes"],
    ["word/comments.xml", TYPE.docxComments, spec.comments, "comments"],
  ];
  for (const [name, type, content, root] of optional) {
    if (content !== undefined) {
      overrides[name] = type;
      parts.push(
        xmlPart(name, `<w:${root} xmlns:w="${NS.w}">${content}</w:${root}>`),
      );
    }
  }
  if (spec.chartValues !== undefined) {
    overrides["word/charts/chart1.xml"] = TYPE.chart;
    parts.push(
      xmlPart(
        "word/charts/chart1.xml",
        `<c:chartSpace xmlns:c="${NS.c}" xmlns:a="${NS.a}"><c:chart><c:plotArea><c:ser><c:cat><c:strRef><c:strCache>${spec.chartValues
          .map(
            (value, index) => `<c:pt idx="${index}"><c:v>${value}</c:v></c:pt>`,
          )
          .join(
            "",
          )}</c:strCache></c:strRef></c:cat></c:ser></c:plotArea></c:chart></c:chartSpace>`,
      ),
    );
  }
  for (const [name, bytes] of Object.entries(spec.media ?? {})) {
    parts.push({ name: `word/media/${name}`, content: bytes });
  }
  parts.push(...(spec.extraParts ?? []));
  return zipParts(
    [
      contentTypes(
        {
          rels: TYPE.rels,
          xml: TYPE.xml,
          png: TYPE.png,
          bin: "application/octet-stream",
        },
        { ...overrides, ...spec.extraOverrides },
      ),
      ...parts,
    ],
    spec.zip,
  );
}

// ---- xlsx ----

export interface CellSpec {
  /** Omitted to exercise implied references. */
  readonly r?: string;
  readonly t?: string;
  readonly v?: string;
  readonly f?: string;
  /** An attribute string for `f`, such as `t="shared" si="0"`. */
  readonly fAttributes?: string;
  readonly inline?: string;
}

export function cell(spec: CellSpec): string {
  const reference = spec.r === undefined ? "" : ` r="${spec.r}"`;
  const type = spec.t === undefined ? "" : ` t="${spec.t}"`;
  const formula =
    spec.f === undefined && spec.fAttributes === undefined
      ? ""
      : `<f${spec.fAttributes === undefined ? "" : ` ${spec.fAttributes}`}>${spec.f ?? ""}</f>`;
  const value = spec.v === undefined ? "" : `<v>${spec.v}</v>`;
  const inline =
    spec.inline === undefined ? "" : `<is><t>${spec.inline}</t></is>`;
  return `<c${reference}${type}>${formula}${value}${inline}</c>`;
}

/** A row; `r` is omitted when undefined to exercise implied row numbers. */
export function row(r: number | undefined, cells: readonly string[]): string {
  return `<row${r === undefined ? "" : ` r="${r}"`}>${cells.join("")}</row>`;
}

export interface SheetSpec {
  readonly name: string;
  /** The children of `sheetData`. */
  readonly rows: string;
  /** Extra worksheet children after `sheetData`, such as `mergeCells`. */
  readonly after?: string;
}

export interface XlsxSpec {
  readonly sheets: readonly SheetSpec[];
  readonly sharedStrings?: readonly string[];
  /** Raw `si` children, to put phonetic runs in. Used instead of `sharedStrings` when set. */
  readonly sharedStringItems?: string;
  readonly definedNames?: readonly string[];
  readonly comments?: readonly string[];
  readonly threadedComments?: readonly string[];
  /** Text for a drawing text box. */
  readonly drawingText?: string;
  readonly chartValues?: readonly string[];
  readonly media?: Readonly<Record<string, Uint8Array>>;
  readonly extraParts?: readonly PackagePart[];
  /** Content type overrides for the extra parts, by part name. */
  readonly extraOverrides?: Readonly<Record<string, string>>;
  readonly zip?: ZipOptions;
}

/** Assembles an xlsx package. */
export function xlsx(spec: XlsxSpec): Uint8Array {
  const overrides: Record<string, string> = {
    "xl/workbook.xml": TYPE.xlsxMain,
  };
  const parts: PackagePart[] = [
    xmlPart(
      "_rels/.rels",
      `<Relationships xmlns="${NS.rels}"><Relationship Id="rId1" Type="${NS.r}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
  ];
  const sheetElements = spec.sheets
    .map(
      (sheet, index) =>
        `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join("");
  const definedNames =
    spec.definedNames === undefined
      ? ""
      : `<definedNames>${spec.definedNames.join("")}</definedNames>`;
  parts.push(
    xmlPart(
      "xl/workbook.xml",
      `<workbook xmlns="${NS.s}" xmlns:r="${NS.r}"><sheets>${sheetElements}</sheets>${definedNames}</workbook>`,
    ),
    xmlPart(
      "xl/_rels/workbook.xml.rels",
      `<Relationships xmlns="${NS.rels}">${spec.sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="${NS.r}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join("")}</Relationships>`,
    ),
  );
  spec.sheets.forEach((sheet, index) => {
    const name = `xl/worksheets/sheet${index + 1}.xml`;
    overrides[name] = TYPE.worksheet;
    parts.push(
      xmlPart(
        name,
        `<worksheet xmlns="${NS.s}"><sheetData>${sheet.rows}</sheetData>${sheet.after ?? ""}</worksheet>`,
      ),
    );
  });
  if (
    spec.sharedStrings !== undefined ||
    spec.sharedStringItems !== undefined
  ) {
    overrides["xl/sharedStrings.xml"] = TYPE.sharedStrings;
    const items =
      spec.sharedStringItems ??
      (spec.sharedStrings ?? [])
        .map((text) => `<si><t>${text}</t></si>`)
        .join("");
    parts.push(
      xmlPart("xl/sharedStrings.xml", `<sst xmlns="${NS.s}">${items}</sst>`),
    );
  }
  if (spec.comments !== undefined) {
    overrides["xl/comments1.xml"] = TYPE.xlsxComments;
    parts.push(
      xmlPart(
        "xl/comments1.xml",
        `<comments xmlns="${NS.s}"><commentList>${spec.comments
          .map(
            (text) =>
              `<comment ref="A1"><text><r><t>${text}</t></r></text></comment>`,
          )
          .join("")}</commentList></comments>`,
      ),
    );
  }
  if (spec.threadedComments !== undefined) {
    overrides["xl/threadedComments/threadedComment1.xml"] = TYPE.threaded;
    parts.push(
      xmlPart(
        "xl/threadedComments/threadedComment1.xml",
        `<ThreadedComments xmlns="${NS.tc}">${spec.threadedComments
          .map(
            (text) =>
              `<threadedComment ref="A1" id="{1}"><text>${text}</text></threadedComment>`,
          )
          .join("")}</ThreadedComments>`,
      ),
    );
  }
  if (spec.drawingText !== undefined) {
    overrides["xl/drawings/drawing1.xml"] = TYPE.drawing;
    parts.push(
      xmlPart(
        "xl/drawings/drawing1.xml",
        `<xdr:wsDr xmlns:xdr="${NS.xdr}" xmlns:a="${NS.a}"><xdr:twoCellAnchor><xdr:sp><xdr:txBody><a:p><a:r><a:t>${spec.drawingText}</a:t></a:r></a:p></xdr:txBody></xdr:sp></xdr:twoCellAnchor></xdr:wsDr>`,
      ),
    );
  }
  if (spec.chartValues !== undefined) {
    overrides["xl/charts/chart1.xml"] = TYPE.chart;
    parts.push(
      xmlPart(
        "xl/charts/chart1.xml",
        `<c:chartSpace xmlns:c="${NS.c}"><c:chart><c:plotArea><c:ser>${spec.chartValues
          .map((value) => `<c:v>${value}</c:v>`)
          .join("")}</c:ser></c:plotArea></c:chart></c:chartSpace>`,
      ),
    );
  }
  for (const [name, bytes] of Object.entries(spec.media ?? {})) {
    parts.push({ name: `xl/media/${name}`, content: bytes });
  }
  parts.push(...(spec.extraParts ?? []));
  return zipParts(
    [
      contentTypes(
        {
          rels: TYPE.rels,
          xml: TYPE.xml,
          png: TYPE.png,
          bin: "application/octet-stream",
        },
        { ...overrides, ...spec.extraOverrides },
      ),
      ...parts,
    ],
    spec.zip,
  );
}
