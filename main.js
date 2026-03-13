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

// src/repair.ts
var TEXT_CMD_RE = /\\(text|mathrm|operatorname|textbf|textit|mathit|mathbf|mathcal)\s*\{([^}]*)\}/g;
var SINGLE_LETTER_SPACE_RE = /^(?:[a-zA-Z] )+[a-zA-Z]$/;
function fixTextCommandSplitting(latex) {
  const applied = [];
  TEXT_CMD_RE.lastIndex = 0;
  const fixed = latex.replace(TEXT_CMD_RE, (match, cmd, content) => {
    const stripped = content.trim();
    if (SINGLE_LETTER_SPACE_RE.test(stripped)) {
      const merged = stripped.replace(/ /g, "");
      applied.push(`R1: \\${cmd}{${stripped}} -> \\${cmd}{${merged}}`);
      return `\\${cmd}{${merged}}`;
    }
    return match;
  });
  return [fixed, applied];
}
var ABBREV_RE = /([a-zA-Z]) \. /g;
function fixAbbreviationSpacing(latex) {
  const applied = [];
  TEXT_CMD_RE.lastIndex = 0;
  const fixed = latex.replace(TEXT_CMD_RE, (match, cmd, content) => {
    if (/([a-zA-Z]) \. /.test(content)) {
      ABBREV_RE.lastIndex = 0;
      const fixedContent = content.replace(ABBREV_RE, "$1.");
      ABBREV_RE.lastIndex = 0;
      applied.push("R4: fixed abbreviation spacing");
      return `\\${cmd}{${fixedContent}}`;
    }
    return match;
  });
  return [fixed, applied];
}
var DELIMITER_CMD_BRACE_RE = /\\(left|right|bigl|bigr|Bigl|Bigr|biggl|biggr|Biggl|Biggr|big|Big|bigg|Bigg)([{}])/g;
function fixEscapedBraceDelimiters(latex) {
  const applied = [];
  DELIMITER_CMD_BRACE_RE.lastIndex = 0;
  const fixed = latex.replace(DELIMITER_CMD_BRACE_RE, (_match, cmd, brace) => {
    applied.push(`P5: \\${cmd}${brace} -> \\${cmd}\\${brace}`);
    return `\\${cmd}\\${brace}`;
  });
  return [fixed, applied];
}
function fixBraceBalance(latex) {
  const applied = [];
  const chars = [...latex];
  const stack = [];
  const unmatchedCloses = [];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\\" && i + 1 < chars.length && (chars[i + 1] === "{" || chars[i + 1] === "}")) {
      i++;
      continue;
    }
    if (chars[i] === "{") {
      stack.push(i);
    } else if (chars[i] === "}") {
      if (stack.length > 0) {
        stack.pop();
      } else {
        unmatchedCloses.push(i);
      }
    }
  }
  if (stack.length === 0 && unmatchedCloses.length === 0) {
    return [latex, applied];
  }
  let fixed = latex;
  const toRemove = [...unmatchedCloses].reverse();
  for (const idx of toRemove) {
    fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
  }
  if (unmatchedCloses.length > 0) {
    applied.push(`P1: removed ${unmatchedCloses.length} unmatched '}'`);
  }
  if (stack.length > 0) {
    fixed += "}".repeat(stack.length);
    applied.push(`P1: appended ${stack.length} missing '}'`);
  }
  return [fixed, applied];
}
var LEFT_RE = /\\left[^a-zA-Z]/g;
var RIGHT_RE = /\\right[^a-zA-Z]/g;
function fixLeftRightPairing(latex) {
  const applied = [];
  LEFT_RE.lastIndex = 0;
  RIGHT_RE.lastIndex = 0;
  const lefts = (latex.match(LEFT_RE) || []).length;
  const rights = (latex.match(RIGHT_RE) || []).length;
  const diff = lefts - rights;
  if (diff === 0)
    return [latex, applied];
  if (Math.abs(diff) > 3)
    return [latex, applied];
  let fixed = latex;
  if (diff > 0) {
    fixed += "\\right.".repeat(diff);
    applied.push(`P2: appended ${diff} missing '\\right.'`);
  } else {
    fixed = "\\left.".repeat(-diff) + fixed;
    applied.push(`P2: prepended ${-diff} missing '\\left.'`);
  }
  return [fixed, applied];
}
var SUPPORTED_ENVS = [
  "array",
  "matrix",
  "pmatrix",
  "bmatrix",
  "cases",
  "aligned",
  "gathered",
  "split"
];
function fixUnclosedEnvironments(latex) {
  const applied = [];
  const unclosed = [];
  for (const env of SUPPORTED_ENVS) {
    const beginRe = new RegExp(`\\\\begin\\{${env}\\}`, "g");
    const endRe = new RegExp(`\\\\end\\{${env}\\}`, "g");
    const begins = (latex.match(beginRe) || []).length;
    const ends = (latex.match(endRe) || []).length;
    for (let i = 0; i < begins - ends; i++) {
      unclosed.push(env);
    }
  }
  if (unclosed.length === 0 || unclosed.length > 2)
    return [latex, applied];
  let fixed = latex;
  for (const env of unclosed) {
    fixed += `\\end{${env}}`;
    applied.push(`P3: appended missing '\\end{${env}}'`);
  }
  return [fixed, applied];
}
var KNOWN_COMMANDS = [
  // Basic math operators
  "frac",
  "dfrac",
  "tfrac",
  "cfrac",
  "sqrt",
  "sum",
  "prod",
  "int",
  "iint",
  "iiint",
  "oint",
  "lim",
  "limsup",
  "liminf",
  "log",
  "ln",
  "exp",
  // Trigonometric
  "sin",
  "cos",
  "tan",
  "cot",
  "sec",
  "csc",
  "arcsin",
  "arccos",
  "arctan",
  "sinh",
  "cosh",
  "tanh",
  // Greek letters (lowercase)
  "alpha",
  "beta",
  "gamma",
  "delta",
  "epsilon",
  "varepsilon",
  "zeta",
  "eta",
  "theta",
  "vartheta",
  "iota",
  "kappa",
  "lambda",
  "mu",
  "nu",
  "xi",
  "pi",
  "varpi",
  "rho",
  "varrho",
  "sigma",
  "varsigma",
  "tau",
  "upsilon",
  "phi",
  "varphi",
  "chi",
  "psi",
  "omega",
  // Greek letters (uppercase)
  "Gamma",
  "Delta",
  "Theta",
  "Lambda",
  "Xi",
  "Pi",
  "Sigma",
  "Upsilon",
  "Phi",
  "Psi",
  "Omega",
  // Font commands
  "mathbb",
  "mathcal",
  "mathfrak",
  "mathit",
  "mathbf",
  "mathrm",
  "mathsf",
  "mathtt",
  "boldsymbol",
  "bm",
  // Accents
  "hat",
  "bar",
  "tilde",
  "vec",
  "dot",
  "ddot",
  "widehat",
  "widetilde",
  "overrightarrow",
  "overleftarrow",
  // Text commands
  "text",
  "textbf",
  "textit",
  "textrm",
  "textsf",
  "texttt",
  "operatorname",
  // Delimiters
  "left",
  "right",
  "big",
  "Big",
  "bigg",
  "Bigg",
  "bigl",
  "bigr",
  "Bigl",
  "Bigr",
  "biggl",
  "biggr",
  "Biggl",
  "Biggr",
  // Environments
  "begin",
  "end",
  // Calculus and analysis
  "partial",
  "nabla",
  "infty",
  "forall",
  "exists",
  "nexists",
  // Relations
  "leq",
  "geq",
  "neq",
  "approx",
  "equiv",
  "sim",
  "propto",
  "cong",
  "simeq",
  "asymp",
  "doteq",
  "triangleq",
  "le",
  "ge",
  "ne",
  "ll",
  "gg",
  "prec",
  "succ",
  "preceq",
  "succeq",
  "subset",
  "supset",
  "subseteq",
  "supseteq",
  "in",
  "notin",
  "ni",
  // Arrows
  "to",
  "rightarrow",
  "leftarrow",
  "leftrightarrow",
  "Rightarrow",
  "Leftarrow",
  "Leftrightarrow",
  "mapsto",
  "hookrightarrow",
  "uparrow",
  "downarrow",
  "Uparrow",
  "Downarrow",
  // Binary operators
  "cdot",
  "cdots",
  "ldots",
  "vdots",
  "ddots",
  "times",
  "div",
  "pm",
  "mp",
  "cap",
  "cup",
  "wedge",
  "vee",
  "oplus",
  "otimes",
  "circ",
  "bullet",
  // Spacing
  "quad",
  "qquad",
  "hspace",
  "vspace",
  "kern",
  "mkern",
  // Over/under
  "underbrace",
  "overbrace",
  "overline",
  "underline",
  "overset",
  "underset",
  "stackrel",
  // Combinatorics
  "binom",
  "tbinom",
  "dbinom",
  "choose",
  // Miscellaneous
  "not",
  "neg",
  "lnot",
  "ell",
  "hbar",
  "Re",
  "Im",
  "prime",
  "backslash",
  "setminus",
  "emptyset",
  "varnothing",
  "angle",
  "measuredangle",
  "triangle",
  "square",
  "star",
  "ast",
  "dagger",
  "ddagger",
  // Matrix/array
  "hline",
  "hdashline",
  "multicolumn",
  // Color and boxing
  "color",
  "textcolor",
  "colorbox",
  "fcolorbox",
  "boxed",
  // Phantoms and struts
  "phantom",
  "vphantom",
  "hphantom",
  "smash",
  "strut",
  // Limits and sums
  "min",
  "max",
  "sup",
  "inf",
  "det",
  "dim",
  "ker",
  "gcd",
  "lcm",
  "arg",
  "deg",
  "hom",
  "Pr"
];
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++)
    dp[i][0] = i;
  for (let j = 0; j <= n; j++)
    dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}
