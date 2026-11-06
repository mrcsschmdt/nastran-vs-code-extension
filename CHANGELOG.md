# Changelog

## 0.4.0

- Decks from Simcenter are outlined by their comment headers: sections, card groups, mesh collectors, meshes,
  properties, materials … with the card counts of each header in its detail (`3960 CQUAD4`). With VS Code's sticky
  scroll, the headers you are in stay pinned at the top of the editor while you scroll through the cards.
- Simcenter header comments (`$* BULK DATA`, `$*  Mesh Collector: Thin Shell(1)`) are colored as headings.
- Outline: `ID,NASTRAN,job` is no longer shown as `ID ,NASTRAN,job`.

## 0.3.0

- Folding by the comment headers Simcenter writes: the translator banner, the boxed sections
  (`$* EXECUTIVE CONTROL`, `$* BULK DATA` …), the card groups (`$* GRID CARDS`, `$* ELEMENT CARDS` …), and each
  mesh collector with its meshes, property with its section, material, load, constraint, coordinate system and
  modeling object. Each fold starts on the header's title, so *Fold All* gives a table of contents of the deck.
  A collector that Simcenter repeats for each of its meshes folds once, over all of them.
- Boxed titles in decks from other tools (`$-----` / `$ Title` / `$-----`) fold the same way.
- Runs of one card type (CQUAD4, CHEXA …) end at a header, so each mesh has its own runs.
- Large decks stay under VS Code's limit on folding regions (`editor.foldingMaximumRegions`, 5000 by default):
  folds of single cards are dropped first, so sections and headers always fold.
- New setting `nastran.folding.commentHeaders` (on by default).

## 0.2.0

- Nastran output (`.f06`) files open in their own language, *Nastran Output*, without the input deck features
  (card diagnostics, field shading, formatting, rulers).
- Outline and folding for `.f06` sections, found from the letter-spaced headings (`R E A L   E I G E N V A L U E S`).
  Pages that repeat a heading form one section, split by subcase and SOL 200 design cycle. The header text before
  the first section also folds.
- FATAL, WARNING and INFORMATION messages from `.f06` files in the Problems panel and the Outline
  (`nastran.f06.messages`).
- Highlighting for `.f06` headings, messages, page headers and `END OF JOB`.
- Status bar shows the `.f06` section under the cursor.

## 0.1.0

- First version: field hovers, small/large/free field conversion, formatting, INCLUDE navigation, go to definition
  and references, diagnostics with quick fixes, completion, outline, folding, comment wrapping and private definition
  files for Nastran input decks.
