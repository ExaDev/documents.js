# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's own advisory flow: [open a draft security advisory](https://github.com/ExaDev/documents.js/security/advisories/new) on this repository. That keeps the report visible only to the maintainers until a fix ships, and it is the only channel monitored for security reports — please do not open a public issue for one.

Include the affected package name and version, what an attacker can achieve, and a reproduction — a malicious input document is the most useful form, since almost everything here is a parser.

## Which versions get fixes

Every package in this workspace versions and releases independently, so there is no single supported version line across the repository. Fixes land on the latest published major of the affected package. Older majors are not backported unless the vulnerability is remotely triggerable and the older major still has meaningful download volume.

## What is in scope

These packages parse untrusted binary and text input by design — OOXML and OpenDocument ZIP packages, PDFs, and Markdown. The parsers are the security surface, so the following are all in scope:

- Memory exhaustion or unbounded allocation from a malformed or hostile document (a zip bomb, a deeply nested archive, a PDF with a cyclic object graph).
- Non-terminating parses — an input that makes a codec loop or backtrack indefinitely.
- Path traversal when a package's entry names are used to write files, including `document-cli`'s extraction paths.
- Content escaping into a context where it executes: XML external entity resolution, a formula or macro payload re-emitted into a written document, or Markdown rendered to HTML by a consumer.
- Prototype pollution through a key taken from document content.
- Anything that lets a document's bytes reach the filesystem, network, or a subprocess.

`documents` (the web UI) is client-only and statically built, so its scope is the usual browser surface: XSS from document content rendered into the page, and anything that escapes the worker sandbox.

## What is out of scope

- Denial of service from an input you supplied to your own process at a size you chose. The codecs carry explicit guards (`archive-codec`'s depth and cumulative-decompressed-size limits, for instance); a report should show a guard being bypassed or absent, not that a large document takes proportionate time to parse.
- Vulnerabilities in a transitive dependency with no reachable path from this code. Dependabot already tracks advisories against every manifest here; a report is useful when you can show the vulnerable path is actually reachable through a public API.
- Fidelity bugs. A conversion that loses formatting, drops a construct, or writes a document a reader renders differently is a correctness issue — open a normal issue for it.
- Missing hardening with no demonstrated impact (an absent header, a dependency one minor behind).

## Verifying what you installed

Every published release is signed and attestable, so a consumer can check that a tarball on npm was built from this repository by this workflow rather than trusting the registry alone.

Each release publishes to npm through OIDC trusted publishing — no long-lived npm token exists in this repository's secrets — with npm's own build provenance attached (`NPM_CONFIG_PROVENANCE`). On top of that, the `attest-release-artifacts` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs per released package and, against the exact tarball that ships (`pnpm pack`, not the raw `dist/`):

- Generates an SPDX SBOM (`pnpm sbom --sbom-format spdx --prod`) and signs an SBOM attestation over the tarball.
- Signs a build-provenance attestation over the same tarball.
- Attaches the raw `sbom.spdx.json` to that package's GitHub Release, so the dependency inventory is downloadable without any attestation tooling.

Both attestations are stored against this repository and keyed by the tarball's digest. To verify a package you have installed:

```sh
npm pack byte-codec@<version>
gh attestation verify byte-codec-<version>.tgz --repo ExaDev/documents.js
```

A tarball that fails that check did not come from this repository's release pipeline, regardless of what the registry says. Please report such a finding through the advisory link above.

## Release integrity

Releases run only from `main`, gated on the full check suite, and publish through the topological orchestrator described in the [root README](README.md#releases). Direct pushes to `main` require a token whose actor the branch ruleset explicitly allows, and the alias/mirror republish jobs deliberately cannot fail a release or alter what the primary publish shipped.
