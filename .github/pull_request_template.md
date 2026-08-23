<!-- The commit messages are what land in each package's changelog, so put the real explanation there. This template is for what a reviewer needs that the diff and the commits do not already say. -->

## What this changes

<!-- Which packages, and what behaviour differs afterwards. -->

## Why

<!-- The problem, not the patch. Link the issue if there is one -- use `Fixes #N` so the issue closes and the Development panel links up. -->

## Notes for review

<!-- Anything a reviewer would otherwise have to reconstruct: a decision you made and rejected alternatives for, a place the change is deliberately narrower than it looks, a construct you chose to drop rather than half-support. Delete if there is nothing. -->

---

- [ ] Commits are conventional, and each package-affecting commit is scoped to the package it changes (`fix(pdf-codec): ...`) — commitlint gates this, and the scope decides which package's changelog the entry lands in.
- [ ] A behaviour change has a test that fails without it.
- [ ] A breaking change says so in the commit body (`BREAKING CHANGE:`), since that is what drives the major bump for that package alone.
- [ ] Sibling dependency ranges still admit the workspace copy, if this changes a package's version or a dependency on a sibling (see [Dependency ranges between packages](../README.md#dependency-ranges-between-packages)).
- [ ] Runtime `src/` in a Worker-isomorphic package still imports no `node:*`, no bare Node builtin, and uses no `Buffer` — the lint guard and the workerd suite both check this, but it is worth knowing before CI tells you.
- [ ] A new package followed the [checklist in CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-package-to-the-workspace) — the trusted-publisher and `attw` steps in particular have no local signal when missed.
