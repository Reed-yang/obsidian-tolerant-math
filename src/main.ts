import { Plugin, renderMath, finishRenderMath } from "obsidian";
import {
    Decoration,
    DecorationSet,
    EditorView,
    ViewPlugin,
    ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

// Matches spaced inline math: $ formula $
// (?<!\$) prevents matching the second $ of $$
// [ \t]+ requires at least one horizontal space inside (not \s to avoid newlines)
// ([^\$\n]+?) lazily captures the formula content (no newlines or $)
// (?!\$) prevents the closing $ from starting a new $$
const TOLERANT_MATH_REGEX = /(?<!\$)\$[ \t]+([^\$\n]+?)[ \t]+\$(?!\$)/g;

// ── Live Preview Widget ──────────────────────────────────────────────────────

class TolerantMathWidget extends WidgetType {
    constructor(private readonly formula: string) {
        super();
    }

    eq(other: TolerantMathWidget): boolean {
        return other.formula === this.formula;
    }

    toDOM(): HTMLElement {
        const span = createEl("span", { cls: "tolerant-math-widget" });
        try {
            const mathEl = renderMath(this.formula, false);
            span.appendChild(mathEl);
        } catch {
            span.textContent = `$ ${this.formula} $`;
        }
        return span;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

// ── Live Preview ViewPlugin ──────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const cursors = view.state.selection.ranges;

    // Collect native math node ranges to prevent the regex from matching across two adjacent native formulas
    const tree = syntaxTree(view.state);
    const nativeMathRanges: Array<{ from: number; to: number }> = [];
    for (const { from, to } of view.visibleRanges) {
        tree.iterate({
            from,
            to,
            enter(node) {
                if (node.name.toLowerCase().includes("math")) {
                    nativeMathRanges.push({ from: node.from, to: node.to });
                }
            },
        });
    }

    let needsFinish = false;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        TOLERANT_MATH_REGEX.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            const formula = match[1].trim();

            // Skip matches that overlap with native math nodes
            const overlapsNative = nativeMathRanges.some(
                (r) => r.from < matchTo && r.to > matchFrom
            );
            if (overlapsNative) continue;

            // Expose raw source when the cursor is inside the match (allow editing)
            const cursorInside = cursors.some(
                (r) => r.from <= matchTo && r.to >= matchFrom
            );
            if (cursorInside) continue;

            builder.add(
                matchFrom,
                matchTo,
                Decoration.replace({ widget: new TolerantMathWidget(formula) })
            );
            needsFinish = true;
        }
    }

    const decorations = builder.finish();
    if (needsFinish) finishRenderMath();
    return decorations;
}

const tolerantMathViewPlugin = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildDecorations(view);
        }

        update(update: ViewUpdate) {
            if (
                update.docChanged ||
                update.viewportChanged ||
                update.selectionSet
            ) {
                this.decorations = buildDecorations(update.view);
            }
        }
    },
    { decorations: (instance) => instance.decorations }
);

// ── Plugin main class ────────────────────────────────────────────────────────

export default class TolerantMathPlugin extends Plugin {
    async onload() {
        // Live Preview
        this.registerEditorExtension(tolerantMathViewPlugin);

        // Reading View
        this.registerMarkdownPostProcessor((element) => {
            this.processElement(element);
        });
    }

    private processElement(element: HTMLElement): void {
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: (node: Node): number => {
                    const parent = (node as Text).parentElement;
                    if (!parent) return NodeFilter.FILTER_REJECT;

                    // Skip code, preformatted, and already-rendered math elements
                    const tag = parent.tagName;
                    if (
                        tag === "CODE" ||
                        tag === "PRE" ||
                        tag === "MATH" ||
                        tag === "SCRIPT"
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }
                    if (
                        parent.classList.contains("math") ||
                        parent.classList.contains("math-inline") ||
                        parent.classList.contains("math-block")
                    ) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    // Fast pre-filter: skip nodes with no $ character
                    if (!node.textContent?.includes("$")) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );

        // Collect all target nodes first, then process — DOM mutation would invalidate the walker mid-traversal
        const nodesToProcess: Text[] = [];
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) {
            nodesToProcess.push(node as Text);
        }

        let didRender = false;
        for (const textNode of nodesToProcess) {
            if (this.replaceTextNodeWithMath(textNode)) {
                didRender = true;
            }
        }

        // Flush the MathJax render queue once for the whole batch
        if (didRender) finishRenderMath();
    }

    // Returns true if at least one formula was replaced
    private replaceTextNodeWithMath(textNode: Text): boolean {
        const text = textNode.textContent ?? "";

        TOLERANT_MATH_REGEX.lastIndex = 0;
        if (!TOLERANT_MATH_REGEX.test(text)) return false;
        TOLERANT_MATH_REGEX.lastIndex = 0;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        let match: RegExpExecArray | null;
        let didReplace = false;

        while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
            // Plain text before this match
            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            // Render the formula
            const formula = match[1].trim();
            try {
                const mathEl = renderMath(formula, false);
                mathEl.classList.add("tolerant-math-inline");
                fragment.appendChild(mathEl);
                didReplace = true;
            } catch {
                // Keep raw text if rendering fails
                fragment.appendChild(document.createTextNode(match[0]));
            }

            lastIndex = match.index + match[0].length;
        }

        // Remaining plain text after the last match
        if (lastIndex < text.length) {
            fragment.appendChild(
                document.createTextNode(text.slice(lastIndex))
            );
        }

        if (didReplace && textNode.parentNode) {
            textNode.parentNode.replaceChild(fragment, textNode);
        }

        return didReplace;
    }
}
