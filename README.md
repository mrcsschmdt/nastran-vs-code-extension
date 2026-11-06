# Nastran BDF for VS Code

A VS Code extension for editing MSC Nastran input decks (`.bdf`, `.dat`, `.aset`, `.nas`, `.blk`, `.bulk`, `.inc`, `.pch`).
It takes care of the fiddly parts of the format, such as 8- and 16-character fields, free field, continuations and
"real numbers need a decimal point", so you can work with cards rather than columns. It also reads `.f06` output
files: an outline and folds for every section, and FATAL / WARNING messages in the Problems panel.

> This is an independent community project. It is not affiliated with or endorsed by Hexagon (MSC Software) or
> Siemens. MSC Nastran is a trademark of Hexagon AB, Simcenter Nastran is a trademark of Siemens. Card descriptions
> are short summaries; the Quick Reference Guide of your Nastran version is the authority.

## Features

| | |
|---|---|
| **Field hovers** | Hover any field to see the card, field name (e.g. `CQUAD4 · G1`), field number, columns, expected type, a description and the card's full 10-field layout table with the current field highlighted. Hovering an ID that references another card (PID, MID, grids, CIDs, load/SPC sets, tables …) shows that card. |
| **Status bar** | Shows the card and field under the cursor, e.g. `CQUAD4 › THETA/MCID · field 8`. |
| **Field shading** | Every other field of fixed-format cards is shaded, so you can see field boundaries in both small (8) and large (16) field cards. Toggle with *Nastran: Toggle Field Column Shading*. |
| **Format conversion** | Convert the card under the cursor, or every card in the selection, to **small field**, **large field** or **free field** (right-click → *Nastran*, the light bulb, or `Ctrl+Alt+8` / `Ctrl+Alt+6` / `Ctrl+Alt+,`). Reals are rounded to the most precise value that fits the field width, and you are told when rounding happened. Free field switches to the `NAME*,` large form instead of losing precision. |
| **Format whole file** | Click the wand button in the editor title bar, press `Ctrl+Alt+F` or `Shift+Alt+F`, or right-click → *Nastran* → *Format All Cards in File*. No selection needed: every bulk data card is re-aligned in its current format, or converted (`nastran.format.defaultStyle`). By default numbers are right-justified and text (`YES`, `THRU`, `K` …) left-justified in fields 2-9, the way FEMAP writes decks (`nastran.format.alignment`: `mixed`, `right`, `left`); Nastran accepts any of them, only field 1 must be left-justified. |
| **INCLUDE support** | INCLUDE paths are clickable (Ctrl+Click), including paths split over several lines. Missing files are reported. IDs are resolved across the include tree. |
| **Go to definition / Find references** | `F12` on a PID, MID, grid, CID, SID … jumps to the referenced card, also across INCLUDE files and the workspace. In case control, `LOAD = 10`, `SPC = 1`, `METHOD = 3` etc. jump to the bulk data, and output requests like `STRESS = 5` jump to `SET 5`. `Shift+F12` on a card's ID lists every card that references it. |
| **Diagnostics** | Integers in real fields (`0` instead of `0.`), exponents without a decimal point (`2E11`), embedded blanks or values that spilled over into the next field, text beyond column 80, free-field lines with too many fields, continuation lines without a parent, duplicate grid/element/property/material/coordinate IDs, required fields left blank, and missing INCLUDE files. |
| **Quick fixes** | Add the missing decimal point, for one field or the whole file. |
| **Completion** | Card names with a template for every field, `PARAM` names, case control commands and their describers (`SORT1`, `PLOT`, `CORNER` …), and `SOL` numbers. |
| **Outline** | Executive / Case / Bulk sections, subcases, and cards grouped by type with counts. Decks from Simcenter are outlined by their headers instead (sections, card groups, mesh collectors, meshes, properties, materials …), with the card counts of each header in its detail (`3960 CQUAD4`). With VS Code's **sticky scroll** on (the default), the headers you are in stay pinned at the top of the editor while you scroll, e.g. `$* BULK DATA` › `$* ELEMENT CARDS` › `$*  Mesh Collector: Thin Shell(1)` › `$*  Mesh: 2d_mesh(1)`. |
| **Folding** | File Management (`NASTRAN`, `ASSIGN`, `INIT` …), Executive Control, Case Control (from `CEND`) and Bulk Data (from `BEGIN BULK`), `BEGIN SUPER=` parts, subcases, `OUTPUT(PLOT/XYPLOT)` blocks, multi-line `SET`s, DMAP `COMPILE`/`ALTER` packages, runs of consecutive cards by category (grids & coordinate systems, elements, properties, materials, constraints, loads, parameters …) and by card type (`CQUAD4`, `CTRIA3`, `CHEXA` …), multi-line cards and comment blocks. A comment directly above a run (e.g. `$ Nodes of the Entire Model`) becomes its title. Add your own folds with `$ #region name` … `$ #endregion`. Turn card-run folding off with `nastran.folding.cardGroups`. **Decks from Simcenter** fold by the headers the translator writes: the banner, the boxed sections (`$* EXECUTIVE CONTROL`, `$* BULK DATA` …), the card groups (`$* GRID CARDS`, `$* ELEMENT CARDS` …), and inside them each mesh collector with its meshes, property (with its section), material, load, constraint and modeling object (`$*  Mesh Collector: Thin Shell(1)` / `$*  Mesh: 2d_mesh(1)`). Each fold starts on the header's title, so *Fold All* (`Ctrl+K Ctrl+0`) or *Fold All Regions* (`Ctrl+K Ctrl+8`) turns the deck into a table of contents. Boxed titles in other decks (`$-----` / `$ Title` / `$-----`) fold the same way, and so do underlined titles (`$ Title` / `$-----`) such as the design variable section ATA Attune appends to SOL 200 decks (`$ Design Variables Added by Attune (date)`, with its DESVAR / DVPREL1 / DVMREL1 cards). Turn this off with `nastran.folding.commentHeaders`. |
| **Theme friendly** | Shading colors are theme colors with dark, light and high-contrast defaults, checked against all built-in themes. On themes with a gray hover highlight you can switch it to blue with one command (see [Hover highlight](#hover-highlight)). |
| **Matrices, punch and DMAP files** | DMIG and DMI entries (with separate layouts for the header and column entries), USET/USET1, results punch files written with e.g. `DISP(PUNCH)` (result records are recognized, not reported as errors), DMAP alter files (`COMPILE`/`ALTER` packages, hover help for common DMAP statements and modules), and INCLUDE files that contain only case control (e.g. a `SET` list). |
| **Output files (`.f06`)** | Open in their own language, *Nastran Output*, so they get none of the input deck features (card diagnostics, shading, formatting, card completion, the column 8/72/80 rulers) and word wrap is off. Editor settings for output files go under `"[nastran-output]"`. **Sections** come from the letter-spaced headings Nastran prints (`R E A L   E I G E N V A L U E S` → *REAL EIGENVALUES*). A table that runs over several pages repeats its heading on each page, and those pages form one section. The Outline lists every section with its subcase, the `FREQUENCY`/`TIME` range and the pages it covers. Each section folds, as does the header text before the first section (copyright notice, news file). With two or more SOL 200 design cycles, each cycle folds too. **Messages**: `*** USER FATAL MESSAGE …` and the other solver messages go to the Problems panel and the Outline, with the message text and any `***` lines printed above them (`nastran.f06.messages` sets which levels are listed: `fatal`, `warning` or `information`). The status bar shows the section under the cursor, and the message counts in its tooltip. Highlighting covers headings, messages, page headers and `END OF JOB`. |
| **Private definitions** | Add your own or your company's cards, PARAMs (e.g. parameters read by in-house DMAP alters), case control commands, DMAP statements and notes for INCLUDE files in local JSON files. They are never part of the extension. See [Private definitions](#private-definitions). |
| **Comment wrapping** | While you type in a `$` comment line, the last word moves to a new comment line (same indentation and `$` prefix) as soon as the line gets longer than column 80. *Format Document* / *Format Selection* also wrap long comment lines (including comments inside or after a card), and *Nastran: Wrap Long Comment Lines* wraps only the comments in the selection or the whole file. |
| **Model summary** | *Nastran: Show Card Count Summary* lists the include tree and card counts per type. |
| **Syntax highlighting** | Comments, section keywords, card names, continuation markers, numbers (including Nastran's `1.5-3` exponent form), describers and INCLUDE paths. Simcenter header comments (`$* BULK DATA`, `$*  Mesh: 2d_mesh(1)`) are colored as headings, like the section headings of `.f06` files. |

The card database covers about 160 common MSC Nastran bulk data entries (geometry, elements, properties, materials,
constraints, loads, dynamics, nonlinear, optimization, aeroelastic, contact), roughly 100 case control commands,
executive statements, solution sequences and common PARAMs.

## Nastran format reminder

```
         1       2       3       4       5       6       7       8       9      10
$-------|-------|-------|-------|-------|-------|-------|-------|-------|-------|
CQUAD4  10      1       101     102     103     104     0.      .002            small field
+               1       1.      1.      1.      1.                              continuation
CQUAD4* 10              1               101             102                     large field (16)
*       103             104             0.              .002                    continuation (*)
CQUAD4,10,1,101,102,103,104,0.,.002                                             free field
+,,1,1.,1.,1.,1.
```

* Small field: ten 8-character fields. Field 1 is the card name, fields 2–9 are data, and field 10 is the continuation marker.
* Large field: the name gets a `*`. Data fields are 16 characters wide, so one small-field line becomes two lines. Continuation lines start with `*`.
* Free field: values separated by commas, at most 8 data fields per line.
* Real numbers **must** contain a decimal point (`0.`, `.5`, `1.5-3`, `2.+11`). Integers must not.
* Exponents: the extension recommends and writes the compact shorthand without `E` (`2.+11`, `1.5-3`), which saves a
  character in 8-character fields. `2.E+11` and `2.E11` are equally valid and are never flagged or rewritten unless a
  value has to be shortened to fit a field. `2E11` and `2+11` are invalid (no decimal point).
* Everything after `$` is a comment, and everything after column 80 is ignored.

## Settings

| Setting | Default | |
|---|---|---|
| `nastran.format.defaultStyle` | `preserve` | What *Format Document* does: `preserve`, `small`, `large`, `free` |
| `nastran.format.alignment` | `mixed` | `mixed` (numbers right, text left, FEMAP style), `right` (NX I-deas / pyNastran style) or `left`, for fields 2-9 of fixed-format cards |
| `nastran.format.continuationMarker` | `+` | Small-field continuation marker, written in field 1 of the continuation line and field 10 of the line before it (empty = blank continuation) |
| `nastran.format.uppercase` | `true` | Upper-case names and character values when formatting |
| `nastran.completion.style` | `free` | Card template: `free` (tab stop per field) or `fixed` (`$` header with field names + aligned card) |
| `nastran.fieldShading.enabled` | `true` | Shade alternate fields |
| `nastran.diagnostics.enabled` | `true` | Enable diagnostics |
| `nastran.diagnostics.unknownCards` | `false` | Report cards that are not in the database |
| `nastran.diagnostics.duplicateIds` | `true` | Warn about duplicate IDs within a file |
| `nastran.folding.cardGroups` | `true` | Fold runs of cards by category and by card type |
| `nastran.folding.commentHeaders` | `true` | Fold by comment headers (Simcenter sections, card groups, mesh collectors, meshes …) |
| `nastran.comments.autoWrap` | `true` | Wrap `$` comment lines while typing |
| `nastran.comments.wrapColumn` | `80` | Maximum comment line length for wrapping |
| `nastran.format.wrapComments` | `true` | Format Document / Format Selection wrap long comment lines |
| `nastran.includePaths` | `[]` | Extra directories for resolving relative INCLUDE paths |
| `nastran.index.searchWorkspace` | `true` | Search the whole workspace when an ID is not in the include tree |
| `nastran.f06.messages` | `warning` | Solver messages of `.f06` files listed in the Problems panel and Outline: `fatal`, `warning` (FATAL + WARNING) or `information` (all) |
| `nastran.maxLinesForAnalysis` | `400000` | Larger files skip diagnostics, shading and the status bar item |

Shading colors can be changed per theme with `workbench.colorCustomizations`:
`nastran.fieldShadingBackground` (normal lines) and `nastran.fieldShadingActiveLineBackground` (the cursor line and
selected lines; slightly stronger, because it is drawn on top of the line highlight and has to keep the same contrast). Keep them translucent (8-digit hex) so
selections stay visible.

### Hover highlight

The box around a hovered field is VS Code's own `editor.hoverHighlightBackground` theme color, which extensions
cannot restyle per language. Most themes use a blue that stays distinct from the field shading. VS Code's
2026 default themes (*Dark 2026*, *Light 2026*) use a neutral gray instead, and a hovered field then blends with its
shaded neighbors. For those two themes the extension offers once (dismissible) to switch the hover highlight to a subtle
blue. You can also do it at any time:

* *Nastran: Use Blue Hover Highlight for Current Theme* adds a `"[<theme>]": { "editor.hoverHighlightBackground": ... }`
  entry to your user `workbench.colorCustomizations`. It is scoped to the current theme and applies to all file types in
  that theme. If you already set a hover color for the theme, it asks before replacing it.
* *Nastran: Remove Blue Hover Highlight for Current Theme* removes that entry again.

The extension never changes your settings unless you run one of these commands or accept the prompt.

The extension also sets `[nastran]` editor defaults: tab size 8 with spaces (so `Tab` jumps to the next field) and rulers at columns 8, 72 and 80.

## Private definitions

Some decks use cards, PARAMs or DMAP alters that are specific to a company or to third-party tools. Knowledge about
those should not be published with an extension, so the extension reads it from local JSON files instead:

* every `*.json` file in `~/.nastran/definitions/` (*Nastran: Open Private Definitions Folder* creates and opens it), and
* any files or folders listed in the `nastran.definitionFiles` setting (supports `~`, `${userHome}`, `${workspaceFolder}`).

Files in that folder get completion and validation in VS Code. Changes are picked up automatically (or run
*Nastran: Reload Private Definitions*); problems are listed in the **Nastran** output channel. Hovers show which file an
item came from. Example:

```json
{
  "name": "ACME in-house",
  "params": [
    { "name": "MYFILT", "desc": "Filter used by the ACME reduction alter", "values": "real", "default": "1.0" }
  ],
  "cards": [
    {
      "name": "ACMEPT", "group": "ACME", "desc": "Measurement point", "idSpace": "grid",
      "fields": [["ID", "I!", "Point ID"], ["G", "I", "Grid it is attached to", "grid"], ["DIR", "S", "Direction label"]]
    }
  ],
  "caseCommands": [{ "name": "ACMEOUT", "desc": "Selects the ACME output set", "output": true }],
  "statements": { "ACMESUB": "In-house subDMAP that writes the reduced matrices" },
  "includes": [{ "pattern": "acme_reduce.*", "desc": "ACME reduction alter: include before CEND in SOL 103" }],
  "refGroups": { "acmePoint": ["ACMEPT"] }
}
```

Field tuples are `[name, type, description, reference group]` as in the built-in database (see
[Adding or correcting cards](#adding-or-correcting-cards)); cards with the same name as a built-in card replace it.
To associate additional file extensions with Nastran (for example version-specific alter files), add them to your own
`files.associations` setting.

## Build, run and test

Requires Node.js 18+.

```sh
npm install
npm run compile          # TypeScript -> out/
npm test                 # parser / formatter unit tests (node:test)
npm run test:vscode      # smoke tests inside a downloaded VS Code
npm run package          # build a .vsix (install with "Extensions: Install from VSIX...")
```

Press `F5` in VS Code to open an Extension Development Host with the `samples/` folder:

* `samples/model.bdf`: a small model with executive control, case control, subcases and INCLUDEs.
* `samples/mistakes.bdf`: common input mistakes, to show the diagnostics and quick fixes.
* `samples/simcenter.dat`: a made-up deck with the comment headers Simcenter writes, to show header folding.
* `samples/attune_sol200.dat`: a made-up SOL 200 deck with the design variable section ATA Attune appends.
* `samples/modes.f06`: a short made-up SOL 103 output file, to show the output outline, folding and messages.

> If you run `npm run test:vscode` from a terminal inside VS Code, unset `ELECTRON_RUN_AS_NODE` first, or the test instance will not start.

### Checking colors against themes

`scripts/theme-contrast.py` blends the shading colors from `package.json` over every installed color theme (VS Code's
built-in themes and any themes in `~/.vscode/extensions`). For each theme it prints the shading contrast on normal and active
lines, and whether the theme's hover highlight blends with the shading. Run it after changing a color default:

```sh
python scripts/theme-contrast.py --min-step 8      # exit code 1 if any theme falls below the minimum contrast
python scripts/theme-contrast.py path/to/some-theme-extension
```

### Cross-check with pyNastran

The small/large/free-field writer has been checked against pyNastran (1.4.1). Every card written by the extension
reads back with the same values:

```sh
node out/test/roundtrip.js samples/model.bdf out/roundtrip
python test/roundtrip_pynastran.py out/roundtrip     # needs pyNastran (and numpy < 2 for pyNastran 1.4)
```

## Project layout

```
src/parser/      deck parser (sections, cards, continuations, INCLUDE, case control), value helpers, card writer,
                 .f06 output scanner (f06.ts: headings, sections, messages, design cycles)
src/data/        card definitions, reference groups, case control / executive / PARAM knowledge
src/features/    VS Code providers: hover, completion, diagnostics + quick fixes, formatting, navigation, editor UI
src/model.ts     document cache, INCLUDE resolution, cross-file ID index
syntaxes/        TextMate grammars (input decks, .f06 output)
scripts/         theme contrast check, icon generator (build_icon.py, needs PySide6)
images/          extension icon and the brain tile it is drawn on (scripts/build_icon.py)
test/            unit tests, VS Code smoke tests, pyNastran round-trip check
```

### Adding or correcting cards

Cards are defined in `src/data/cards.ts` as one tuple per data field:

```ts
card('CROD', EL, 'Tension-compression-torsion rod element', [
  ['EID', 'I!', 'Element identification number'],          // I = integer, ! = required
  ['PID', 'I', 'PROD property ID (default EID)', 'rodProp'], // 4th entry = reference group (src/data/refs.ts)
  ['G1', 'I!', 'Grid point ID', 'grid'],
  ['G2', 'I!', 'Grid point ID', 'grid'],
], { id: 'element' });
```

Types: `I` integer, `R` real, `S` character, combinations such as `IR` or `RS`, and `A` any. Field index 0 is field 2 of
the first line. Each continuation line adds 8 fields. Open-ended lists use `repeat`. The descriptions are short summaries.
Always check the MSC Nastran Quick Reference Guide for the full rules of a card.

## Limitations / ideas for later

* The card database does not cover every entry. Field types are only checked for known cards.
* Field layouts follow MSC Nastran. Simcenter (NX) Nastran differs on some entries.
* Unresolved references are not reported yet (the defining card may be in a parent deck).
* Parsing is not incremental. Files over `nastran.maxLinesForAnalysis` lines get syntax highlighting, hover and navigation only.
* Design cycle grouping is based on the `DESIGN CYCLE NUMBER = n` lines. It has been checked on SOL 200 runs with a single
  cycle, and on made-up output with several.
* Possible next steps: jump from a grid/element ID in an `.f06` table to its card in the deck, punch result navigation, a DMIG/DTI layout, PARAM value checks, a rename refactoring for IDs, and generating card definitions from pyNastran.
