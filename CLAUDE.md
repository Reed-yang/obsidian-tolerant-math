# CLAUDE.md — obsidian-tolerant-math

This file gives AI assistants context about this project so they can work on it effectively.

---

## What This Plugin Does

Obsidian refuses to render inline math when the dollar sign delimiters have spaces inside them (e.g., `$ formula $`). This is intentional behavior to avoid misidentifying prices. This plugin patches that gap for users whose notes — typically OCR-generated — consistently use the spaced format.

The plugin operates **entirely at the rendering layer**. It never reads, writes, or modifies `.md` source files.

---

## Architecture

The plugin has two source files:

- **`src/main.ts`** — Plugin entry point: regex matching, rendering pipelines (Reading View + Live Preview), settings UI, repair report command.
- **`src/repair.ts`** — LaTeX formula repair engine: exports `tryRepairFormula()` and `RepairResult`. Contains rules R1, R4, P1–P5 (see Repair Engine section below).

The plugin registers two independent rendering mechanisms:

### 1. Reading View — `registerMarkdownPostProcessor`

Runs after Obsidian has parsed Markdown into HTML. At that point, unrecognized `$ formula $` patterns exist as plain text nodes in the DOM.

**Flow:**
1. Obsidian calls the post-processor with a rendered `HTMLElement`
2. `processElement()` first runs `unwrapInlineFormattingNearDollars()` — a multi-pass pre-pass that unwraps inline formatting elements (`<em>`, `<strong>`, classless `<span>`, `<del>`, `<s>`) near `$` characters. This is necessary because Obsidian's markdown parser consumes `*` and `_` inside formulas as emphasis markers (e.g., `$ ^{*1} $`, `$ K_{\mathcal{X}}..._{t} $`) and consumes `\` before ASCII punctuation as escapes (e.g., `\|` → `|`), splitting text nodes across element boundaries and preventing the regex from matching. The pre-pass has three safety layers: (a) a regex gate that skips elements without a valid `$ ... $` pattern, (b) a LaTeX content heuristic that only unwraps plain-text elements if `$` appears on both sides, and (c) a `MAX_PASSES` limit. After each pass, `element.normalize()` merges adjacent text nodes, propagating `$` characters closer to remaining inner elements for the next pass.
3. A `TreeWalker` (type `SHOW_TEXT`) finds text nodes
4. Nodes inside `CODE`, `PRE`, `MATH`, `SCRIPT`, or elements with class `.math` / `.math-inline` / `.math-block` are skipped
5. Nodes without a `$` character are skipped (fast pre-filter)
6. All candidate nodes are **collected first**, then processed — this avoids DOM mutation invalidating the walker mid-traversal
7. `replaceTextNodeWithMath()` splits each text node into a `DocumentFragment`. For each matched formula, it runs `tryRepairFormula()` (if repair is enabled), then passes the (possibly repaired) formula to `renderMath()`. Repaired formulas get a visual indicator (dashed underline) if the setting is on.
8. `finishRenderMath()` is called once per `processElement()` invocation to flush the MathJax render queue

### 2. Live Preview — CodeMirror 6 `ViewPlugin`

Runs inside the CM6 editor. Matched text ranges are hidden with `Decoration.replace` and replaced visually by a `WidgetType` that renders the formula.

**Flow:**
1. `tolerantMathViewPlugin` is registered via `registerEditorExtension()`
2. On construction and on each `update()` (triggered by `docChanged`, `viewportChanged`, or `selectionSet`), `buildDecorations()` is called
3. Only `view.visibleRanges` are scanned (performance: avoids processing off-screen content)
4. For each regex match, the plugin checks whether any cursor selection overlaps the match range. If so, the decoration is **skipped** — this exposes the raw source text for editing
5. `RangeSetBuilder` assembles decorations in ascending order (required by CM6)
6. `TolerantMathWidget.toDOM()` runs `tryRepairFormula()` (if repair is enabled), then passes the (possibly repaired) formula to `renderMath()`. Repaired formulas get a visual indicator.
7. `finishRenderMath()` is called once at the end of `buildDecorations()` if any widgets were created

---

## Core Regex

```typescript
const TOLERANT_MATH_REGEX = /(?<!\$)\$[ \t]+([^\$\n]+?)[ \t]+\$(?!\$)/g;
```

| Part | Rationale |
|------|-----------|
| `(?<!\$)` | Prevents matching the second `$` in `$$` |
| `[ \t]+` | Horizontal whitespace only — `\s` would allow newlines, breaking inline math semantics |
| `([^\$\n]+?)` | Lazy: stops at the first valid closing sequence; captures formula without surrounding spaces |
| `[ \t]+` | Mirrors the opening requirement |
| `(?!\$)` | Prevents the closing `$` from being the first `$` of a new `$$` |

**Important**: The regex uses the `g` flag. Always reset `lastIndex = 0` before reuse. The codebase does this explicitly at the top of every loop that calls `exec()`.

