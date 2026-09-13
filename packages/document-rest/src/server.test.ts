import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bytesToBase64, createDocx } from "documents.js";
import { ODF_MEDIA_TYPES, zipPackage } from "odf.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRestServer } from "./server";

// The identical fixture document-operations' own odb-render-report.test.ts uses (copied verbatim -- see that package's test-support/fixtures/form-and-report.odb for its provenance), needed here only to exercise odb_render_report's OdbReportNotSpecifiedError -> 400 mapping with a real .odb.
const FORM_AND_REPORT_ODB_PATH = fileURLToPath(
  new URL("../test-support/fixtures/form-and-report.odb", import.meta.url),
);

// A minimal but structurally real .odm master document referencing one chapter this test never supplies, so odmToPdf throws a real OdmUnresolvedSectionError. Mirrors document-operations' own test-support/odm-fixture.ts odmBytes() exactly, at the scale this one test needs.
function odmMasterBytes(): Uint8Array<ArrayBuffer> {
  const enc = (value: string) => new TextEncoder().encode(value);
  const ns =
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:xlink="http://www.w3.org/1999/xlink"';
  const contentXml = enc(
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<office:document-content ${ns}><office:body><office:text><text:section text:name="ch1"><text:section-source xlink:href="../missing.odt" text:filter-name="writer8"/></text:section></office:text></office:body></office:document-content>`,
  );
  return zipPackage([
    ["mimetype", { bytes: enc(ODF_MEDIA_TYPES.odm), stored: true }],
    ["content.xml", { bytes: contentXml }],
  ]);
}

interface RunningServer {
  readonly baseUrl: string;
  readonly close: () => Promise<void>;
}

async function start(): Promise<RunningServer> {
  const server = createRestServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      "Expected the test server to bind a TCP address, not a pipe or Unix socket",
    );
  }
  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

describe("createRestServer", () => {
  let running: RunningServer;

  beforeEach(async () => {
    running = await start();
  });

  afterEach(async () => {
    await running.close();
  });

  it("GET / lists every available operation", async () => {
    const response = await fetch(running.baseUrl + "/");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    const body = (await response.json()) as { operations: { name: string }[] };
    expect(body.operations.some((op) => op.name === "convert_document")).toBe(
      true,
    );
  });

  it("does not list operations for a non-GET request to /", async () => {
    const response = await fetch(running.baseUrl + "/", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("treats an empty request body as {} rather than a JSON parse failure", async () => {
    const response = await fetch(running.baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    // An empty body parses to {}, which then fails convert_document's own inputSchema (missing source/targetFormat) -- a distinct failure mode from "not valid JSON", and the one that actually applies here.
    expect(body.error).toMatch(/failed validation/);
  });

  it("POST /convert_document converts a docx to markdown", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({ text: "Hello, world." });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const response = await fetch(running.baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { bytesBase64, format: "docx" },
        targetFormat: "markdown",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { targetFormat: string; output: { bytesBase64?: string } };
    };
    expect(body.result.targetFormat).toBe("markdown");
    expect(body.result.output.bytesBase64).toBeTruthy();
  });

  it("returns 400 with issues for a request body that fails schema validation", async () => {
    const response = await fetch(running.baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: { path: "x" } }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; issues: unknown };
    expect(body.error).toMatch(/failed validation/);
    expect(body.issues).toBeDefined();
  });

  it("returns 400 for a request body that is not valid JSON", async () => {
    const response = await fetch(running.baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/not valid JSON/);
  });

  it("returns 400 with an operation's own thrown error message", async () => {
    const response = await fetch(running.baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { path: "/tmp/does-not-exist.notaformat" },
        targetFormat: "markdown",
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/Could not infer a document format/);
  });

  it("returns 404 for an unknown operation name", async () => {
    const response = await fetch(running.baseUrl + "/not_a_real_operation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(
      'No operation named "not_a_real_operation". GET / lists every available operation.',
    );
  });

  it("returns 405 for GET on a known operation route", async () => {
    const response = await fetch(running.baseUrl + "/convert_document");
    expect(response.status).toBe(405);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe(
      "convert_document only accepts POST, received GET.",
    );
  });

  it("maps OdmUnresolvedSectionError to a 400 naming the unresolved href", async () => {
    const response = await fetch(running.baseUrl + "/odm_to_pdf", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { bytesBase64: bytesToBase64(odmMasterBytes()) },
      }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; hrefs: string[] };
    expect(body.hrefs).toEqual(["../missing.odt"]);
    expect(body.error).toMatch(
      /Pass chaptersDir containing these files, or an explicit chapters override, for each href\.$/,
    );
  });

  // odb_render_report's own OdbReportNotSpecifiedError mapping (the "no report given, and the .odb declares zero or more than one" case) has no equivalent direct HTTP-round-trip test here: the one real .odb fixture this repo checks in (form-and-report.odb, copied from document-operations' own test-support) declares exactly one report, so omitting `report` auto-selects it without ever throwing -- the identical limitation document-mcp's own odb-render-report.test.ts documents for its own suite, which resorts to constructing an OdbReportNotSpecifiedError instance directly rather than a real fixture round trip. This route's mapping is structurally identical to odm_to_pdf's (an instanceof check plus a fixed-shape body), which the test above does exercise end to end.
  it("renders the fixture's single declared report to odt with no report name given", async () => {
    const bytesBase64 = bytesToBase64(
      new Uint8Array(readFileSync(FORM_AND_REPORT_ODB_PATH)),
    );

    const response = await fetch(running.baseUrl + "/odb_render_report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { bytesBase64, format: "docx" },
        targetFormat: "odt",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: { bytesBase64?: string };
    };
    expect(body.result.bytesBase64).toBeTruthy();
  });
});
