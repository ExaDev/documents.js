# Only used to obtain libatomic.so.1: cc-debian12 below doesn't ship it, but the SEA binary's own Node runtime dynamically links against it (confirmed by direct verification against document-rest's identical Dockerfile -- the binary otherwise fails at startup with "libatomic.so.1: cannot open shared object file"). Nothing else from this stage is ever copied forward -- no pnpm, no Node, no apt cache.
FROM debian:bookworm-slim AS libatomic
RUN apt-get update && apt-get install --no-install-recommends -y libatomic1 \
    && rm -rf /var/lib/apt/lists/* \
    && cp -P /usr/lib/*/libatomic.so.1* /usr/lib/

# Distroless, not a general-purpose base like debian:bookworm-slim: this image never needs a shell, package manager, or any other OS tooling at runtime -- only the dynamic linker and libraries the SEA binary actually links against. cc-debian12 already carries glibc, libgcc, and libstdc++ (Node's own official distribution ships a separate -musl build alongside the default linux-x64/linux-arm64 tarball, confirming the default -- and therefore this binary -- is glibc-linked, and V8 is C++, requiring libstdc++); libatomic above is the one runtime dependency it's missing. The :nonroot tag runs as a built-in non-root user (UID 65532) with no groupadd/useradd step needed.
FROM gcr.io/distroless/cc-debian12:nonroot

COPY --from=libatomic /usr/lib/libatomic.so.1* /usr/lib/
# cc-debian12's own glibc searches its own arch-specific multiarch directory by default, not bare /usr/lib -- rather than hardcode that directory's name (aarch64-linux-gnu vs x86_64-linux-gnu, yet another arch-naming split like Docker's amd64/arm64 vs Node's x64/arm64 elsewhere in this project's own CI), LD_LIBRARY_PATH makes the linker check /usr/lib too, which every architecture's build of this image copies libatomic.so.1 into identically.
ENV LD_LIBRARY_PATH=/usr/lib

# The Linux SEA binary this exact CI leg already downloaded from the release (see build-container-images in .github/workflows/ci.yml), not built here -- this image runs no pnpm install/build of its own. Already executable: distroless has no shell to chmod it with, so the CI job sets the execute bit on the runner's own filesystem before `docker build` runs, and COPY preserves that permission bit.
COPY dist-sea/document-mcp /usr/local/bin/document-mcp

EXPOSE 3000

LABEL org.opencontainers.image.source="https://github.com/ExaDev/documents.js"
LABEL org.opencontainers.image.description="document-mcp: an MCP server over documents.js's document-conversion, .odb, metadata, and font tooling (--transport http only in this image)"
LABEL org.opencontainers.image.licenses="MIT"

# --transport http is fixed: stdio mode is exec'd directly by an MCP client as a subprocess, which a container has no role in. --host 0.0.0.0 for the identical reason as document-rest's own Dockerfile -- the binary defaults to loopback-only, unreachable from outside a container regardless of `-p`. --port stays a CMD default so `docker run -p 3000:3000 ... --port 3000` still works, and any other --port a caller passes as trailing docker run args overrides it.
ENTRYPOINT ["/usr/local/bin/document-mcp", "--transport", "http", "--host", "0.0.0.0"]
CMD ["--port", "3000"]
