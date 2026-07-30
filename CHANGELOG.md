# [1.18.0](https://github.com/ExaDev/documents.js/compare/v1.17.0...v1.18.0) (2026-07-30)


### Features

* **ooxml:** add readDocxContent, Package -> ContentDocument for docx ([266007a](https://github.com/ExaDev/documents.js/commit/266007a2331b2fb18ca333992f640d8119f6c124))

# [1.17.0](https://github.com/ExaDev/documents.js/compare/v1.16.0...v1.17.0) (2026-07-30)


### Features

* **ooxml:** add the docx style cascade resolver ([47b53c6](https://github.com/ExaDev/documents.js/commit/47b53c6027f404acf0939f5c1bb46195dca3ef0e))

# [1.16.0](https://github.com/ExaDev/documents.js/compare/v1.15.0...v1.16.0) (2026-07-30)


### Features

* **layout:** add pptx direct-placement layout, completing pptx->PDF ([a8dfd27](https://github.com/ExaDev/documents.js/commit/a8dfd27c53b0a11a787a9be0d163d6de2c7d9a60))

# [1.15.0](https://github.com/ExaDev/documents.js/compare/v1.14.0...v1.15.0) (2026-07-30)


### Features

* **pdf:** carry hyperlink through text-layout wrapping ([3798607](https://github.com/ExaDev/documents.js/commit/379860764cc817e8849850c834f12d41ef1e7bc1))

# [1.14.0](https://github.com/ExaDev/documents.js/compare/v1.13.0...v1.14.0) (2026-07-30)


### Features

* **ooxml:** read pptx table row height from a:tr/[@h](https://github.com/h) ([fda7067](https://github.com/ExaDev/documents.js/commit/fda706746a0d333d9fade7e2684233c790940673))

# [1.13.0](https://github.com/ExaDev/documents.js/compare/v1.12.0...v1.13.0) (2026-07-30)


### Features

* **ooxml:** read pptx text-box insets and normAutofit scale ([5ed0849](https://github.com/ExaDev/documents.js/commit/5ed08491c6bbf1a6a40d5ec4cd17ddb86a6e7bfe))
* **pdf:** add rotatePointAboutCenter for shape-rotation reconciliation ([48ff663](https://github.com/ExaDev/documents.js/commit/48ff663221914c0d08672ee0808373f5543a247c))

# [1.12.0](https://github.com/ExaDev/documents.js/compare/v1.11.0...v1.12.0) (2026-07-30)


### Features

* **ooxml:** add readPptxContent, Package -> ContentDocument for pptx ([d4f9660](https://github.com/ExaDev/documents.js/commit/d4f9660c33895746f3849ee24e62814d722810d6))

# [1.11.0](https://github.com/ExaDev/documents.js/compare/v1.10.0...v1.11.0) (2026-07-30)


### Features

* **model:** add rotationDeg to ContentShape ([82bae97](https://github.com/ExaDev/documents.js/commit/82bae9778e02ff6dc70e1a1facf3e82703348560))
* **ooxml:** add DrawingML group-shape child-to-parent transform ([357af37](https://github.com/ExaDev/documents.js/commit/357af3784ccbf391242e287d76ccbcfbbdca258e))
* **ooxml:** add pptx placeholder/layout/master/theme inheritance cascade ([86cc6fc](https://github.com/ExaDev/documents.js/commit/86cc6fc4cd4ed4cdec7c59dc7fb8fdcb7bc965d8))

# [1.10.0](https://github.com/ExaDev/documents.js/compare/v1.9.0...v1.10.0) (2026-07-30)


### Features

* **model:** add DrawingML hundredths-of-a-point font-size conversion ([d7b311c](https://github.com/ExaDev/documents.js/commit/d7b311c928ef1ff5bdb561721992099eaf095a22))
* **model:** add DrawingML shade/tint/lumMod/lumOff colour transforms ([9a0f675](https://github.com/ExaDev/documents.js/commit/9a0f675106d54d46574274708dfd67c726ece015))
* **ooxml:** add shared docProps metadata reader ([228c9f1](https://github.com/ExaDev/documents.js/commit/228c9f115fa8cc14204f45754a6fb4af49043a5f))
* **ooxml:** add shared DrawingML geometry and theme colour resolution ([9542423](https://github.com/ExaDev/documents.js/commit/95424230c36320789a330350ca954f0b767df5ac))

# [1.9.0](https://github.com/ExaDev/documents.js/compare/v1.8.0...v1.9.0) (2026-07-30)


### Features

* add ClockPort and abort-signal ports ([43bf591](https://github.com/ExaDev/documents.js/commit/43bf591241474d3ce0fce48a99c65392d39c8f19))
* **pdf:** add writePdf, assembling the full object graph and xref table ([3c1c793](https://github.com/ExaDev/documents.js/commit/3c1c793949e99ebb8f115815b43da95bfab07b1f))

# [1.8.0](https://github.com/ExaDev/documents.js/compare/v1.7.0...v1.8.0) (2026-07-30)


### Features

* **pdf:** add content-stream generation from LayoutItem ([2c26dd5](https://github.com/ExaDev/documents.js/commit/2c26dd54afd97e6de1e28050bd46e7b198f702d1))

# [1.7.0](https://github.com/ExaDev/documents.js/compare/v1.6.0...v1.7.0) (2026-07-30)


### Features

* **pdf:** add greedy line-wrapping over styled runs ([f843c54](https://github.com/ExaDev/documents.js/commit/f843c544f6fe3bf816ee047992181bbe2ce92aec))
* **pdf:** add standard-14 font text measurer ([1605f44](https://github.com/ExaDev/documents.js/commit/1605f44028cbac81d65bccce050b3622f76b6062))

# [1.6.0](https://github.com/ExaDev/documents.js/compare/v1.5.0...v1.6.0) (2026-07-30)


### Features

* add WinAnsi sanitization, font-family resolution, and matrix math for the PDF writer ([f37b301](https://github.com/ExaDev/documents.js/commit/f37b3011630d267073afedb9efb79830bf3ac782))

# [1.5.0](https://github.com/ExaDev/documents.js/compare/v1.4.0...v1.5.0) (2026-07-30)


### Features

* add the PDF object model, serializer, and standard-14 font metrics ([1801e3c](https://github.com/ExaDev/documents.js/commit/1801e3c783eb134475d3c075e8120e7ee1c8c65b))

# [1.4.0](https://github.com/ExaDev/documents.js/compare/v1.3.0...v1.4.0) (2026-07-30)


### Features

* add the pptx live-view read+write editor ([76d355d](https://github.com/ExaDev/documents.js/commit/76d355d65c2ea76617dffad43fb976345802da3c))

# [1.3.0](https://github.com/ExaDev/documents.js/compare/v1.2.0...v1.3.0) (2026-07-30)


### Features

* add the docx live-view read+write editor ([752c9fc](https://github.com/ExaDev/documents.js/commit/752c9fc6b34df56213f343761fae20e829054de0))

# [1.2.0](https://github.com/ExaDev/documents.js/compare/v1.1.0...v1.2.0) (2026-07-30)


### Features

* add byte primitives and hand-written PNG/JPEG image codecs ([9b8011e](https://github.com/ExaDev/documents.js/commit/9b8011e92079a538edfcbf99b0be132336e73936))

# [1.1.0](https://github.com/ExaDev/documents.js/compare/v1.0.0...v1.1.0) (2026-07-30)


### Features

* add XML mutation and OPC package mechanics layers ([4086462](https://github.com/ExaDev/documents.js/commit/4086462517e76d2a81c92b394608ce5c077a7dc6))

# 1.0.0 (2026-07-30)


### Features

* add core model schemas for units, geometry, color, and the two document pivots ([891231f](https://github.com/ExaDev/documents.js/commit/891231feb17ee3929420602c6a12f2a220410a24))
