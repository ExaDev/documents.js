import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { Package, XmlNode } from "documents.js";
import { bytesToBase64, decodePackage } from "documents.js";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { z } from "zod";
import { createServer } from "../server";
import {
  FORM_AND_REPORT_ODB_PATH,
  loadFormAndReportOdbBytes,
} from "../test-support/odb-fixture";

// Minimal Zod schemas for the fields this suite actually inspects on each tool's own structuredContent (typed `unknown` on CallToolResult per SEP-2106 -- see odb-render-report.test.ts's own OdbRenderReportOutputSchema for the same convention). Parsing rather than narrowing by hand keeps every assertion below free of `any`/type assertions while still exercising the real, documents.js-shaped data the tools return.
const TableSummarySchema = z.object({
  tableName: z.string(),
  columns: z.array(z.object({ name: z.string() })),
  rows: z.array(z.unknown()),
});
const OdbFormSummarySchema = z.object({
  name: z.string(),
  href: z.string(),
  forms: z.array(
    z.object({
      name: z.string(),
      command: z.string(),
      commandType: z.string(),
    }),
  ),
});
const OdbReportSummarySchema = z.object({
  name: z.string(),
  href: z.string(),
  command: z.string(),
  commandType: z.string(),
  caption: z.string(),
});
const ResolvedOutputSchema = z.union([
  z.object({ path: z.string(), byteLength: z.number() }),
  z.object({
    bytesBase64: z.string(),
    byteLength: z.number(),
    large: z.literal(true).optional(),
  }),
]);

// odb_tables/odb_forms/odb_reports each return a bare array as structuredContent, matching what the callback itself hands back to registerTool -- but the 2025-11-25 wire era's own SEP-2106 projection (WireCodec.projectCallToolResult) boxes a non-object structuredContent value as `{ result: [...] }` before it reaches a client, since that era's own wire result schema requires an object root (the 2026-07-28 era codec does not do this). Accepting either shape here keeps this suite correct regardless of which era this SDK version negotiates by default.
function arrayStructuredContentSchema<Item extends z.ZodType>(
  item: Item,
): z.ZodType<z.infer<Item>[]> {
  return z
    .union([z.array(item), z.object({ result: z.array(item) })])
    .transform((value) => (Array.isArray(value) ? value : value.result));
}

// Drives the real, fully-assembled MCP server (createServer(), the same entry point src/bin.ts uses) through a genuine in-memory client/server JSON-RPC round trip -- not the tool callbacks in isolation -- so this proves the wiring: that odb_tables/odb_forms/odb_reports/odb_query/odb_to_csv/odb_to_xlsx are all registered under those names, that each reaches documents.js's real readOdbTables/readOdbForms/readOdbReports/evaluateSelect+parseSelect/ odbToCsv/odbToXlsx, and that the output really carries the fixture's own real data, not merely non-empty bytes. Ground truth for the fixture's own SALES table and HighValueSales saved query is documents.js's own src/odb/sql/query.test.ts, which runs the identical saved query against the identical fixture and hand-verifies the results. Mirrors src/tools/odb-render-report.test.ts's own connection harness (a sibling tool over the same fixture, for a different documents.js entry point).

interface ConnectedPair {
  readonly client: Client;
  readonly close: () => Promise<void>;
}

async function connect(): Promise<ConnectedPair> {
  const server = createServer();
  const client = new Client({ name: "odb-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    server.connect(serverTransport),
  ]);
  return { client, close: async () => client.close() };
}

// Recursively searches every text-node value and element-attribute value in one decoded OOXML part for `needle` -- odb_to_xlsx's own verification that the exported workbook carries the fixture's real sheet name and cell values, without needing ooxml.js's own readXlsxContent (documents.js deliberately doesn't re-export it -- see that package's own README) or any namespace-specific knowledge of xlsx's own XML shape.
function xmlNodesContainText(
  nodes: readonly XmlNode[],
  needle: string,
): boolean {
  return nodes.some((node) => {
    if (node.type === "text") {
      return node.value.includes(needle);
    }
    if (node.type === "element") {
      return (
        node.attributes.some((attribute) => attribute.value.includes(needle)) ||
        xmlNodesContainText(node.children, needle)
      );
    }
    return false;
  });
}

function packageContainsText(pkg: Package, needle: string): boolean {
  return Object.values(pkg.parts).some(
    (part) => part.kind === "xml" && xmlNodesContainText(part.nodes, needle),
  );
}