---

## Key APIs Used

| API | Source | Usage |
|-----|--------|-------|
| `renderMath(latex, isBlock)` | `obsidian` | Creates a MathJax-rendered DOM element; queues it for rendering |
| `finishRenderMath()` | `obsidian` | Flushes the MathJax render queue; must be called after `renderMath()` |
| `registerMarkdownPostProcessor()` | `obsidian` Plugin | Hooks into Reading View rendering pipeline |
| `registerEditorExtension()` | `obsidian` Plugin | Registers CM6 extensions for Live Preview |
| `ViewPlugin.fromClass()` | `@codemirror/view` | Creates a stateful editor plugin with decoration support |
| `Decoration.replace({ widget })` | `@codemirror/view` | Replaces a source range with a custom widget in the editor |
| `RangeSetBuilder` | `@codemirror/state` | Builds an ordered set of decorations (must be added in ascending `from` order) |
| `WidgetType` | `@codemirror/view` | Base class for CM6 widgets; `toDOM()` constructs the rendered element |
| `syntaxTree()` | `@codemirror/language` | Access CM6 syntax tree to detect native math nodes and avoid double-matching |
| `PluginSettingTab` | `obsidian` | Base class for plugin settings panels |
| `Setting` | `obsidian` | Builder for individual setting controls (toggles, text inputs, etc.) |

---

## Build System

- **Bundler**: esbuild (via `esbuild.config.mjs`)
- **Language**: TypeScript 5, compiled to ES2018 CJS
- **Output**: `main.js` in the project root
- **External modules**: All `@codemirror/*` and `obsidian` are marked external — they are provided by Obsidian at runtime and must NOT be bundled. Bundling them would create a second CM6 instance that conflicts with Obsidian's, causing subtle failures (e.g., `instanceof` checks breaking across module boundaries).

```bash
npm run dev      # watch mode (development)
npm run build    # production build (no sourcemaps)
```

---

## Design Decisions & Constraints

**Two-file architecture**: `src/main.ts` handles Obsidian integration (rendering pipelines, settings UI, commands). `src/repair.ts` is a pure-function repair engine with no Obsidian dependencies. This separation keeps the repair logic testable and reusable.

**Settings**: The plugin has a `TolerantMathSettings` interface with two boolean toggles: `enableRepair` (auto-repair broken formulas before rendering) and `showRepairIndicators` (dashed underline on repaired formulas). Settings are persisted via `Plugin.loadData()` / `saveData()`. A module-level `pluginSettings` variable is used by the ViewPlugin (which cannot access the plugin instance). **Known limitation**: toggling `enableRepair` ON may require restarting Obsidian to take effect (toggling OFF works immediately).

**Do not modify source files**: This is the core constraint. Any approach that writes to `.md` files violates the plugin's purpose. All changes must be in-memory, in the rendering layer only.

**`finishRenderMath()` placement**: Call it once after a batch of `renderMath()` calls, not after each individual call. In Reading View, the call is at the end of `processElement()`. In Live Preview, it is at the end of `buildDecorations()`. Calling it too frequently causes unnecessary MathJax re-renders.

**Cursor detection in Live Preview**: The check `cursors.some(r => r.from <= matchTo && r.to >= matchFrom)` uses an inclusive overlap test. This ensures that clicking anywhere within the formula (including on the `$` delimiters) reveals the source text.

**TreeWalker node collection before mutation**: If you process text nodes inline while walking, replacing a node removes it from the DOM, which can disrupt the walker's internal pointer. Always collect all target nodes into an array first, then iterate the array for replacement.

**Inline formatting unwrapping in Reading View**: Obsidian's markdown parser runs before the post-processor. When formulas contain `*` or `_` (e.g., `$ ^{*1} $` for author affiliations, `$ K_{\mathcal{X}}..._{t} $` for subscripts), the parser may consume these as emphasis markers, wrapping parts of the text in `<em>` tags. Similarly, `\` before ASCII punctuation (e.g., `\|` for norms) is consumed as a Markdown escape, potentially creating `<span>` elements. Both cases split the `$ ... $` pattern across multiple text nodes, making regex matching impossible. The fix is a multi-pass pre-pass (`unwrapInlineFormattingNearDollars`) that unwraps `<em>`, `<strong>`, classless `<span>`, `<del>`, and `<s>` elements near `$` characters. Safety guards prevent unwrapping legitimate formatting: (1) a regex gate skips elements without `$ ... $` patterns (avoids `$5` price triggers), (2) elements with plain-text content (no `\{}^` characters) require `$` on both sides, and (3) `<span>` elements with CSS classes are preserved. This does not affect Live Preview (which operates on raw source text via CM6).

