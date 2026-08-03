## [1.0.6](https://github.com/ExaDev/markdown-codec/compare/v1.0.5...v1.0.6) (2026-08-03)


### Bug Fixes

* **ci:** wrap the sibling-bump commit body onto two lines under commitlint's limit ([a8dfc97](https://github.com/ExaDev/markdown-codec/commit/a8dfc97750a8ae4cc1b1232ce85c25e5540b3eb7))

## [1.0.5](https://github.com/ExaDev/markdown-codec/compare/v1.0.4...v1.0.5) (2026-08-03)


### Bug Fixes

* **ci:** use single-quoted string literals in workflow if-conditions ([e6d5bf1](https://github.com/ExaDev/markdown-codec/commit/e6d5bf184e1894d6770925cf345e4e5a10714887))

## [1.0.4](https://github.com/ExaDev/markdown-codec/compare/v1.0.3...v1.0.4) (2026-08-03)

## [1.0.3](https://github.com/ExaDev/markdown-codec/compare/v1.0.2...v1.0.3) (2026-08-03)

## [1.0.2](https://github.com/ExaDev/markdown-codec/compare/v1.0.1...v1.0.2) (2026-08-03)

## [1.0.1](https://github.com/ExaDev/markdown-codec/compare/v1.0.0...v1.0.1) (2026-08-03)

# 1.0.0 (2026-08-03)


### Bug Fixes

* force tsdown's unrun config loader in the prepare script ([1134222](https://github.com/ExaDev/markdown-codec/commit/11342229e6e6b7c0a773af199b1d0352611c9c6b))
* recognise ftp:// extended autolinks and reject email addresses ending in - or _ ([873b900](https://github.com/ExaDev/markdown-codec/commit/873b900152f727c8df7307eb07b30a499b179d8e))
* ship a prebuilt dist to make git-dependency consumption reliable ([beda0a8](https://github.com/ExaDev/markdown-codec/commit/beda0a89d92fffd153d5dcd05d767b404b721cda))


### Features

* add CommonMark-HTML conformance oracle ([1c3dec4](https://github.com/ExaDev/markdown-codec/commit/1c3dec4669fdd48dd82c7cb2dfea3b3939e278b3))
* add L0 primitives (diagnostics, ast, options, scan, image, entity table) ([bbed266](https://github.com/ExaDev/markdown-codec/commit/bbed266f929deec6927a7d1cc0df10257d62119f))
* implement block phase (containers, lists, tables, setext headings) ([09b2b5a](https://github.com/ExaDev/markdown-codec/commit/09b2b5a367a1db31aa0d9be4a2d3ab630742df6c))
* implement inline phase (emphasis, links, autolinks, entities) ([20d41f4](https://github.com/ExaDev/markdown-codec/commit/20d41f41586fd36b48e7d2afecc9ff3d052220ee))
* map AST to and from ContentDocument ([6740d83](https://github.com/ExaDev/markdown-codec/commit/6740d83bcc7e397af4696b896f4560b5fd2a386b))
* wire public readMarkdown/writeMarkdown API and pass CommonMark+GFM conformance ([d9afdb6](https://github.com/ExaDev/markdown-codec/commit/d9afdb68887c51b07e38137b1d83e846e07d80d0))
