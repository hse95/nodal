/**
 * Safe arithmetic expression parser and evaluator.
 *
 * User expressions are never passed to eval/Function. They are tokenised,
 * parsed by precedence climbing into a small AST, and evaluated against a
 * whitelist of functions and constants. Used by the Expression component,
 * path-mapping masks, and closed-form reference values in benchmark files.
 *
 * Grammar (lowest to highest precedence):
 *   ternary  c ? a : b
 *   ||  &&  comparisons (== != < <= > >=)  + -  * / %  unary - !  ^ (right assoc)
 *   calls f(a, b), parentheses, numbers, identifiers
 */

type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; n: string }
  | { t: 'un'; op: string; a: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'tern'; c: Node; a: Node; b: Node }
  | { t: 'call'; n: string; args: Node[] };

// Null-prototype maps: names such as "constructor" must not resolve through Object.prototype.
const FUNCS: Record<string, (...a: number[]) => number> = Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, asinh: Math.asinh, acosh: Math.acosh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign, min: Math.min, max: Math.max,
  pow: Math.pow, hypot: Math.hypot,
  deg: (r: number) => r * 180 / Math.PI, rad: (d: number) => d * Math.PI / 180,
  clamp: (x: number, a: number, b: number) => Math.min(Math.max(x, a), b),
  if: (c: number, a: number, b: number) => (c ? a : b),
});
const CONSTS: Record<string, number> = Object.assign(Object.create(null), { pi: Math.PI, PI: Math.PI, e: Math.E, tau: 2 * Math.PI });

interface Tok { k: 'num' | 'id' | 'op'; v: string }

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%^()<>!?:,]))/y;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    re.lastIndex = pos;
    const m = re.exec(src);
    if (!m) throw new Error(`Unexpected character "${src.slice(pos).trim()[0]}" in expression`);
    if (m[1] !== undefined) toks.push({ k: 'num', v: m[1] });
    else if (m[2] !== undefined) toks.push({ k: 'id', v: m[2] });
    else toks.push({ k: 'op', v: m[3] });
    pos = re.lastIndex;
  }
  return toks;
}

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4,
  '+': 5, '-': 5, '*': 6, '/': 6, '%': 6,
};

export interface CompiledExpr { vars: string[]; eval(vars?: Record<string, number>): number }

function parseExpr(src: string): Node {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => toks[i]?.k === 'op' && toks[i].v === v;
  const expect = (v: string) => { if (!isOp(v)) throw new Error(`Expected "${v}" in expression`); i++; };

  function primary(): Node {
    const t = peek();
    if (!t) throw new Error('Expression ended unexpectedly');
    i++;
    if (t.k === 'num') return { t: 'num', v: parseFloat(t.v) };
    if (t.k === 'id') {
      if (isOp('(')) {
        i++;
        const args: Node[] = [];
        if (!isOp(')')) { do { args.push(ternary()); } while (isOp(',') && ++i); }
        expect(')');
        return { t: 'call', n: t.v, args };
      }
      return { t: 'var', n: t.v };
    }
    if (t.v === '(') { const n = ternary(); expect(')'); return n; }
    throw new Error(`Unexpected "${t.v}" in expression`);
  }
  // '^' binds tighter than unary minus on its left (-2^2 = -4) and is right associative.
  function power(): Node {
    const base = primary();
    if (isOp('^')) { i++; return { t: 'bin', op: '^', a: base, b: unary() }; }
    return base;
  }
  function unary(): Node {
    if (isOp('-')) { i++; return { t: 'un', op: '-', a: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    if (isOp('!')) { i++; return { t: 'un', op: '!', a: unary() }; }
    return power();
  }
  function binary(minPrec: number): Node {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec === undefined || prec < minPrec) break;
      i++;
      left = { t: 'bin', op: t.v, a: left, b: binary(prec + 1) };
    }
    return left;
  }
  function ternary(): Node {
    const c = binary(1);
    if (isOp('?')) { i++; const a = ternary(); expect(':'); const b = ternary(); return { t: 'tern', c, a, b }; }
    return c;
  }

  const ast = ternary();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}" in expression`);
  return ast;
}

