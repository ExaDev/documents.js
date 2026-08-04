import { McpServer } from '@modelcontextprotocol/server';

// resolveJsonModule lets rolldown (via tsdown) inline this package's own declared version straight into the bundle at build time -- no runtime fs read, no import-attribute syntax that would otherwise need to differ between the ESM and CJS build outputs. Matches document-cli's own src/program.ts convention.
import { version } from '../package.json';

// Builds a fresh MCP server instance advertising this package's own name and version. Never parses argv or connects a transport itself -- that is src/bin.ts's job, so this stays testable as pure construction and importable from anywhere (including a future HTTP entry point, should one be added).
export function createServer(): McpServer {
  const server = new McpServer({ name: 'document-mcp', version });

  // Tool registration goes here (e.g. registerConvertTools(server), registerOdbTools(server)) -- none registered yet; this is scaffold-only.

  return server;
}