var UNKNOWN_CMD_RE = /\\([a-zA-Z]{2,})/g;
var KNOWN_SET = new Set(KNOWN_COMMANDS);
function fixCommandNames(latex) {
  const applied = [];
  UNKNOWN_CMD_RE.lastIndex = 0;
  const fixed = latex.replace(UNKNOWN_CMD_RE, (match, name) => {
    if (KNOWN_SET.has(name))
      return match;
    let bestMatch = "";
    let bestDist = 3;
    let ambiguous = false;
    for (const known of KNOWN_COMMANDS) {
      const dist = levenshtein(name, known);
      if (dist < bestDist) {
        bestDist = dist;
        bestMatch = known;
        ambiguous = false;
      } else if (dist === bestDist && known !== bestMatch) {
        ambiguous = true;
      }
    }
    if (bestMatch && !ambiguous && bestDist <= 2) {
      applied.push(`P4: \\${name} -> \\${bestMatch}`);
      return `\\${bestMatch}`;
    }
    return match;
  });
  return [fixed, applied];
}
var REPAIR_RULES = [
  fixAbbreviationSpacing,
  // R4
  fixTextCommandSplitting,
  // R1
  fixEscapedBraceDelimiters,
  // P5 (before P1 — restores \{ \} so brace count stays correct)
  fixBraceBalance,
  // P1 (extended R3)
  fixLeftRightPairing,
  // P2
  fixUnclosedEnvironments,
  // P3
  fixCommandNames
  // P4
];
function tryRepairFormula(latex) {
  let current = latex;
  const allApplied = [];
  for (const rule of REPAIR_RULES) {
    const [fixed, applied] = rule(current);
    if (applied.length > 0) {
      current = fixed;
      allApplied.push(...applied);
    }
  }
  if (allApplied.length === 0)
    return null;
  return {
    repaired: current,
    description: allApplied.join("; "),
    applied: allApplied
  };
}

