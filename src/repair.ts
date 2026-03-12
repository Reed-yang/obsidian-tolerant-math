/**
 * LaTeX formula repair engine.
 * Attempts to fix common OCR-introduced errors before rendering.
 * Never modifies source files — operates on in-memory strings only.
 */

export interface RepairResult {
    repaired: string;
    description: string;
    applied: string[];
}

// ── R1: Text command word splitting ──────────────────────────────────────────

const TEXT_CMD_RE =
    /\\(text|mathrm|operatorname|textbf|textit|mathit|mathbf|mathcal)\s*\{([^}]*)\}/g;
const SINGLE_LETTER_SPACE_RE = /^(?:[a-zA-Z] )+[a-zA-Z]$/;

function fixTextCommandSplitting(latex: string): [string, string[]] {
    const applied: string[] = [];
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

// ── R4: Abbreviation spacing ────────────────────────────────────────────────

const ABBREV_RE = /([a-zA-Z]) \. /g;

function fixAbbreviationSpacing(latex: string): [string, string[]] {
    const applied: string[] = [];
    TEXT_CMD_RE.lastIndex = 0;
    const fixed = latex.replace(TEXT_CMD_RE, (match, cmd, content) => {
        // Use non-global test to avoid lastIndex state leaking
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

// ── P1: Brace balance (stack-based, extended R3) ────────────────────────────

function fixBraceBalance(latex: string): [string, string[]] {
    const applied: string[] = [];
    // Stack-based approach: walk left-to-right, track matched braces
    const chars = [...latex];
    const stack: number[] = []; // indices of unmatched '{'
    const unmatchedCloses: number[] = []; // indices of unmatched '}'

    for (let i = 0; i < chars.length; i++) {
        if (chars[i] === "{") {
            stack.push(i);
        } else if (chars[i] === "}") {
            if (stack.length > 0) {
                stack.pop(); // matched
            } else {
                unmatchedCloses.push(i); // extra '}'
            }
        }
    }

    if (stack.length === 0 && unmatchedCloses.length === 0) {
        return [latex, applied];
    }

    // Remove unmatched '}' (from right to left to preserve indices)
    let fixed = latex;
    const toRemove = [...unmatchedCloses].reverse();
    for (const idx of toRemove) {
        fixed = fixed.slice(0, idx) + fixed.slice(idx + 1);
    }
    if (unmatchedCloses.length > 0) {
        applied.push(`P1: removed ${unmatchedCloses.length} unmatched '}'`);
    }

    // Append missing '}' for unmatched '{'
    if (stack.length > 0) {
        fixed += "}".repeat(stack.length);
        applied.push(`P1: appended ${stack.length} missing '}'`);
    }

    return [fixed, applied];
}

// ── P2: \left / \right pairing ──────────────────────────────────────────────

const LEFT_RE = /\\left[^a-zA-Z]/g;
const RIGHT_RE = /\\right[^a-zA-Z]/g;

function fixLeftRightPairing(latex: string): [string, string[]] {
    const applied: string[] = [];
    LEFT_RE.lastIndex = 0;
    RIGHT_RE.lastIndex = 0;

    const lefts = (latex.match(LEFT_RE) || []).length;
    const rights = (latex.match(RIGHT_RE) || []).length;
    const diff = lefts - rights;

    if (diff === 0) return [latex, applied];
    if (Math.abs(diff) > 3) return [latex, applied]; // too broken

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

// ── P3: Unclosed environment repair ─────────────────────────────────────────

const SUPPORTED_ENVS = [
    "array", "matrix", "pmatrix", "bmatrix", "cases",
    "aligned", "gathered", "split",
];

function fixUnclosedEnvironments(latex: string): [string, string[]] {
    const applied: string[] = [];
    const unclosed: string[] = [];

    for (const env of SUPPORTED_ENVS) {
        const beginRe = new RegExp(`\\\\begin\\{${env}\\}`, "g");
        const endRe = new RegExp(`\\\\end\\{${env}\\}`, "g");
        const begins = (latex.match(beginRe) || []).length;
        const ends = (latex.match(endRe) || []).length;
        for (let i = 0; i < begins - ends; i++) {
            unclosed.push(env);
        }
    }

    if (unclosed.length === 0 || unclosed.length > 2) return [latex, applied];

    let fixed = latex;
    for (const env of unclosed) {
        fixed += `\\end{${env}}`;
        applied.push(`P3: appended missing '\\end{${env}}'`);
    }
    return [fixed, applied];
}

// ── P4: Command name fuzzy repair ───────────────────────────────────────────

const KNOWN_COMMANDS = [
    // Basic math operators
    "frac", "dfrac", "tfrac", "cfrac", "sqrt", "sum", "prod", "int", "iint",
    "iiint", "oint", "lim", "limsup", "liminf", "log", "ln", "exp",
    // Trigonometric
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh",
    // Greek letters (lowercase)
    "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta",
    "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi",
    "pi", "varpi", "rho", "varrho", "sigma", "varsigma", "tau", "upsilon",
    "phi", "varphi", "chi", "psi", "omega",
    // Greek letters (uppercase)
    "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon",
    "Phi", "Psi", "Omega",
    // Font commands
    "mathbb", "mathcal", "mathfrak", "mathit", "mathbf", "mathrm", "mathsf",
    "mathtt", "boldsymbol", "bm",
    // Accents
    "hat", "bar", "tilde", "vec", "dot", "ddot", "widehat", "widetilde",
    "overrightarrow", "overleftarrow",
    // Text commands
    "text", "textbf", "textit", "textrm", "textsf", "texttt", "operatorname",
    // Delimiters
    "left", "right", "big", "Big", "bigg", "Bigg", "bigl", "bigr",
    "Bigl", "Bigr", "biggl", "biggr", "Biggl", "Biggr",
    // Environments
    "begin", "end",
    // Calculus and analysis
    "partial", "nabla", "infty", "forall", "exists", "nexists",
    // Relations
    "leq", "geq", "neq", "approx", "equiv", "sim", "propto", "cong",
    "simeq", "asymp", "doteq", "triangleq",
    "le", "ge", "ne", "ll", "gg", "prec", "succ", "preceq", "succeq",
    "subset", "supset", "subseteq", "supseteq", "in", "notin", "ni",
    // Arrows
    "to", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow",
    "Leftarrow", "Leftrightarrow", "mapsto", "hookrightarrow",
    "uparrow", "downarrow", "Uparrow", "Downarrow",
    // Binary operators
    "cdot", "cdots", "ldots", "vdots", "ddots", "times", "div", "pm", "mp",
    "cap", "cup", "wedge", "vee", "oplus", "otimes", "circ", "bullet",
    // Spacing
    "quad", "qquad", "hspace", "vspace", "kern", "mkern",
    // Over/under
    "underbrace", "overbrace", "overline", "underline", "overset", "underset",
    "stackrel",
    // Combinatorics
    "binom", "tbinom", "dbinom", "choose",
    // Miscellaneous
    "not", "neg", "lnot", "ell", "hbar", "Re", "Im",
    "prime", "backslash", "setminus", "emptyset", "varnothing",
    "angle", "measuredangle", "triangle", "square",
    "star", "ast", "dagger", "ddagger",
    // Matrix/array
    "hline", "hdashline", "multicolumn",
    // Color and boxing
    "color", "textcolor", "colorbox", "fcolorbox", "boxed",
    // Phantoms and struts
    "phantom", "vphantom", "hphantom", "smash", "strut",
    // Limits and sums
    "min", "max", "sup", "inf", "det", "dim", "ker", "gcd", "lcm",
    "arg", "deg", "hom", "Pr",
];

function levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
            );
        }
    }
    return dp[m][n];
}

const UNKNOWN_CMD_RE = /\\([a-zA-Z]{2,})/g;
const KNOWN_SET = new Set(KNOWN_COMMANDS);

function fixCommandNames(latex: string): [string, string[]] {
    const applied: string[] = [];
    UNKNOWN_CMD_RE.lastIndex = 0;

    const fixed = latex.replace(UNKNOWN_CMD_RE, (match, name) => {
        if (KNOWN_SET.has(name)) return match; // already known

        let bestMatch = "";
        let bestDist = 3; // threshold
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

// ── Orchestrator ────────────────────────────────────────────────────────────

type RuleFn = (latex: string) => [string, string[]];

const REPAIR_RULES: RuleFn[] = [
    fixAbbreviationSpacing,   // R4
    fixTextCommandSplitting,  // R1
    fixBraceBalance,          // P1 (extended R3)
    fixLeftRightPairing,      // P2
    fixUnclosedEnvironments,  // P3
    fixCommandNames,          // P4
];

export function tryRepairFormula(latex: string): RepairResult | null {
    let current = latex;
    const allApplied: string[] = [];

    for (const rule of REPAIR_RULES) {
        const [fixed, applied] = rule(current);
        if (applied.length > 0) {
            current = fixed;
            allApplied.push(...applied);
        }
    }

    if (allApplied.length === 0) return null;

    return {
        repaired: current,
        description: allApplied.join("; "),
        applied: allApplied,
    };
}
