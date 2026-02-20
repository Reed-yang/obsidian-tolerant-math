# CLAUDE.md — obsidian-tolerant-math

This file gives AI assistants context about this project so they can work on it effectively.

---

## What This Plugin Does

Obsidian refuses to render inline math when the dollar sign delimiters have spaces inside them (e.g., `$ formula $`). This is intentional behavior to avoid misidentifying prices. This plugin patches that gap for users whose notes — typically OCR-generated — consistently use the spaced format.

The plugin operates **entirely at the rendering layer**. It never reads, writes, or modifies `.md` source files.

---

## Architecture

All logic lives in a single file: **`src/main.ts`**.

The plugin registers two independent rendering mechanisms:

### 1. Reading View — `registerMarkdownPostProcessor`

Runs after Obsidian has parsed Markdown into HTML. At that point, unrecognized `$ formula $` patterns exist as plain text nodes in the DOM.

**Flow:**
1. Obsidian calls the post-processor with a rendered `HTMLElement`
2. `processElement()` creates a `TreeWalker` (type `SHOW_TEXT`) to find text nodes
3. Nodes inside `CODE`, `PRE`, `MATH`, `SCRIPT`, or elements with class `.math` / `.math-inline` / `.math-block` are skipped
4. Nodes without a `$` character are skipped (fast pre-filter)
5. All candidate nodes are **collected first**, then processed — this avoids DOM mutation invalidating the walker mid-traversal
6. `replaceTextNodeWithMath()` splits each text node into a `DocumentFragment`, replacing matched spans with elements returned by `renderMath(formula, false)`
7. `finishRenderMath()` is called once per `processElement()` invocation to flush the MathJax render queue

### 2. Live Preview — CodeMirror 6 `ViewPlugin`

Runs inside the CM6 editor. Matched text ranges are hidden with `Decoration.replace` and replaced visually by a `WidgetType` that renders the formula.

**Flow:**
1. `tolerantMathViewPlugin` is registered via `registerEditorExtension()`
2. On construction and on each `update()` (triggered by `docChanged`, `viewportChanged`, or `selectionSet`), `buildDecorations()` is called
3. Only `view.visibleRanges` are scanned (performance: avoids processing off-screen content)
4. For each regex match, the plugin checks whether any cursor selection overlaps the match range. If so, the decoration is **skipped** — this exposes the raw source text for editing
5. `RangeSetBuilder` assembles decorations in ascending order (required by CM6)
6. `finishRenderMath()` is called once at the end of `buildDecorations()` if any widgets were created

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

**Single-file architecture**: The plugin logic is compact enough that splitting into multiple files adds indirection without benefit. Keep all logic in `src/main.ts` unless the file grows substantially.

**No settings UI**: The plugin has no configurable options by design. All behavior is determined by the regex. If a settings panel is added later, follow the pattern in `inline-math/main.js` (the co-installed plugin) — it uses `Plugin.loadData()` / `saveData()` with a typed settings object.

**Do not modify source files**: This is the core constraint. Any approach that writes to `.md` files violates the plugin's purpose. All changes must be in-memory, in the rendering layer only.

**`finishRenderMath()` placement**: Call it once after a batch of `renderMath()` calls, not after each individual call. In Reading View, the call is at the end of `processElement()`. In Live Preview, it is at the end of `buildDecorations()`. Calling it too frequently causes unnecessary MathJax re-renders.

**Cursor detection in Live Preview**: The check `cursors.some(r => r.from <= matchTo && r.to >= matchFrom)` uses an inclusive overlap test. This ensures that clicking anywhere within the formula (including on the `$` delimiters) reveals the source text.

**TreeWalker node collection before mutation**: If you process text nodes inline while walking, replacing a node removes it from the DOM, which can disrupt the walker's internal pointer. Always collect all target nodes into an array first, then iterate the array for replacement.

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

---

## Future Extension Ideas

- Support for right-space-only format: `$formula $` (currently not matched)
- Support for `\( ... \)` inline math delimiters (another LaTeX convention Obsidian doesn't support)
- Settings panel to toggle Reading View / Live Preview independently
- Option to require at least one LaTeX-specific character (`\`, `^`, `_`, `{`) to reduce false positives in mixed-content documents