describe("odb tools", () => {
  let workspace: string;
  let pair: ConnectedPair;

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), "document-mcp-odb-"));
  });

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  beforeEach(async () => {
    pair = await connect();
  });

  afterEach(async () => {
    await pair.close();
  });

  describe("odb_tables", () => {
    it("lists the fixture's real SALES table via a filesystem path source", async () => {
      const result = await pair.client.callTool({
        name: "odb_tables",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBeFalsy();
      const tables = arrayStructuredContentSchema(TableSummarySchema).parse(
        result.structuredContent,
      );
      expect(tables).toHaveLength(1);
      const [table] = tables;
      if (table === undefined) {
        throw new Error("expected one table");
      }
      expect(table.tableName).toBe("SALES");
      expect(table.columns.map((column) => column.name)).toEqual([
        "AMOUNT",
        "ID",
        "REGION",
        "QUARTER",
        "CUSTOMER",
      ]);
      expect(table.rows).toHaveLength(6);

      // content's own JSON text is the bare, unwrapped array the callback itself returned -- SEP-2106's object-root wrapping (see arrayStructuredContentSchema above) applies only to the wire-level structuredContent projection, never to content. Re-parsed with z.unknown() items (rather than TableSummarySchema) so this comparison is lossless -- unlike `tables` above, nothing here should be stripped to just the fields this suite happens to assert on.
      const [block] = result.content;
      expect(block?.type).toBe("text");
      const rawTables = arrayStructuredContentSchema(z.unknown()).parse(
        result.structuredContent,
      );
      expect(
        block?.type === "text" ? JSON.parse(block.text) : undefined,
      ).toStrictEqual(rawTables);
    });

    it("reads via inline base64 bytes too", async () => {
      const result = await pair.client.callTool({
        name: "odb_tables",
        arguments: {
          source: {
            bytesBase64: bytesToBase64(loadFormAndReportOdbBytes()),
            format: "pdf",
          },
        },
      });

      expect(result.isError).toBeFalsy();
      const tables = arrayStructuredContentSchema(TableSummarySchema).parse(
        result.structuredContent,
      );
      expect(tables[0]?.tableName).toBe("SALES");
    });
  });

  describe("odb_forms", () => {
    it("lists the fixture's real SalesForm, bound to SALES", async () => {
      const result = await pair.client.callTool({
        name: "odb_forms",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBeFalsy();
      const forms = arrayStructuredContentSchema(OdbFormSummarySchema).parse(
        result.structuredContent,
      );
      expect(forms).toHaveLength(1);
      const [form] = forms;
      if (form === undefined) {
        throw new Error("expected one form");
      }
      expect(form.name).toBe("SalesForm");
      expect(form.href).toBe("forms/Obj11");
      expect(form.forms[0]).toMatchObject({
        name: "SalesForm",
        command: "SALES",
        commandType: "table",
      });
    });
  });

  describe("odb_reports", () => {
    it("lists the fixture's real SalesByRegion report, bound to the HighValueSales saved query", async () => {
      const result = await pair.client.callTool({
        name: "odb_reports",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBeFalsy();
      const reports = arrayStructuredContentSchema(
        OdbReportSummarySchema,
      ).parse(result.structuredContent);
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        name: "SalesByRegion",
        href: "reports/Obj11",
        command: "HighValueSales",
        commandType: "query",
        caption: "Sales by region",
      });
    });
  });

  describe("odb_query", () => {
    it("runs the fixture's own saved HighValueSales query by name, to the real four filtered/sorted rows", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          query: "HighValueSales",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toStrictEqual({
        columns: ["REGION", "QUARTER", "CUSTOMER", "AMOUNT"],
        rows: [
          [
            { kind: "string", value: "North" },
            { kind: "string", value: "Q1" },
            { kind: "string", value: "Acme Ltd" },
            { kind: "number", value: 1200.5 },
          ],
          [
            { kind: "string", value: "North" },
            { kind: "string", value: "Q1" },
            { kind: "string", value: "Bolt Supplies" },
            { kind: "number", value: 340 },
          ],
          [
            { kind: "string", value: "North" },
            { kind: "string", value: "Q2" },
            { kind: "string", value: "Crown Foods" },
            { kind: "number", value: 2750.25 },
          ],
          [
            { kind: "string", value: "South" },
            { kind: "string", value: "Q2" },
            { kind: "string", value: "Everest Tools" },
            { kind: "number", value: 1810 },
          ],
        ],
      });
    });

    it("runs a literal SQL SELECT with GROUP BY over the same real table", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          sql: "SELECT REGION, COUNT(*), SUM(AMOUNT) FROM SALES GROUP BY REGION ORDER BY REGION ASC",
        },
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toStrictEqual({
        columns: ["REGION", "COUNT(*)", "SUM(AMOUNT)"],
        rows: [
          [
            { kind: "string", value: "North" },
            { kind: "number", value: 3 },
            { kind: "number", value: 4290.75 },
          ],
          [
            { kind: "string", value: "South" },
            { kind: "number", value: 2 },
            { kind: "number", value: 1905.75 },
          ],
          [
            { kind: "string", value: "West" },
            { kind: "number", value: 1 },
            { kind: "number", value: 60 },
          ],
        ],
      });
    });

    it("reports an isError result naming the offending saved-query name when it does not resolve", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          query: "NoSuchQuery",
        },
      });

      expect(result.isError).toBe(true);
      const [block] = result.content;
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "NoSuchQuery",
      );
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "HighValueSales",
      );
    });

    it("reports an isError result when both sql and query are given", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          sql: "SELECT * FROM SALES",
          query: "HighValueSales",
        },
      });

      expect(result.isError).toBe(true);
      const [block] = result.content;
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "not both",
      );
    });

    it("reports an isError result when neither sql nor query is given", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBe(true);
      const [block] = result.content;
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "Provide either",
      );
    });

    it("reports an isError result naming the unsupported construct for a SQL feature outside the closed grammar", async () => {
      const result = await pair.client.callTool({
        name: "odb_query",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          sql: "SELECT * FROM SALES JOIN OTHER ON SALES.ID = OTHER.ID",
        },
      });

      expect(result.isError).toBe(true);
      const [block] = result.content;
      expect(block?.type === "text" ? block.text : undefined).toContain("JOIN");
    });
  });

  describe("odb_to_csv", () => {
    it("exports the real SALES table as CSV, with no table name needed (exactly one table)", async () => {
      const result = await pair.client.callTool({
        name: "odb_to_csv",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBeFalsy();
      const structured = ResolvedOutputSchema.parse(result.structuredContent);
      if (!("bytesBase64" in structured)) {
        throw new Error("expected an inline bytesBase64 result");
      }
      const csvText = Buffer.from(structured.bytesBase64, "base64").toString(
        "utf-8",
      );
      const lines = csvText.split("\r\n").filter((line) => line.length > 0);
      expect(lines).toHaveLength(7);
      expect(lines[0]).toBe("AMOUNT,ID,REGION,QUARTER,CUSTOMER");
      expect(csvText).toContain("Acme Ltd");
    });

    it("writes to outputPath when given, and honours an explicit table name", async () => {
      const outputPath = join(workspace, "sales.csv");

      const result = await pair.client.callTool({
        name: "odb_to_csv",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          table: "SALES",
          output: { outputPath },
        },
      });

      expect(result.isError).toBeFalsy();
      const structured = ResolvedOutputSchema.parse(result.structuredContent);
      if (!("path" in structured)) {
        throw new Error("expected a written-path result");
      }
      expect(structured.path).toBe(outputPath);
      const csvText = await readFile(outputPath, "utf-8");
      expect(csvText).toContain("Acme Ltd");
    });

    it("reports an isError result naming the offending table when an unrecognised table is requested", async () => {
      const result = await pair.client.callTool({
        name: "odb_to_csv",
        arguments: {
          source: { path: FORM_AND_REPORT_ODB_PATH },
          table: "NO_SUCH_TABLE",
        },
      });

      expect(result.isError).toBe(true);
      const [block] = result.content;
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "NO_SUCH_TABLE",
      );
      expect(block?.type === "text" ? block.text : undefined).toContain(
        "SALES",
      );
    });
  });

  describe("odb_to_xlsx", () => {
    it("exports one workbook carrying the real SALES table as its own sheet", async () => {
      const result = await pair.client.callTool({
        name: "odb_to_xlsx",
        arguments: { source: { path: FORM_AND_REPORT_ODB_PATH } },
      });

      expect(result.isError).toBeFalsy();
      const structured = ResolvedOutputSchema.parse(result.structuredContent);
      if (!("bytesBase64" in structured)) {
        throw new Error("expected an inline bytesBase64 result");
      }
      const xlsxBytes = new Uint8Array(
        Buffer.from(structured.bytesBase64, "base64"),
      );
      const pkg = decodePackage(xlsxBytes);

      expect(pkg.parts["xl/workbook.xml"]).toBeDefined();
      expect(packageContainsText(pkg, "SALES")).toBe(true);
      expect(packageContainsText(pkg, "Acme Ltd")).toBe(true);
    });
  });
});
