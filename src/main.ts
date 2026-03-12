import { Plugin, renderMath, finishRenderMath, PluginSettingTab, App, Setting } from "obsidian";
import { tryRepairFormula, RepairResult } from "./repair";

interface TolerantMathSettings {
    enableRepair: boolean;
    showRepairIndicators: boolean;
    gracefulFallback: boolean;
}

const DEFAULT_SETTINGS: TolerantMathSettings = {
    enableRepair: true,
    showRepairIndicators: true,
    gracefulFallback: true,
};

let pluginSettings: TolerantMathSettings = DEFAULT_SETTINGS;
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
        const rendered = tryRenderMath(this.formula, false);
        if (rendered) {
            span.appendChild(rendered);
        } else if (pluginSettings.enableRepair) {
            const repair = tryRepairFormula(this.formula);
            if (repair) {
                const repaired = createRepairedMath(this.formula, repair, false, pluginSettings.showRepairIndicators);
                span.appendChild(repaired ?? (pluginSettings.gracefulFallback ? createGracefulFallback(this.formula) : document.createTextNode(`$ ${this.formula} $`)));
            } else {
                span.appendChild(pluginSettings.gracefulFallback ? createGracefulFallback(this.formula) : document.createTextNode(`$ ${this.formula} $`));
            }
        } else {
            span.appendChild(pluginSettings.gracefulFallback ? createGracefulFallback(this.formula) : document.createTextNode(`$ ${this.formula} $`));
        }
        return span;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

// ── Repair helpers ──────────────────────────────────────────────────────────

function hasRenderError(el: HTMLElement): boolean {
    return (
        el.querySelector(".katex-error") !== null ||
        el.querySelector(".mje-error") !== null ||
        el.querySelector(".mathjax-error") !== null ||
        el.classList.contains("katex-error")
    );
}

function tryRenderMath(latex: string, isBlock: boolean): HTMLElement | null {
    try {
        const el = renderMath(latex, isBlock);
        if (hasRenderError(el)) return null;
        return el;
    } catch {
        return null;
    }
}

function createGracefulFallback(formula: string): HTMLElement {
    const span = createEl("span", { cls: "tolerant-math-fallback" });
    span.textContent = `$${formula}$`;
    span.style.color = "var(--text-muted)";
    span.style.fontFamily = "var(--font-monospace)";
    span.style.fontSize = "0.9em";
    return span;
}