// src/main.ts
var import_view = require("@codemirror/view");
var import_state = require("@codemirror/state");
var import_language = require("@codemirror/language");
var DEFAULT_SETTINGS = {
  enableRepair: true,
  showRepairIndicators: true
};
var pluginSettings = DEFAULT_SETTINGS;
var TOLERANT_MATH_REGEX = /(?<!\$)\$[ \t]+([^\$\n]+?)[ \t]+\$(?!\$)/g;
function applyRepairIndicator(el, repair) {
  el.classList.add("tolerant-math-repaired");
  el.style.borderBottom = "1px dashed rgba(255, 165, 0, 0.4)";
  el.title = `Auto-repaired: ${repair.description}`;
}
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
    let formulaToRender = this.formula;
    let repairResult = null;
    if (pluginSettings.enableRepair) {
      repairResult = tryRepairFormula(this.formula);
      if (repairResult) {
        formulaToRender = repairResult.repaired;
      }
    }
    try {
      const mathEl = (0, import_obsidian.renderMath)(formulaToRender, false);
      if (repairResult && pluginSettings.showRepairIndicators) {
        applyRepairIndicator(mathEl, repairResult);
      }
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
  const tree = (0, import_language.syntaxTree)(view.state);
  const nativeMathRanges = [];
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        if (node.name.toLowerCase().includes("math")) {
          nativeMathRanges.push({ from: node.from, to: node.to });
        }
      }
    });
  }
  let needsFinish = false;
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to);
    TOLERANT_MATH_REGEX.lastIndex = 0;
    let match;
    while ((match = TOLERANT_MATH_REGEX.exec(text)) !== null) {
      const matchFrom = from + match.index;
      const matchTo = matchFrom + match[0].length;
      const formula = match[1].trim();
      const overlapsNative = nativeMathRanges.some(
        (r) => r.from < matchTo && r.to > matchFrom
      );
      if (overlapsNative)
        continue;
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
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    pluginSettings = this.settings;
    this.addSettingTab(new TolerantMathSettingTab(this.app, this));
    this.registerEditorExtension(tolerantMathViewPlugin);
    this.registerMarkdownPostProcessor((element) => {
      this.processElement(element);
    });
    this.addCommand({
      id: "show-repair-report",
      name: "Show Repair Report",
      callback: () => this.showRepairReport()
    });
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
    pluginSettings = this.settings;
  }
  showRepairReport() {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      console.log("[tolerant-math] No active file");
      return;
    }
    this.app.vault.cachedRead(file).then((content) => {
      var _a;
      const formulaRe = /\$\$(.*?)\$\$|\$(?!\$)(.*?)\$(?!\$)/gs;
      let total = 0, noRepairNeeded = 0, repaired = 0;
      const ruleCount = {};
      let m;
      while ((m = formulaRe.exec(content)) !== null) {
        const formula = ((_a = m[1]) != null ? _a : m[2]).trim();
        total++;
        const repair = tryRepairFormula(formula);
        if (repair) {
          repaired++;
          for (const r of repair.applied) {
            const key = r.split(":")[0];
            ruleCount[key] = (ruleCount[key] || 0) + 1;
          }
        } else {
          noRepairNeeded++;
        }
      }
      const rules = Object.entries(ruleCount).map(([k, v]) => `${k}\xD7${v}`).join(", ");
      console.log(
        `[tolerant-math] Repair report for ${file.name}:
  Total formulas scanned: ${total}
  No repair needed: ${noRepairNeeded}
  Repaired: ${repaired}
  Rules applied: ${rules || "(none)"}`
      );
    });
  }
  // Unwrap inline formatting elements (em, strong, span, etc.) that interfere
  // with $ ... $ pattern matching. Obsidian's markdown parser consumes * and _
  // as emphasis and \ before ASCII punctuation as escapes, creating elements
  // that split text nodes across boundaries and preventing regex matching.
  // Runs multiple passes: each pass unwraps elements adjacent to $, then
  // normalize() merges text nodes, propagating $ closer to remaining elements.
  unwrapInlineFormattingNearDollars(element) {
    var _a, _b, _c, _d, _e, _f;
    TOLERANT_MATH_REGEX.lastIndex = 0;
    if (!TOLERANT_MATH_REGEX.test((_a = element.textContent) != null ? _a : ""))
      return;
    TOLERANT_MATH_REGEX.lastIndex = 0;
    const SKIP_CLASSES = ["math", "math-inline", "math-block"];
    const SELECTOR = "em, strong, span, del, s";
    const MAX_PASSES = 10;
    let changed;
    let pass = 0;
    do {
      if (++pass > MAX_PASSES)
        break;
      changed = false;
      const inlineEls = Array.from(element.querySelectorAll(SELECTOR));
      for (const el of inlineEls) {
        const parent = el.parentNode;
        if (!parent)
          continue;
        if (el instanceof HTMLElement) {
          if (SKIP_CLASSES.some((c) => el.classList.contains(c)))
            continue;
          if (el.tagName === "SPAN" && el.classList.length > 0)
            continue;
        }
        const prev = (_c = (_b = el.previousSibling) == null ? void 0 : _b.textContent) != null ? _c : "";
        const next = (_e = (_d = el.nextSibling) == null ? void 0 : _d.textContent) != null ? _e : "";
        const self = (_f = el.textContent) != null ? _f : "";
        if (!prev.includes("$") && !next.includes("$") && !self.includes("$"))
          continue;
        if (!/[\\{}^]/.test(self) && !self.includes("$")) {
          if (!prev.includes("$") || !next.includes("$"))
            continue;
        }
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el);
        }
        parent.removeChild(el);
        changed = true;
      }
      if (changed)
        element.normalize();
    } while (changed);
  }
  processElement(element) {
    var _a;
    if (!((_a = element.textContent) == null ? void 0 : _a.includes("$")))
      return;
    this.unwrapInlineFormattingNearDollars(element);
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node2) => {
          var _a2;
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
          if (!((_a2 = node2.textContent) == null ? void 0 : _a2.includes("$"))) {
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
  // Returns true if at least one formula was replaced
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
      let formulaToRender = formula;
      let repairResult = null;
      if (pluginSettings.enableRepair) {
        repairResult = tryRepairFormula(formula);
        if (repairResult) {
          formulaToRender = repairResult.repaired;
        }
      }
      try {
        const mathEl = (0, import_obsidian.renderMath)(formulaToRender, false);
        mathEl.classList.add("tolerant-math-inline");
        if (repairResult && pluginSettings.showRepairIndicators) {
          applyRepairIndicator(mathEl, repairResult);
        }
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
var TolerantMathSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Enable auto-repair").setDesc("Try to fix broken formulas before rendering").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.enableRepair).onChange(async (value) => {
        this.plugin.settings.enableRepair = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show repair indicators").setDesc("Show dashed underline on auto-repaired formulas").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showRepairIndicators).onChange(async (value) => {
        this.plugin.settings.showRepairIndicators = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