export function compileExpr(src: string): CompiledExpr {
  const ast = parseExpr(src);

  const names = new Set<string>();
  (function collect(n: Node): void {
    switch (n.t) {
      case 'var': if (!(n.n in CONSTS)) names.add(n.n); break;
      case 'un': collect(n.a); break;
      case 'bin': collect(n.a); collect(n.b); break;
      case 'tern': collect(n.c); collect(n.a); collect(n.b); break;
      case 'call':
        if (!(n.n in FUNCS)) throw new Error(`Unknown function "${n.n}"`);
        n.args.forEach(collect); break;
    }
  })(ast);

  function ev(n: Node, vars: Record<string, number>): number {
    switch (n.t) {
      case 'num': return n.v;
      case 'var': {
        if (Object.prototype.hasOwnProperty.call(vars, n.n)) return vars[n.n];
        if (n.n in CONSTS) return CONSTS[n.n];
        throw new Error(`Unknown variable "${n.n}"`);
      }
      case 'un': { const a = ev(n.a, vars); return n.op === '-' ? -a : (a ? 0 : 1); }
      case 'tern': return ev(n.c, vars) ? ev(n.a, vars) : ev(n.b, vars);
      case 'call': return FUNCS[n.n](...n.args.map(a => ev(a, vars)));
      case 'bin': {
        const a = ev(n.a, vars);
        if (n.op === '&&') return a && ev(n.b, vars) ? 1 : 0;
        if (n.op === '||') return a || ev(n.b, vars) ? 1 : 0;
        const b = ev(n.b, vars);
        switch (n.op) {
          case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return a / b;
          case '%': return a % b; case '^': return Math.pow(a, b);
          case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
          case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
          case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
        }
      }
    }
    throw new Error('Invalid expression');
  }
  return { vars: [...names], eval: (vars = {}) => ev(ast, vars) };
}

export function evalExpr(src: string, vars: Record<string, number> = {}): number {
  return compileExpr(src).eval(vars);
}

// ---- typeset form ------------------------------------------------------------------------

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'rho', 'sigma', 'tau', 'phi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Sigma', 'Phi', 'Psi', 'Omega']);
/** A variable name as TeX: Greek names become symbols and trailing digits or letters become subscripts (I_y, x_1, sigma_max). */
export function nameToTex(name: string): string {
  if (name === 'pi' || name === 'PI') return '\\pi';
  if (GREEK.has(name)) return '\\' + name;
  const us = name.indexOf('_');
  if (us > 0) return `${nameToTex(name.slice(0, us))}_{\\mathrm{${name.slice(us + 1).replace(/_/g, '\\,')}}}`;
  for (const g of GREEK) if (name.startsWith(g) && name.length > g.length) return `\\${g}_{\\mathrm{${name.slice(g.length)}}}`;
  const m = /^([A-Za-z])(\d+|[a-z]{1,3}|[A-Z]?[a-z]{0,3})$/.exec(name);
  if (m && m[2]) return `${m[1]}_{${/^\d+$/.test(m[2]) ? m[2] : `\\mathrm{${m[2]}}`}}`;
  return name.length === 1 ? name : `\\mathrm{${name}}`;
}
const texNum = (x: number): string => {
  if (!Number.isFinite(x)) return String(x);
  const t = String(x);
  const e = /^(-?[\d.]+)e([+-]?\d+)$/.exec(t);
  return e ? `${e[1] === '1' ? '' : e[1] + '\\times '}10^{${Number(e[2])}}` : t;
};
const TEX_PREC: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '^': 8 };
const TEX_OP: Record<string, string> = { '||': '\\lor', '&&': '\\land', '==': '=', '!=': '\\ne', '<': '<', '<=': '\\le', '>': '>', '>=': '\\ge', '%': '\\bmod' };