function createRepairedMath(
    formula: string,
    repair: RepairResult,
    isBlock: boolean,
    showIndicator: boolean = true,
): HTMLElement | null {
    const mathEl = tryRenderMath(repair.repaired, isBlock);
    if (!mathEl) return null;
    mathEl.classList.add("tolerant-math-repaired");
    if (showIndicator) {
        mathEl.style.borderBottom = "1px dashed rgba(255, 165, 0, 0.4)";
        mathEl.title = `Auto-repaired: ${repair.description}`;
    }
    return mathEl;
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
    settings: TolerantMathSettings = DEFAULT_SETTINGS;

    async onload() {
        await this.loadSettings();
        pluginSettings = this.settings;
        this.addSettingTab(new TolerantMathSettingTab(this.app, this));

        // Live Preview
        this.registerEditorExtension(tolerantMathViewPlugin);

        // Reading View
        this.registerMarkdownPostProcessor((element) => {
            this.processElement(element);
        });

        // Dev command: repair report
        this.addCommand({
            id: "show-repair-report",
            name: "Show Repair Report",
            callback: () => this.showRepairReport(),
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
        pluginSettings = this.settings;
    }

    private showRepairReport() {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            console.log("[tolerant-math] No active file");
            return;
        }
        this.app.vault.cachedRead(file).then((content) => {
            const formulaRe = /\$\$(.*?)\$\$|\$(?!\$)(.*?)\$(?!\$)/gs;
            let total = 0, original_ok = 0, repaired = 0, fallback = 0;
            const ruleCount: Record<string, number> = {};
            let m: RegExpExecArray | null;
            while ((m = formulaRe.exec(content)) !== null) {
                const formula = (m[1] ?? m[2]).trim();
                total++;
                const rendered = tryRenderMath(formula, false);
                if (rendered) {
                    original_ok++;
                } else {
                    const repair = tryRepairFormula(formula);
                    if (repair) {
                        const repairedEl = tryRenderMath(repair.repaired, false);
                        if (repairedEl) {
                            repaired++;
                            for (const r of repair.applied) {
                                const key = r.split(":")[0];
                                ruleCount[key] = (ruleCount[key] || 0) + 1;
                            }
                        } else { fallback++; }
                    } else { fallback++; }
                }
            }
            finishRenderMath();
            const rules = Object.entries(ruleCount).map(([k, v]) => `${k}×${v}`).join(", ");
            console.log(
                `[tolerant-math] Repair report for ${file.name}:\n` +
                `  Total formulas scanned: ${total}\n` +
                `  Rendered successfully (original): ${original_ok}\n` +
                `  Repaired and rendered: ${repaired}\n` +
                `  Graceful fallback (unfixable): ${fallback}\n` +
                `  Rules applied: ${rules || "(none)"}`
            );
        });
    }

    // Unwrap inline formatting elements (em, strong, span, etc.) that interfere
    // with $ ... $ pattern matching. Obsidian's markdown parser consumes * and _
    // as emphasis and \ before ASCII punctuation as escapes, creating elements
    // that split text nodes across boundaries and preventing regex matching.
    // Runs multiple passes: each pass unwraps elements adjacent to $, then
    // normalize() merges text nodes, propagating $ closer to remaining elements.
    private unwrapInlineFormattingNearDollars(element: HTMLElement): void {
        // Gate: only run if the element's full text actually contains a $ ... $ pattern.
        // This prevents unwrapping in elements that only have $ as currency (e.g. "$5").
        TOLERANT_MATH_REGEX.lastIndex = 0;
        if (!TOLERANT_MATH_REGEX.test(element.textContent ?? "")) return;
        TOLERANT_MATH_REGEX.lastIndex = 0;

        const SKIP_CLASSES = ["math", "math-inline", "math-block"];
        const SELECTOR = "em, strong, span, del, s";
        const MAX_PASSES = 10;

        let changed: boolean;
        let pass = 0;
        do {
            if (++pass > MAX_PASSES) break;
            changed = false;
            const inlineEls = Array.from(element.querySelectorAll(SELECTOR));

            for (const el of inlineEls) {
                const parent = el.parentNode;
                if (!parent) continue;

                // Skip elements with math-related classes
                if (el instanceof HTMLElement) {
                    if (SKIP_CLASSES.some(c => el.classList.contains(c))) continue;
                    // For <span>, only unwrap classless spans (backslash-escape artifacts);
                    // preserve Obsidian UI spans that carry styling classes
                    if (el.tagName === "SPAN" && el.classList.length > 0) continue;
                }

                // Only unwrap if this element or its immediate siblings contain $
                const prev = el.previousSibling?.textContent ?? "";
                const next = el.nextSibling?.textContent ?? "";
                const self = el.textContent ?? "";
                if (!prev.includes("$") && !next.includes("$") && !self.includes("$")) continue;

                // Safety: if the element content is plain text (no LaTeX metacharacters
                // like \, {, }, ^), it is likely legitimate formatting (e.g. bold headings)
                // rather than formula fragments. Only unwrap if $ is on BOTH sides,
                // meaning the element is genuinely between formula delimiters.
                if (!/[\\{}^]/.test(self) && !self.includes("$")) {
                    if (!prev.includes("$") || !next.includes("$")) continue;
                }

                // Replace element with its children
                while (el.firstChild) {
                    parent.insertBefore(el.firstChild, el);
                }
                parent.removeChild(el);
                changed = true;
            }

            // Merge adjacent text nodes so $ propagates to remaining elements
            if (changed) element.normalize();
        } while (changed);
    }

    private processElement(element: HTMLElement): void {
        if (!element.textContent?.includes("$")) return;

        // Pre-pass: unwrap inline formatting spuriously created by * / _ / \ escapes inside $ ... $
        this.unwrapInlineFormattingNearDollars(element);

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
            const rendered = tryRenderMath(formula, false);
            if (rendered) {
                rendered.classList.add("tolerant-math-inline");
                fragment.appendChild(rendered);
                didReplace = true;
            } else if (pluginSettings.enableRepair) {
                const repair = tryRepairFormula(formula);
                if (repair) {
                    const repaired = createRepairedMath(formula, repair, false, pluginSettings.showRepairIndicators);
                    if (repaired) {
                        repaired.classList.add("tolerant-math-inline");
                        fragment.appendChild(repaired);
                    } else {
                        fragment.appendChild(pluginSettings.gracefulFallback ? createGracefulFallback(formula) : document.createTextNode(match[0]));
                    }
                } else {
                    fragment.appendChild(pluginSettings.gracefulFallback ? createGracefulFallback(formula) : document.createTextNode(match[0]));
                }
                didReplace = true;
            } else {
                fragment.appendChild(pluginSettings.gracefulFallback ? createGracefulFallback(formula) : document.createTextNode(match[0]));
                didReplace = true;
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

// ── Settings Tab ────────────────────────────────────────────────────────────

class TolerantMathSettingTab extends PluginSettingTab {
    plugin: TolerantMathPlugin;

    constructor(app: App, plugin: TolerantMathPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName("Enable auto-repair")
            .setDesc("Try to fix broken formulas before rendering")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableRepair)
                    .onChange(async (value) => {
                        this.plugin.settings.enableRepair = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Show repair indicators")
            .setDesc("Show dashed underline on auto-repaired formulas")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showRepairIndicators)
                    .onChange(async (value) => {
                        this.plugin.settings.showRepairIndicators = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Graceful fallback")
            .setDesc("Show muted source text instead of red errors for unfixable formulas")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.gracefulFallback)
                    .onChange(async (value) => {
                        this.plugin.settings.gracefulFallback = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}