**Known limitation — backslash escapes in formulas**: CommonMark consumes `\` before ASCII punctuation (`\|` → `|`, `\{` → `{`, etc.) during parsing, before the post-processor runs. In Reading View, these backslashes are lost. The repair engine (P5 rule) can restore `\left\{` / `\right\}` and similar delimiter-sizing commands (`\big\{`, `\Bigg\}`, etc.) because `\left{` and `\right}` are always invalid LaTeX — `{` is a grouping character, not a delimiter. However, `\|` (norm notation, double bar) becomes `|` which is valid LaTeX (single bar), so this case is **not repairable** — the repair engine cannot distinguish intentional `|` from corrupted `\|`. Additionally, Obsidian may wrap escaped characters in `<span>` elements (possibly with CSS classes), splitting text nodes and preventing the regex from matching. The multi-pass unwrap pre-pass only handles classless `<span>` elements; class-bearing spans are preserved to avoid breaking Obsidian UI. Live Preview is unaffected (operates on raw source text). Users can work around the `\|` issue by using `\Vert` instead.

---

## Reference Files (do not modify)

These are the two existing plugins in the same vault — useful for API usage patterns:

- `.obsidian/plugins/inline-math/main.js` — ViewPlugin + RangeSetBuilder + Decoration.replace + cursor detection pattern
- `.obsidian/plugins/obsidian-latex-suite/main.js` — `renderMath()` / `finishRenderMath()` usage in a WidgetType context

---

## Testing Checklist

When verifying changes, test all of the following in both Reading View and Live Preview:

| Test case | Expected result |
|-----------|----------------|
| `$ E = mc^2 $` | Renders as inline math |
| `$ \frac{a}{b} $` | Renders as inline math |
| `$ \alpha $ and $ \beta $` | Both render independently on the same line |
| `$E = mc^2$` | Renders normally (Obsidian native, unaffected) |
| `$$E = mc^2$$` | Renders as block math (Obsidian native, unaffected) |
| `` `$ formula $` `` | Displays as raw code, not rendered |
| `The price is $5 and $10.` | No math rendering |
| Cursor placed inside `$ formula $` (Live Preview) | Source text visible and editable |
| Cursor moved outside formula (Live Preview) | Re-renders as math |
| `$ ^{*1} $` (Reading View) | Renders as superscript (emphasis unwrapped) |
| `Text $ ^{*1} $ , more $ ^{*2} $` (Reading View) | Both render; no spurious italics |
| `$ K_{\mathcal{X}}..._{t}...\|...\| $` (Reading View) | Renders (formatting unwrapped); `\|` shown as `|` (known limitation) |
| `**Bold text** and $ formula $` (Reading View) | Bold preserved; formula renders |
| `The price is $5 and **important** text` (Reading View) | No math rendering; bold preserved |

---

## Repair Engine (`src/repair.ts`)

The repair engine applies a chain of deterministic rules to fix common LaTeX errors before rendering. It exports `tryRepairFormula(latex: string): RepairResult | null` which returns `null` if no repairs were needed, or a `RepairResult` with the repaired string and description.

**Architecture**: "Repair first, then render". MathJax renders asynchronously, so error CSS classes are not available synchronously after `renderMath()`. The plugin always runs repair *before* calling `renderMath()`, not as a fallback after a failed render.

### Rules (applied in this order)

| Rule | Name | What it fixes |
|------|------|---------------|
| R4 | Abbreviation spacing | `\mathrm{i . e .}` → `\mathrm{i.e.}` |
| R1 | Text command splitting | `\text{i f}` → `\text{if}` (single-letter-space sequences) |
| P5 | Escaped brace delimiters | `\left{` → `\left\{` (CommonMark consumed `\` before `{`/`}`) |
| P1 | Brace balance | Stack-based `{`/`}` matching; removes unmatched `}`, appends missing `}`. Skips `\{`/`\}` (LaTeX escapes). |
| P2 | `\left`/`\right` pairing | Appends `\right.` or prepends `\left.` for unpaired delimiters (≤3 mismatch). |
| P3 | Unclosed environments | Appends `\end{env}` for `\begin{env}` without matching end (≤2 unclosed). |
| P4 | Command name fuzzy repair | Levenshtein distance ≤2 against ~160 known KaTeX commands. Only fixes unambiguous single-best matches. |

### Commands

- **Show Repair Report** (`show-repair-report`): Scans all formulas in the active file and logs repair statistics to the developer console.

---

## Future Extension Ideas

- Support for right-space-only format: `$formula $` (currently not matched)
- Support for `\( ... \)` inline math delimiters (another LaTeX convention Obsidian doesn't support)
- Settings to toggle Reading View / Live Preview independently
- Option to require at least one LaTeX-specific character (`\`, `^`, `_`, `{`) to reduce false positives in mixed-content documents
- Graceful fallback for render errors: use `MutationObserver` or `requestAnimationFrame` to detect MathJax error classes post-render and replace with muted raw text (not possible synchronously due to MathJax async rendering)
