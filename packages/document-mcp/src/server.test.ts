import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { version } from "../package.json";
import { createServer } from "./server";

// createServer()'s own advertised identity (name/version) is otherwise never asserted -- every src/tools/*.test.ts file connects through it but only ever inspects tool results, never the server's own self-reported Implementation from the initialize handshake.
describe("createServer", () => {
  it("advertises itself as document-mcp at this package's own version", async () => {
    const server = createServer();
    const client = new Client({ name: "server-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    expect(client.getServerVersion()).toEqual({
      name: "document-mcp",
      version,
    });

    await client.close();
  });

  // Every src/tools/*.test.ts file connects through createServer() but only ever calls one tool it already knows the name of, so none of them would notice a register*Tools(server) call going missing from createServer()'s own body -- only the full, exact set of every tool every register function contributes proves each of the twelve calls actually ran.
  it("registers every tool contributed by each of its twelve register*Tools calls", async () => {
    const server = createServer();
    const client = new Client({ name: "server-test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual(
      [
        "compute_formula",
        "convert_document",
        "list_document_conversions",
        "docx_extras",
        "document_create",
        "document_append_paragraphs",
        "fonts",
        "describe_font_file",
        "from_package",
        "metadata_read",
        "metadata_write",
        "odb_tables",
        "odb_forms",
        "odb_reports",
        "odb_query",
        "odb_to_csv",
        "odb_to_xlsx",
        "odb_render_report",
        "odm_to_pdf",
        "outline_document",
        "pdf_inspect",
      ].sort(),
    );

    await client.close();
  });
});