/**
 * The expression written as TeX, for display only: a/b becomes a fraction, a*b a product, sqrt a root.
 * Throws the same errors as compileExpr for text that is not a valid expression.
 */
export function exprToTex(src: string): string {
  const paren = (s: string) => `\\left(${s}\\right)`;
  const prec = (n: Node): number => (n.t === 'bin' ? (n.op === '/' ? 9 : TEX_PREC[n.op]) : n.t === 'un' ? 7 : n.t === 'tern' ? 0 : 9);
  /** Whether a factor begins with a digit, in which case the product needs a visible sign. */
  const startsWithNumber = (n: Node): boolean => n.t === 'num' || (n.t === 'bin' && (n.op === '*' || n.op === '^') && startsWithNumber(n.a));
  const tex = (n: Node): string => {
    switch (n.t) {
      case 'num': return texNum(n.v);
      case 'var': return nameToTex(n.n);
      case 'un': { const a = tex(n.a); return (n.op === '!' ? '\\lnot ' : '-') + (prec(n.a) < 6 ? paren(a) : a); }
      case 'tern': return `\\begin{cases}${tex(n.a)} & \\text{if } ${tex(n.c)}\\\\ ${tex(n.b)} & \\text{otherwise}\\end{cases}`;
      case 'call': {
        const a = n.args.map(tex);
        switch (n.n) {
          case 'sqrt': return `\\sqrt{${a[0]}}`;
          case 'abs': return `\\left|${a[0]}\\right|`;
          case 'exp': return `e^{${a[0]}}`;
          case 'pow': return `${prec(n.args[0]) < 9 ? paren(a[0]) : a[0]}^{${a[1]}}`;
          case 'floor': return `\\left\\lfloor ${a[0]}\\right\\rfloor`;
          case 'ceil': return `\\left\\lceil ${a[0]}\\right\\rceil`;
          case 'log10': return `\\log_{10}${paren(a[0])}`;
          case 'log2': return `\\log_{2}${paren(a[0])}`;
          case 'ln': case 'log': return `\\ln${paren(a[0])}`;
          case 'if': return `\\begin{cases}${a[1]} & \\text{if } ${a[0]}\\\\ ${a[2]} & \\text{otherwise}\\end{cases}`;
          case 'asin': case 'acos': case 'atan': return `\\${n.n.replace('a', 'arc')}${paren(a[0])}`;
          case 'sin': case 'cos': case 'tan': case 'sinh': case 'cosh': case 'tanh': case 'min': case 'max': return `\\${n.n}${paren(a.join(',\\,'))}`;
          default: return `\\operatorname{${n.n}}${paren(a.join(',\\,'))}`;
        }
      }
      case 'bin': {
        const a = tex(n.a), b = tex(n.b), pa = prec(n.a), pb = prec(n.b);
        if (n.op === '/') return n.a.t === 'un' && n.a.op === '-' ? `-\\frac{${tex(n.a.a)}}{${b}}` : `\\frac{${a}}{${b}}`;
        if (n.op === '^') return `${pa < 9 || n.a.t === 'call' || (n.a.t === 'bin' && n.a.op === '/') || (n.a.t === 'num' && n.a.v < 0) ? paren(a) : a}^{${b}}`;
        if (n.op === '*') { const l = pa < 6 ? paren(a) : a, r = pb < 6 ? paren(b) : b; return startsWithNumber(n.b) ? `${l}\\cdot ${r}` : `${l}\\,${r}`; }
        const p = TEX_PREC[n.op], l = pa < p ? paren(a) : a, r = pb < p || (pb === p && (n.op === '-' || n.op === '%')) ? paren(b) : b;
        return `${l} ${TEX_OP[n.op] ?? n.op} ${r}`;
      }
    }
  };
  return tex(parseExpr(src));
}
