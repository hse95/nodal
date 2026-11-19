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

export function compileExpr(src: string): CompiledExpr {
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
