# document-rest

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/documents.js/tree/main/packages/document-rest) [![npm](https://img.shields.io/badge/npm-CB3837?logo=npm&logoColor=white)](https://www.npmjs.com/package/document-rest) [![npm version](https://img.shields.io/npm/v/document-rest)](https://www.npmjs.com/package/document-rest) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/documents.js/ci.yml?branch=main)](https://github.com/ExaDev/documents.js/actions)

> A plain REST API server exposing [`document-operations`](../document-operations/README.md)'s document-conversion, `.odb`, metadata, and font tooling as JSON-over-HTTP `POST` routes, for a caller with no MCP client and no Node runtime of its own — a Kotlin/JVM app, a Python script, or any other language with an HTTP client.

`document-rest` adds no conversion or editing logic of its own — like [`document-mcp`](../document-mcp/README.md), it is a dispatch layer over [`document-operations`](../document-operations/README.md), the only difference being the transport: one `POST` route per operation instead of one MCP tool. `document-mcp`'s existing `--transport http` mode is not a substitute for this: it speaks MCP's own JSON-RPC protocol over a single `/mcp` path, which still needs an MCP client library to call — this package is for a caller that wants ordinary request/response JSON with no protocol of its own layered on top.

## Getting started

Run the server directly — no install step needed:

```sh
npx document-rest --port 3100
```

This binds a plain `node:http` listener to `127.0.0.1` (loopback only) on the given `--port` (default `3100`; `--port 0` asks the OS for a free port, reported on stderr once bound).

> **Security note:** this listener has no authentication and no Host/Origin allowlisting of its own — anyone who can reach it can call every operation, including ones that read and write arbitrary filesystem paths. It is safe by default only because it binds to loopback; whatever fronts it for remote access (a tunnel, a reverse proxy) is responsible for authenticating callers before traffic ever reaches this process. Matches [`document-mcp`'s own `--transport http` listener](../document-mcp/README.md#remote-transport-http), which carries the identical note for the identical reason.

### Standalone binary

Every release also attaches a Node [single-executable application](https://nodejs.org/api/single-executable-applications.html) build for Linux (x64 and arm64), Windows (x64 and arm64), and macOS (Apple Silicon and Intel) to that release's own GitHub Release assets — the entire server and its dependencies embedded in one file, needing no Node.js install or `npx` at all. For the "a caller with no Node runtime of its own" case this package exists for in the first place, this removes the last Node dependency too: download the asset matching your platform from the package's tag on the [Releases page](https://github.com/ExaDev/documents.js/releases), run it directly (`chmod +x` on Linux/macOS first), and it takes the identical `--port` flag.

### Container image

Every release also publishes a multi-arch (`linux/amd64` + `linux/arm64`) container image to GitHub Container Registry, wrapping the identical standalone binary above on a minimal [distroless](https://github.com/GoogleContainerTools/distroless) base rather than a Node install:

```sh
docker run -p 3100:3100 ghcr.io/exadev/documents.js:VERSION --port 3100
```

Replace `VERSION` with the package's own exact release version (e.g. `1.2.0`) — matching the version-pinned convention every other artifact in this repository uses, this image is never published under a loose major/minor tag such as `1` or `1.2`, though `latest` does track the newest release. The image binds to `0.0.0.0` inside the container regardless of `--port`, so `-p <host>:<container>` is all that's needed to reach it; see the security note above about this listener having no authentication of its own — publishing the container's port makes it reachable by anything that can reach the host, so put a reverse proxy or firewall in front of it before exposing it beyond your own machine.

## API

**`GET /`** lists every available operation:

```sh
curl http://127.0.0.1:3100/
```

```json
{ "operations": [{ "name": "convert_document", "title": "Convert document", "description": "..." }, ...] }
```

**`POST /<operationName>`** runs one operation: the request body is JSON, validated against that operation's own input schema, and the response is `{ "result": ... }` on success. Every operation `document-operations` defines is reachable this way — see [that package's own README](../document-operations/README.md#operations) for the full list of operation names and what each one does; the request/response shapes are identical to the equivalent MCP tool's own `structuredContent`, since both dispatch to the exact same `run()` function.

```sh
curl -X POST http://127.0.0.1:3100/convert_document \
  -H 'content-type: application/json' \
  -d '{"source":{"path":"/tmp/report.docx"},"targetFormat":"markdown"}'
```

### Errors

| Status | When                                                                                                                                                                                                   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | The request body is not valid JSON, fails the operation's own input schema (`{ error, issues }`, from Zod's `treeifyError`), or the operation itself threw (`{ error }`, the thrown message verbatim). |
| `404`  | No operation exists with that name.                                                                                                                                                                    |
| `405`  | A method other than `POST` was used against a known operation route (`GET /` is the only exception).                                                                                                   |

Two operations enrich their `400` body beyond a bare `{ error }`, mirroring `document-mcp`'s own `registerOperation` `mapError` hooks for the identical two typed errors: `odb_render_report`'s `OdbReportNotSpecifiedError` adds `availableReports` (every report name the `.odb` actually declares), and `odm_to_pdf`'s `OdmUnresolvedSectionError` adds `hrefs` (every chapter reference that failed to resolve).

## Getting started (development)

Requires Node.js `>=20` and pnpm `11.6.0` (pinned via `packageManager` in `package.json`).

```sh
pnpm install
pnpm build      # turbo -> tsdown -> dist/ (ESM + CJS + .d.ts)
pnpm typecheck  # turbo -> tsc --noEmit, plus attw --pack
pnpm lint       # turbo -> eslint . --fix --cache --max-warnings 0
pnpm test       # turbo -> vitest run, driving a real ephemeral-port HTTP server through fetch()
```

## Gotchas

- **No streaming, no chunked upload.** `readJsonBody` buffers the entire request body into memory before parsing it as JSON, matching every operation's own hybrid `bytesBase64`-or-`path` input convention (a large document is better supplied by filesystem `path`, read once by the operation itself, than base64-inflated over HTTP).
- **Abort on client disconnect.** Each request gets its own `AbortSignal`, wired to the underlying `IncomingMessage`'s `close` event (node:http carries no `AbortSignal` of its own) — a client that disconnects mid-conversion causes the operation's own signal-aware work (e.g. `convert_document`'s page-boundary cancellation) to stop at the next checkpoint rather than running to completion for a caller no longer listening.

## Contributing

Release, CI, and commit-message conventions are all workspace-wide, not package-local — see the [monorepo root README](../../README.md#releases) for the release mechanism and [CONTRIBUTING.md](../../CONTRIBUTING.md) for the shared git hooks and history conventions. Work inside `packages/document-rest/`.

## License

MIT
