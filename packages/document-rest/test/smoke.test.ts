// Smoke test: the real built dist/bin.js runs correctly as a genuine subprocess speaking real HTTP -- not an in-process createRestServer() call (src/server.test.ts already proves the in-process wiring). Run only via `pnpm test:smoke` (tsdown, then vitest scoped to the "smoke" project), never part of the default `pnpm test` file set, since it requires a fresh build to mean anything. Matches document-mcp's own test/smoke.test.mjs convention (spawn the built artifact, assert on genuine output) adapted from a stdio JSON-RPC round trip to a real HTTP round trip.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bytesToBase64, createDocx } from "documents.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN_PATH = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
const LISTENING_LINE = /listening on (http:\/\/127\.0\.0\.1:\d+)/;

let child: ChildProcessWithoutNullStreams;
let baseUrl: string;

beforeAll(async () => {
  // process.execPath rather than relying on dist/bin.js's own shebang/chmod bit, so this doesn't depend on the host OS honouring executable permissions -- matches document-mcp's own smoke test convention.
  child = spawn(process.execPath, [BIN_PATH, "--port", "0"]);
  baseUrl = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      const match = LISTENING_LINE.exec(stderr);
      if (match?.[1] !== undefined) resolve(match[1]);
    });
    child.once("exit", (code) => {
      reject(
        new Error(
          `document-rest exited before listening (code ${String(code)}): ${stderr}`,
        ),
      );
    });
  });
});

afterAll(() => {
  child.kill();
});

interface ListOperationsBody {
  readonly operations: ReadonlyArray<{ readonly name: string }>;
}

interface ConvertDocumentBody {
  readonly result: {
    readonly targetFormat: string;
    readonly output: { readonly bytesBase64: string };
  };
}

describe("document-rest HTTP smoke test", () => {
  it("GET / lists the real registered operation set, by name", async () => {
    const response = await fetch(baseUrl + "/");
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListOperationsBody;
    const names = body.operations.map((operation) => operation.name).sort();
    expect(names).toContain("convert_document");
    expect(names).toContain("odb_render_report");
    expect(names.length).toBeGreaterThan(15);
  });

  it("POST /convert_document converts a real inline docx fixture to a genuine PDF", async () => {
    const editor = createDocx();
    editor.body.appendParagraph({
      text: "Hello from the document-rest smoke test.",
    });
    const bytesBase64 = bytesToBase64(editor.toBytes());

    const response = await fetch(baseUrl + "/convert_document", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { bytesBase64, format: "docx" },
        targetFormat: "pdf",
      }),
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as ConvertDocumentBody;
    expect(body.result.targetFormat).toBe("pdf");
    const pdfBytes = Buffer.from(body.result.output.bytesBase64, "base64");
    expect(pdfBytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
  });
});
