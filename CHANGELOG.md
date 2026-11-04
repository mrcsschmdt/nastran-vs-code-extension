# Changelog

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
