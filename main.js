var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => TolerantMathPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var TOLERANT_MATH_REGEX = /(?<!\$)\$[ \t]+([^\$\n]+?)[ \t]+\$(?!\$)/g;
var TolerantMathWidget = class extends import_view.WidgetType {
  constructor(formula) {
    super();
    this.formula = formula;
  }
  eq(other) {
    return other.formula === this.formula;
  }
  toDOM() {
    const span = createEl("span", { cls: "tolerant-math-widget" });
    try {
      const mathEl = (0, import_obsidian.renderMath)(this.formula, false);
      span.appendChild(mathEl);
    } catch (e) {
      span.textContent = `$ ${this.formula} $`;
    }
    return span;
  }
  ignoreEvent() {
    return false;
  }
};
function buildDecorations(view) {
  const builder = new import_state.RangeSetBuilder();
  const cursors = view.state.selection.ranges;
  let needsFinish = false;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    TOLERANT_MATH_REGEX.lastIndex = 0;
    let match;
    while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const formula = match[1].trim();
      const cursorInside = cursors.some(
        (r) => r.from <= matchTo && r.to >= matchFrom
      );
      if (cursorInside)
        continue;
      builder.add(
        matchFrom,
        matchTo,
        import_view.Decoration.replace({ widget: new TolerantMathWidget(formula) })
      );
      needsFinish = true;
    }
  }
  const decorations = builder.finish();
  if (needsFinish)
    (0, import_obsidian.finishRenderMath)();
  return decorations;
}
var tolerantMathViewPlugin = import_view.ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (instance) => instance.decorations }
);
var TolerantMathPlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerEditorExtension(tolerantMathViewPlugin);
    this.registerMarkdownPostProcessor((element) => {
      this.processElement(element);
    });
  }
  processElement(element) {
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node2) => {
          var _a;
          const parent = node2.parentElement;
          if (!parent)
            return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === "CODE" || tag === "PRE" || tag === "MATH" || tag === "SCRIPT") {
            return NodeFilter.FILTER_REJECT;
          }
          if (parent.classList.contains("math") || parent.classList.contains("math-inline") || parent.classList.contains("math-block")) {
            return NodeFilter.FILTER_REJECT;
          }
          if (!((_a = node2.textContent) == null ? void 0 : _a.includes("$"))) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    const nodesToProcess = [];
    let node;
    while ((node = walker.nextNode()) !== null) {
      nodesToProcess.push(node);
    }
    let didRender = false;
    for (const textNode of nodesToProcess) {
      if (this.replaceTextNodeWithMath(textNode)) {
        didRender = true;
      }
    }
    if (didRender)
      (0, import_obsidian.finishRenderMath)();
  }
  // 返回 true 表示有公式被替换
  replaceTextNodeWithMath(textNode) {
    var _a;
    const text = (_a = textNode.textContent) != null ? _a : "";
    TOLERANT_MATH_REGEX.lastIndex = 0;
    if (!TOLERANT_MATH_REGEX.test(text))
      return false;
    TOLERANT_MATH_REGEX.lastIndex = 0;
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match;
    let didReplace = false;
    while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.appendChild(
          document.createTextNode(text.slice(lastIndex, match.index))
        );
      }
      const formula = match[1].trim();
      try {
        const mathEl = (0, import_obsidian.renderMath)(formula, false);
        mathEl.classList.add("tolerant-math-inline");
        fragment.appendChild(mathEl);
        didReplace = true;
      } catch (e) {
        fragment.appendChild(document.createTextNode(match[0]));
      }
      lastIndex = match.index + match[0].length;
    }
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
};
