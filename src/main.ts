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

// 匹配内侧有空格的行内公式：$ formula $
// (?<!\$) 排除 $$ 块级公式开头
// [ \t]+ 要求内侧至少一个水平空白（不用 \s 以避免跨行）
// ([^\$\n]+?) 非贪婪捕获公式内容（不含换行和 $）
// (?!\$) 排除 $$ 块级公式结尾
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
    let needsFinish = false;

    for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        TOLERANT_MATH_REGEX.lastIndex = 0;

        let match: RegExpExecArray | null;
        while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
            const matchFrom = from + match.index;
            const matchTo = matchFrom + match[0].length;
            const formula = match[1].trim();

            // 光标在公式范围内时保留原始文本（允许编辑）
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

// ── Plugin 主类 ──────────────────────────────────────────────────────────────

export default class TolerantMathPlugin extends Plugin {
    async onload() {
        // Live Preview 支持
        this.registerEditorExtension(tolerantMathViewPlugin);

        // Reading View 支持
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

                    // 跳过代码、预格式化和已渲染的数学元素
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

                    // 快速过滤：文本中没有 $ 则跳过
                    if (!node.textContent?.includes("$")) {
                        return NodeFilter.FILTER_REJECT;
                    }

                    return NodeFilter.FILTER_ACCEPT;
                },
            }
        );

        // 先收集再处理，避免 DOM 修改影响 walker 状态
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

        // 批量触发 MathJax 渲染
        if (didRender) finishRenderMath();
    }

    // 返回 true 表示有公式被替换
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
            // 匹配前的纯文本
            if (match.index > lastIndex) {
                fragment.appendChild(
                    document.createTextNode(text.slice(lastIndex, match.index))
                );
            }

            // 渲染公式
            const formula = match[1].trim();
            try {
                const mathEl = renderMath(formula, false);
                mathEl.classList.add("tolerant-math-inline");
                fragment.appendChild(mathEl);
                didReplace = true;
            } catch {
                // 渲染失败保留原始文本
                fragment.appendChild(document.createTextNode(match[0]));
            }

            lastIndex = match.index + match[0].length;
        }

        // 剩余文本
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
