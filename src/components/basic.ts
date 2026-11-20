/**
 * Component library, part 1: parameters, maths, lists, data trees, vectors and planes.
 * All names, descriptions and behaviours are Nodal's own.
 */
import { registry, P, formatValue, coerce } from '../core/graph';
import type { ComponentDef, DType, PortSpec } from '../core/types';
import { DataTree, mapPathsByMask, pathText } from '../core/tree';
import { compileExpr, evalExpr } from '../core/expr';
import { V3, v, add, sub, mul, dot, cross, len, unit, dist, angle as vAngle, isV3, Plane, planeFromNormal, planeFrom3Points, planePoint, WORLD_XY, X, Y, Z, O, isPlane, lerp } from '../geom/vec';

type Solve = NonNullable<ComponentDef['solve']>;
/** Compact registration helper. */
export function C(id: string, name: string, nick: string, category: string, desc: string, inputs: PortSpec[], outputs: PortSpec[], solve: Solve | null, extra: Partial<ComponentDef> = {}): void {
  registry.add({ id, name, nick, category, desc, inputs, outputs, ...(solve ? { solve } : {}), ...extra });
}
const num = (n: string, d: string, def?: number, o: any = {}) => P(n, 'number', d, { d: def, ...o });
const int = (n: string, d: string, def?: number, o: any = {}) => P(n, 'integer', d, { d: def, ...o });
const pt = (n: string, d: string, def?: V3 | null, o: any = {}) => P(n, 'point', d, { d: def === null ? undefined : def, ...o });
const vec = (n: string, d: string, def?: V3, o: any = {}) => P(n, 'vector', d, { d: def, ...o });
const pln = (n: string, d: string, o: any = {}) => P(n, 'plane', d, { d: WORLD_XY, ...o });
export { num, int, pt, vec, pln };

// ======================================================================= Params
C('param.slider', 'Number Slider', 'Slider', 'Params', 'A number you can drag. Double-click the name to edit the range in the inspector.', [], [P('Value', 'number', 'The slider value', { nick: 'N' })],
  (_i, ctx) => [ctx.node.state.integer ? Math.round(ctx.node.state.value) : ctx.node.state.value],
  { widget: 'slider', state: { min: 0, max: 10, step: 0.1, value: 5, integer: false }, width: 220, example: 'Slider -> Radius input of Circle', noPreview: true });
C('param.toggle', 'Boolean Toggle', 'Toggle', 'Params', 'A true/false switch.', [], [P('Value', 'boolean', 'True or false', { nick: 'B' })], (_i, ctx) => [!!ctx.node.state.value],
  { widget: 'toggle', state: { value: true }, width: 130, example: 'Toggle -> Closed input of Polyline', noPreview: true });
C('param.valuelist', 'Value List', 'List', 'Params', 'Pick one value from a named list. Edit the entries in the inspector as "Name = value", one per line.', [], [P('Value', 'any', 'The selected value', { nick: 'V' })],
  (_i, ctx) => { const it = (ctx.node.state.items ?? [])[ctx.node.state.index ?? 0]; if (!it) throw new Error('The list is empty'); const n = Number(it.value); return [it.value !== '' && Number.isFinite(n) ? n : it.value]; },
  { widget: 'valuelist', state: { items: [{ name: 'One', value: '1' }, { name: 'Two', value: '2' }, { name: 'Three', value: '3' }], index: 0 }, width: 170, noPreview: true, example: 'Value List -> Type input' });
C('param.panel', 'Panel', 'Panel', 'Params', 'Shows the data arriving at its input as text. With nothing connected it outputs its own text, one item per line (numbers are recognised).',
  [P('Data', 'any', 'Data to display', { tree: true, opt: true, nick: 'D' })], [P('Out', 'any', 'The same data (or the typed text)', { tree: true, nick: 'O' })], null,
  {
    widget: 'panel', state: { text: '' }, width: 220, noPreview: true, example: 'Any output -> Panel to read values',
    solveTrees: ([t], ctx) => {
      if (!t.isEmpty || t.branchCount) return [t];
      const lines = String(ctx.node.state.text ?? '').split('\n').map(s => s.trim()).filter(s => s.length);
      return [DataTree.fromList(lines.map(s => (Number.isFinite(Number(s)) ? Number(s) : s)))];
    },
  });
C('param.graph', 'Graph Mapper', 'Graph', 'Params', 'Remaps a number between 0 and 1 through a curve (linear, power, sine, smooth step, parabola). Choose the curve in the inspector.',
  [num('X', 'Value between 0 and 1')], [num('Y', 'Mapped value')],
  ([x], ctx) => [graphMap(ctx.node.state.kind ?? 'smooth', ctx.node.state.p ?? 2, x)], { widget: 'graph', state: { kind: 'smooth', p: 2 }, width: 150, noPreview: true, example: 'Range 0..1 -> Graph Mapper -> scale factors' });
export function graphMap(kind: string, p: number, x: number): number {
  const t = Math.min(1, Math.max(0, x));
  switch (kind) {
    case 'linear': return t;
    case 'power': return Math.pow(t, p);
    case 'sine': return 0.5 - 0.5 * Math.cos(Math.PI * t * p);
    case 'parabola': return 4 * t * (1 - t);
    case 'bell': return Math.exp(-((t - 0.5) ** 2) * 4 * p * p);
    default: return t * t * (3 - 2 * t);
  }
}
C('param.colour', 'Colour', 'Colour', 'Params', 'A colour swatch.', [], [P('Colour', 'color', 'The colour', { nick: 'C' })], (_i, ctx) => [ctx.node.state.value], { widget: 'colour', state: { value: '#e4572e' }, width: 120, noPreview: true });
C('param.note', 'Note', 'Note', 'Params', 'A text note on the canvas. It has no effect on the model.', [], [], null, { widget: 'note', state: { text: 'Note' }, width: 200, noPreview: true });
C('param.file', 'Geometry From File', 'File', 'Params', 'Holds geometry imported from a file (STL, OBJ, DXF, 3DM, CSV points). Use File > Import, or the Import button in the inspector.', [], [P('Geometry', 'geometry', 'Imported geometry', { list: true, nick: 'G' })],
  (_i, ctx) => { const d = ctx.node.state.data; if (!d || !d.length) throw new Error('No file loaded yet. Select this component and use Import in the inspector.'); return [d]; }, { state: { data: null, name: '' }, width: 150 });
// Typed pass-through parameters: hold a constant (set in the inspector) or relay wired data, converting it to the type.
const RELAYS: [string, string, DType, unknown, string][] = [
  ['number', 'Number', 'number', 0, 'a decimal number'], ['integer', 'Integer', 'integer', 0, 'a whole number'], ['boolean', 'Boolean', 'boolean', false, 'true or false'],
  ['text', 'Text', 'text', '', 'a piece of text'], ['point', 'Point', 'point', undefined, 'a point (type "x, y, z" in the inspector)'], ['vector', 'Vector', 'vector', undefined, 'a vector (type "x, y, z")'],
  ['plane', 'Plane', 'plane', undefined, 'a plane'], ['curve', 'Curve', 'curve', undefined, 'a curve'], ['surface', 'Surface', 'surface', undefined, 'a surface'],
  ['mesh', 'Mesh', 'mesh', undefined, 'a mesh'], ['brep', 'Brep', 'brep', undefined, 'a solid or surface body'], ['geometry', 'Geometry', 'geometry', undefined, 'any geometry'],
];
for (const [id, name, type, d, what] of RELAYS) {
  C(`param.${id}`, name, name.slice(0, 4), 'Params', `Holds ${what}. Wire data in to relay and convert it, or set a value in the inspector.`,
    [P('Value', type, `The ${id} value`, { d, tree: true, opt: d === undefined, nick: 'V' })], [P('Value', type, `The ${id} value`, { tree: true, nick: 'V' })], null,
    { solveTrees: ([t]) => [t], width: 110, example: `${name} -> any ${id} input` });
}

// ======================================================================= Maths
const isNum = (x: any): x is number => typeof x === 'number';
function arith(op: string, a: any, b: any): any {
  const f = (x: number, y: number) => (op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : x / y);
  if (isNum(a) && isNum(b)) return f(a, b);
  if (isV3(a) && isV3(b)) { if (op === '+') return add(a, b); if (op === '-') return sub(a, b); if (op === '*') return dot(a, b); }
  if (isV3(a) && isNum(b) && (op === '*' || op === '/')) return mul(a, op === '*' ? b : 1 / b);
  if (isNum(a) && isV3(b) && op === '*') return mul(b, a);
  if (typeof a === 'string' || typeof b === 'string') { if (op === '+') return formatValue(a) + formatValue(b); }
  if (typeof a === 'boolean' || typeof b === 'boolean') return f(Number(a), Number(b));
  throw new Error(`Cannot compute ${formatValue(a)} ${op} ${formatValue(b)}`);
}
for (const [id, name, op, d, desc] of [['add', 'Addition', '+', 0, 'Adds numbers or vectors (text is joined).'], ['sub', 'Subtraction', '-', 0, 'Subtracts numbers or vectors.'], ['mul', 'Multiplication', '*', 1, 'Multiplies numbers, scales a vector by a number, or gives the dot product of two vectors.'], ['div', 'Division', '/', 1, 'Divides numbers, or a vector by a number.']] as [string, string, string, number, string][]) {
  C(`math.${id}`, name, op === '*' ? 'A×B' : op === '/' ? 'A/B' : `A${op}B`, 'Maths', desc, [P('A', 'any', 'First operand', { d }), P('B', 'any', 'Second operand', { d })], [P('Result', 'any', 'Result', { nick: 'R' })], ([a, b]) => [arith(op, a, b)], { example: `2 ${op} 3`, noPreview: true });
}
const fn1 = (id: string, name: string, nick: string, desc: string, f: (x: number) => number, d = 0) =>
  C(`math.${id}`, name, nick, 'Maths', desc, [num('X', 'Input value', d)], [num('Y', 'Result')], ([x]) => [f(x)], { noPreview: true });
fn1('neg', 'Negative', '−X', 'Changes the sign of a number.', x => -x); fn1('abs', 'Absolute', '|X|', 'Absolute value.', Math.abs);
fn1('sqrt', 'Square Root', '√X', 'Square root.', Math.sqrt, 1); fn1('sin', 'Sine', 'Sin', 'Sine of an angle in radians.', Math.sin); fn1('cos', 'Cosine', 'Cos', 'Cosine of an angle in radians.', Math.cos);
fn1('tan', 'Tangent', 'Tan', 'Tangent of an angle in radians.', Math.tan); fn1('asin', 'ArcSine', 'ASin', 'Inverse sine, in radians.', Math.asin); fn1('acos', 'ArcCosine', 'ACos', 'Inverse cosine, in radians.', Math.acos);
fn1('atan', 'ArcTangent', 'ATan', 'Inverse tangent, in radians.', Math.atan); fn1('deg', 'Degrees', 'Deg', 'Converts radians to degrees.', x => x * 180 / Math.PI); fn1('rad', 'Radians', 'Rad', 'Converts degrees to radians.', x => x * Math.PI / 180);
fn1('exp', 'Exponential', 'eˣ', 'e raised to the power X.', Math.exp); fn1('ln', 'Natural Logarithm', 'Ln', 'Natural logarithm.', Math.log, 1); fn1('log10', 'Logarithm', 'Log', 'Base-10 logarithm.', Math.log10, 1);
C('math.pow', 'Power', 'Aᴮ', 'Maths', 'Raises A to the power B.', [num('A', 'Base', 2), num('B', 'Exponent', 2)], [num('R', 'Result')], ([a, b]) => [Math.pow(a, b)], { noPreview: true });
C('math.mod', 'Modulus', 'A%B', 'Maths', 'Remainder of A divided by B.', [num('A', 'Dividend', 0), num('B', 'Divisor', 1)], [num('R', 'Remainder')], ([a, b]) => [a - b * Math.floor(a / b)], { noPreview: true });
C('math.atan2', 'ArcTangent 2', 'ATan2', 'Maths', 'Angle of the point (X, Y) from the X axis, in radians.', [num('Y', 'Y component', 0), num('X', 'X component', 1)], [num('A', 'Angle in radians')], ([y, x]) => [Math.atan2(y, x)], { noPreview: true });
C('math.pi', 'Pi', 'π', 'Maths', 'Pi times a factor.', [num('Factor', 'Multiplier', 1, { nick: 'N' })], [num('Y', 'N × π')], ([n]) => [n * Math.PI], { noPreview: true });
C('math.min', 'Minimum', 'Min', 'Maths', 'Smaller of two numbers.', [num('A', 'First', 0), num('B', 'Second', 0)], [num('R', 'Minimum')], ([a, b]) => [Math.min(a, b)], { noPreview: true });
C('math.max', 'Maximum', 'Max', 'Maths', 'Larger of two numbers.', [num('A', 'First', 0), num('B', 'Second', 0)], [num('R', 'Maximum')], ([a, b]) => [Math.max(a, b)], { noPreview: true });
C('math.sum', 'Mass Addition', 'Sum', 'Maths', 'Adds up a list of numbers (or vectors).', [P('Input', 'any', 'Values to add', { list: true, nick: 'I' })], [P('Result', 'any', 'Total', { nick: 'R' }), P('Partial', 'any', 'Running totals', { list: true, nick: 'Pr' })],
  ([l]) => { const parts: any[] = []; let s: any = null; for (const x of l) { s = s === null ? x : arith('+', s, x); parts.push(s); } return [s, parts]; }, { example: 'Sum of member weights', noPreview: true });
C('math.avg', 'Average', 'Avg', 'Maths', 'Arithmetic mean of a list.', [P('Input', 'number', 'Values', { list: true, nick: 'I' })], [num('Mean', 'Average', undefined, { nick: 'M' })], ([l]) => [l.reduce((a: number, b: number) => a + b, 0) / l.length], { noPreview: true });
C('math.bounds', 'Bounds', 'Bnd', 'Maths', 'Smallest and largest value of a list, as a domain.', [P('Numbers', 'number', 'Values', { list: true, nick: 'N' })], [P('Domain', 'domain', 'Range of the values', { nick: 'I' }), num('Min', 'Smallest value'), num('Max', 'Largest value')],
  ([l]) => { const a = Math.min(...l), b = Math.max(...l); return [{ k: 'domain', a, b }, a, b]; }, { noPreview: true });
C('math.expr', 'Expression', 'Expr', 'Maths', 'Evaluates a formula. Variables in the formula become inputs. Functions: sin cos tan asin acos atan atan2 sqrt abs exp ln log10 floor ceil round min max pow if(c,a,b) clamp deg rad; constants pi, e.',
  [], [num('Result', 'Value of the expression', undefined, { nick: 'R' })], (ins, ctx) => {
    const ex = compileExpr(String(ctx.node.state.expr ?? '0')), vars: Record<string, number> = {};
    ex.vars.forEach((name, i) => { vars[name] = ins[i]; });
    return [ex.eval(vars)];
  }, {
    state: { expr: 'x^2 + y' }, widget: 'text', width: 190, noPreview: true, example: 'Expression "sqrt(a^2 + b^2)" with inputs a and b',
    ports: (node) => {
      let names: string[] = [];
      try { names = compileExpr(String(node.state.expr ?? '0')).vars; } catch { /* reported by solve */ }
      return { inputs: names.map(n => P(n, 'number', `Variable ${n}`, { d: 0, nick: n })), outputs: [P('Result', 'number', 'Value of the expression', { nick: 'R' })] };
    },
  });
C('math.domain', 'Construct Domain', 'Dom', 'Maths', 'A numeric range from A to B.', [num('A', 'Start', 0), num('B', 'End', 1)], [P('Domain', 'domain', 'The range', { nick: 'I' })], ([a, b]) => [{ k: 'domain', a, b }], { noPreview: true });
C('math.dedomain', 'Deconstruct Domain', 'DeDom', 'Maths', 'Start, end and length of a domain.', [P('Domain', 'domain', 'A range', { nick: 'I' })], [num('Start', 'Start', undefined, { nick: 'S' }), num('End', 'End', undefined, { nick: 'E' }), num('Length', 'End minus start', undefined, { nick: 'L' })], ([d]) => [d.a, d.b, d.b - d.a], { noPreview: true });
C('math.remap', 'Remap Numbers', 'ReMap', 'Maths', 'Maps a value from a source range to a target range.', [num('Value', 'Value to remap', undefined, { nick: 'V' }), P('Source', 'domain', 'Source range', { d: { k: 'domain', a: 0, b: 1 }, nick: 'S' }), P('Target', 'domain', 'Target range', { d: { k: 'domain', a: 0, b: 1 }, nick: 'T' })],
  [num('Mapped', 'Remapped value', undefined, { nick: 'R' }), num('Clipped', 'Remapped value limited to the target range', undefined, { nick: 'C' })],
  ([x, s, t]) => { const u = s.b === s.a ? 0 : (x - s.a) / (s.b - s.a), r = t.a + u * (t.b - t.a); return [r, t.a + Math.min(1, Math.max(0, u)) * (t.b - t.a)]; }, { noPreview: true });
C('math.range', 'Range', 'Range', 'Maths', 'Evenly spaced numbers across a domain: N steps give N+1 values.', [P('Domain', 'domain', 'Range to divide', { d: { k: 'domain', a: 0, b: 1 }, nick: 'D' }), int('Steps', 'Number of steps', 10, { nick: 'N' })],
  [P('Range', 'number', 'The values', { list: true, nick: 'R' })], ([d, n]) => [Array.from({ length: Math.max(1, n) + 1 }, (_, i) => d.a + (d.b - d.a) * i / Math.max(1, n))], { example: 'Range 0..1 with 10 steps -> curve parameters', noPreview: true });
C('math.series', 'Series', 'Series', 'Maths', 'A list of numbers: start, start+step, ...', [num('Start', 'First number', 0, { nick: 'S' }), num('Step', 'Increment', 1, { nick: 'N' }), int('Count', 'How many numbers', 10, { nick: 'C' })],
  [P('Series', 'number', 'The numbers', { list: true, nick: 'S' })], ([s, n, c]) => [Array.from({ length: Math.max(0, c) }, (_, i) => s + n * i)], { example: 'Series 0, 2, 5 -> 0 2 4 6 8', noPreview: true });
C('math.random', 'Random', 'Rnd', 'Maths', 'Repeatable pseudo-random numbers in a domain (same seed, same numbers).', [P('Domain', 'domain', 'Range of the numbers', { d: { k: 'domain', a: 0, b: 1 }, nick: 'R' }), int('Count', 'How many', 10, { nick: 'N' }), int('Seed', 'Seed', 1, { nick: 'S' })],
  [P('Numbers', 'number', 'Random values', { list: true, nick: 'R' })], ([d, n, seed]) => { let s = (seed * 2654435761) >>> 0; const out: number[] = []; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; out.push(d.a + (d.b - d.a) * s / 4294967296); } return [out]; }, { noPreview: true });
C('math.round', 'Round', 'Round', 'Maths', 'Rounds a number to the nearest whole number, and down and up.', [num('X', 'Number', 0)], [num('Nearest', 'Rounded', undefined, { nick: 'N' }), num('Floor', 'Rounded down', undefined, { nick: 'F' }), num('Ceiling', 'Rounded up', undefined, { nick: 'C' })], ([x]) => [Math.round(x), Math.floor(x), Math.ceil(x)], { noPreview: true });
C('math.clamp', 'Clamp', 'Clamp', 'Maths', 'Limits a value to the range from Min to Max.', [num('Value', 'Value', 0, { nick: 'V' }), num('Min', 'Lower limit', 0), num('Max', 'Upper limit', 1)], [num('Result', 'Limited value', undefined, { nick: 'R' })], ([x, a, b]) => [Math.min(Math.max(x, a), b)], { noPreview: true });
const cmp = (id: string, name: string, nick: string, desc: string, f: (a: number, b: number) => boolean) =>
  C(`math.${id}`, name, nick, 'Maths', desc, [num('A', 'First number', 0), num('B', 'Second number', 0)], [P('Result', 'boolean', 'True or false', { nick: 'R' })], ([a, b]) => [f(a, b)], { noPreview: true });
cmp('gt', 'Larger Than', 'A>B', 'True when A is larger than B.', (a, b) => a > b); cmp('lt', 'Smaller Than', 'A<B', 'True when A is smaller than B.', (a, b) => a < b);
cmp('gte', 'Larger Or Equal', 'A≥B', 'True when A is at least B.', (a, b) => a >= b); cmp('lte', 'Smaller Or Equal', 'A≤B', 'True when A is at most B.', (a, b) => a <= b);
cmp('eq', 'Equals', 'A=B', 'True when A equals B.', (a, b) => a === b);
C('math.similar', 'Similar', 'A≈B', 'Maths', 'True when A and B differ by no more than the tolerance.', [num('A', 'First', 0), num('B', 'Second', 0), num('Tolerance', 'Allowed difference', 1e-6, { nick: 'T' })], [P('Result', 'boolean', 'True or false', { nick: 'R' })], ([a, b, t]) => [Math.abs(a - b) <= t], { noPreview: true });
const logic = (id: string, name: string, desc: string, f: (a: boolean, b: boolean) => boolean) =>
  C(`math.${id}`, name, name, 'Maths', desc, [P('A', 'boolean', 'First value', { d: false }), P('B', 'boolean', 'Second value', { d: false })], [P('Result', 'boolean', 'True or false', { nick: 'R' })], ([a, b]) => [f(a, b)], { noPreview: true });
logic('and', 'And', 'True when both inputs are true.', (a, b) => a && b); logic('or', 'Or', 'True when at least one input is true.', (a, b) => a || b); logic('xor', 'Xor', 'True when exactly one input is true.', (a, b) => a !== b);
C('math.not', 'Not', 'Not', 'Maths', 'Inverts true and false.', [P('A', 'boolean', 'Value', { d: false })], [P('Result', 'boolean', 'Inverted value', { nick: 'R' })], ([a]) => [!a], { noPreview: true });
C('math.pick', 'Pick', 'Pick', 'Maths', 'Outputs A when the test is true, otherwise B.', [P('Test', 'boolean', 'Condition', { nick: 'T' }), P('A', 'any', 'Value when true'), P('B', 'any', 'Value when false')], [P('Result', 'any', 'Chosen value', { nick: 'R' })], ([t, a, b]) => [t ? a : b], { noPreview: true });

// ======================================================================= Lists
const L = (n: string, d: string, type: DType = 'any') => P(n, type, d, { list: true, nick: 'L' });
const wrap = (i: number, n: number) => ((i % n) + n) % n;
C('list.item', 'List Item', 'Item', 'Lists', 'Picks the item at an index (0 is the first). With Wrap on, indices beyond the end start again from the beginning.', [L('List', 'The list'), int('Index', 'Position of the item', 0, { nick: 'i' }), P('Wrap', 'boolean', 'Wrap indices around', { d: true, nick: 'W' })], [P('Item', 'any', 'The item', { nick: 'I' })],
  ([l, i, w]) => { if (!l.length) return [null]; if (!w && (i < 0 || i >= l.length)) throw new Error(`Index ${i} is outside the list (0 to ${l.length - 1})`); return [l[wrap(i, l.length)]]; }, { example: 'List Item with index 0 -> first point' });
C('list.length', 'List Length', 'Len', 'Lists', 'Number of items in a list.', [L('List', 'The list')], [int('Length', 'Item count', undefined, { nick: 'L' })], ([l]) => [l.length], { noPreview: true });
C('list.reverse', 'Reverse List', 'Rev', 'Lists', 'Reverses the order of a list.', [L('List', 'The list')], [L('List', 'Reversed list')], ([l]) => [[...l].reverse()]);
C('list.shift', 'Shift List', 'Shift', 'Lists', 'Moves items by an offset. With Wrap on, items that fall off one end re-enter at the other.', [L('List', 'The list'), int('Shift', 'Offset (positive moves the start forward)', 1, { nick: 'S' }), P('Wrap', 'boolean', 'Wrap around', { d: true, nick: 'W' })], [L('List', 'Shifted list')],
  ([l, s, w]) => { const n = l.length; if (!n) return [[]]; if (w) return [l.map((_: any, i: number) => l[wrap(i + s, n)])]; return [s >= 0 ? l.slice(s) : l.slice(0, n + s)]; }, { example: 'Shift by 1 to pair each point with the next' });
C('list.sort', 'Sort List', 'Sort', 'Lists', 'Sorts numeric keys in ascending order and reorders a second list the same way.', [P('Keys', 'number', 'Numbers to sort by', { list: true, nick: 'K' }), P('Values', 'any', 'Optional list to reorder with the keys', { list: true, opt: true, nick: 'A' })], [P('Keys', 'number', 'Sorted keys', { list: true, nick: 'K' }), P('Values', 'any', 'Reordered values', { list: true, nick: 'A' }), P('Order', 'integer', 'Original index of each sorted item', { list: true, nick: 'i' })],
  ([k, a]) => { const idx = k.map((_: number, i: number) => i).sort((x: number, y: number) => k[x] - k[y]); return [idx.map((i: number) => k[i]), a ? idx.map((i: number) => a[Math.min(i, a.length - 1)]) : [], idx]; });
C('list.cullpattern', 'Cull Pattern', 'Cull', 'Lists', 'Keeps the items where the repeating true/false pattern is true.', [L('List', 'The list'), P('Pattern', 'boolean', 'Repeating keep pattern', { list: true, d: [true, false], nick: 'P' })], [L('List', 'Kept items')], ([l, p]) => [l.filter((_: any, i: number) => p[i % p.length])], { example: 'Pattern True, False keeps every other item' });
C('list.cullindex', 'Cull Index', 'CullI', 'Lists', 'Removes the items at the given indices.', [L('List', 'The list'), P('Indices', 'integer', 'Positions to remove', { list: true, nick: 'I' })], [L('List', 'Remaining items')], ([l, idx]) => { const s = new Set(idx.map((i: number) => wrap(i, l.length))); return [l.filter((_: any, i: number) => !s.has(i))]; });
C('list.dispatch', 'Dispatch', 'Disp', 'Lists', 'Splits a list in two using a repeating true/false pattern.', [L('List', 'The list'), P('Pattern', 'boolean', 'Repeating pattern', { list: true, d: [true, false], nick: 'P' })], [P('A', 'any', 'Items where the pattern is true', { list: true }), P('B', 'any', 'Items where the pattern is false', { list: true })],
  ([l, p]) => [l.filter((_: any, i: number) => p[i % p.length]), l.filter((_: any, i: number) => !p[i % p.length])], { example: 'Dispatch chord members from diagonals' });
C('list.weave', 'Weave', 'Weave', 'Lists', 'Interleaves two lists following a repeating pattern of 0 (take from A) and 1 (take from B).', [P('Pattern', 'integer', 'Repeating pattern of 0 and 1', { list: true, d: [0, 1], nick: 'P' }), P('A', 'any', 'First list', { list: true }), P('B', 'any', 'Second list', { list: true })], [P('Weave', 'any', 'Combined list', { list: true, nick: 'W' })],
  ([p, a, b]) => { const out: any[] = []; let ia = 0, ib = 0, k = 0; while (ia < a.length || ib < b.length) { const pick = p[k++ % p.length]; if (pick === 0) { if (ia < a.length) out.push(a[ia++]); else if (!p.includes(1)) break; } else if (ib < b.length) out.push(b[ib++]); else if (!p.includes(0)) break; if (k > 4 * (a.length + b.length) + 8) break; } return [out]; });
C('list.sublist', 'Sub List', 'Sub', 'Lists', 'A run of items: Count items starting at Start.', [L('List', 'The list'), int('Start', 'Index of the first item', 0, { nick: 'S' }), int('Count', 'Number of items', 1, { nick: 'N' })], [L('List', 'The selected items')], ([l, s, n]) => [l.slice(Math.max(0, s), Math.max(0, s) + Math.max(0, n))]);
C('list.duplicate', 'Duplicate Data', 'Dup', 'Lists', 'Repeats the data N times.', [L('Data', 'Data to repeat'), int('Number', 'Repetitions', 2, { nick: 'N' }), P('Order', 'boolean', 'True: repeat the whole list in order; false: repeat each item in place', { d: true, nick: 'O' })], [L('Data', 'Repeated data')],
  ([l, n, o]) => { const out: any[] = []; if (o) for (let i = 0; i < n; i++) out.push(...l); else for (const x of l) for (let i = 0; i < n; i++) out.push(x); return [out]; });
C('list.merge', 'Merge', 'Merge', 'Lists', 'Combines several streams into one. Branches with the same path are joined in input order.', [P('A', 'any', 'First stream', { tree: true, opt: true }), P('B', 'any', 'Second stream', { tree: true, opt: true }), P('C', 'any', 'Third stream', { tree: true, opt: true }), P('D', 'any', 'Fourth stream', { tree: true, opt: true })], [P('Result', 'any', 'Merged data', { tree: true, nick: 'R' })], null, { solveTrees: (ts) => [DataTree.merge(ts)], example: 'Merge beams and columns into one element list' });
C('list.partition', 'Partition List', 'Part', 'Lists', 'Cuts a list into chunks of a given size. Each chunk becomes its own branch.', [P('List', 'any', 'The list', { tree: true, nick: 'L' }), int('Size', 'Items per chunk', 2, { nick: 'S' })], [P('Chunks', 'any', 'One branch per chunk', { tree: true, nick: 'C' })], null,
  { solveTrees: ([t, s]) => { const size = Math.max(1, Math.round(Number(s.first() ?? 2))), out = new DataTree(); for (const b of t.branches) for (let i = 0, c = 0; i < b.items.length; i += size, c++) out.add([...b.path, c], b.items.slice(i, i + size)); return [out]; } });
C('list.first', 'First And Last', 'Ends', 'Lists', 'The first and last items of a list.', [L('List', 'The list')], [P('First', 'any', 'First item', { nick: 'F' }), P('Last', 'any', 'Last item', { nick: 'L' })], ([l]) => [l[0], l[l.length - 1]]);

// ======================================================================= Trees
const T = (n: string, d: string) => P(n, 'any', d, { tree: true, nick: 'T' });
const treeOp = (id: string, name: string, nick: string, desc: string, f: (t: DataTree) => DataTree, example?: string) =>
  C(`tree.${id}`, name, nick, 'Trees', desc, [T('Tree', 'Data tree')], [T('Tree', 'Result')], null, { solveTrees: ([t]) => [f(t)], example });
treeOp('flatten', 'Flatten Tree', 'Flat', 'Puts all items into a single list (branch {0}).', t => t.flatten(), 'Flatten points from many curves into one list');
treeOp('graft', 'Graft Tree', 'Graft', 'Gives every item its own branch.', t => t.graft(), 'Graft one list to combine each item with every item of another');
treeOp('simplify', 'Simplify Tree', 'Simp', 'Removes the part of the branch paths that all branches share.', t => t.simplify());
treeOp('reverse', 'Reverse Tree Items', 'TRev', 'Reverses the items inside each branch.', t => t.reverse());
treeOp('trim', 'Trim Tree', 'Trim', 'Removes the last path index, merging sibling branches.', t => t.trim(1));
treeOp('flip', 'Flip Matrix', 'Flip', 'Swaps rows and columns: item j of branch i becomes item i of branch j.', t => { const out = new DataTree(); t.branches.forEach((b) => b.items.forEach((it, j) => out.add([j], [it]))); return out; }, 'Turn rows of a point grid into columns');
C('tree.branch', 'Tree Branch', 'Branch', 'Trees', 'Extracts one branch by its path, written like {0;1}.', [T('Tree', 'Data tree'), P('Path', 'text', 'Path of the branch, e.g. {0;1}', { d: '{0}', nick: 'P' })], [L('Branch', 'Items of the branch')], null,
  { solveTrees: ([t, pth]) => { const s = String(pth.first() ?? '{0}'); const path = s.replace(/[{}\s]/g, '').split(';').filter(x => x.length).map(Number); const items = t.branch(path); if (!items) throw new Error(`There is no branch ${pathText(path)}. Available: ${t.branches.slice(0, 8).map(b => pathText(b.path)).join(' ')}`); return [DataTree.fromList(items)]; } });
C('tree.pathmap', 'Path Mapper', 'Map', 'Trees', 'Rewrites branch paths. Source and target are masks such as {A;B} and {B;A}; target entries may be formulas in the source letters.', [T('Tree', 'Data tree')], [T('Tree', 'Tree with new paths')], null,
  { state: { source: '{A;B}', target: '{B;A}' }, widget: 'text', width: 190, solveTrees: ([t], ctx) => [mapPathsByMask(t, String(ctx.node.state.source), String(ctx.node.state.target), (e, vars) => evalExpr(e, vars))], example: '{A;B} -> {B} groups items by their second index' });
C('tree.stats', 'Tree Statistics', 'TStat', 'Trees', 'Paths, branch lengths and branch count of a tree.', [T('Tree', 'Data tree')], [P('Paths', 'text', 'Path of each branch', { list: true, nick: 'P' }), P('Lengths', 'integer', 'Items in each branch', { list: true, nick: 'L' }), int('Count', 'Number of branches', undefined, { nick: 'C' })], null,
  { solveTrees: ([t]) => [DataTree.fromList(t.branches.map(b => pathText(b.path))), DataTree.fromList(t.branches.map(b => b.items.length)), DataTree.of(t.branchCount)], noPreview: true });

// ======================================================================= Vectors and planes
C('vec.point', 'Construct Point', 'Pt', 'Vector', 'A point from X, Y and Z coordinates.', [num('X', 'X coordinate', 0), num('Y', 'Y coordinate', 0), num('Z', 'Z coordinate', 0)], [pt('Point', 'The point', null, { nick: 'Pt' })], ([x, y, z]) => [v(x, y, z)], { example: 'Three sliders -> Construct Point' });
C('vec.depoint', 'Deconstruct Point', 'pXYZ', 'Vector', 'The X, Y and Z coordinates of a point.', [pt('Point', 'A point', null, { nick: 'P' })], [num('X', 'X coordinate'), num('Y', 'Y coordinate'), num('Z', 'Z coordinate')], ([p]) => [p.x, p.y, p.z], { noPreview: true });
C('vec.vector', 'Vector XYZ', 'Vec', 'Vector', 'A vector from X, Y and Z components.', [num('X', 'X component', 0), num('Y', 'Y component', 0), num('Z', 'Z component', 0)], [vec('Vector', 'The vector', undefined, { nick: 'V' }), num('Length', 'Vector length', undefined, { nick: 'L' })], ([x, y, z]) => [v(x, y, z), Math.hypot(x, y, z)], { noPreview: true });
C('vec.devector', 'Deconstruct Vector', 'vXYZ', 'Vector', 'The components of a vector.', [vec('Vector', 'A vector', undefined, { nick: 'V' })], [num('X', 'X component'), num('Y', 'Y component'), num('Z', 'Z component')], ([p]) => [p.x, p.y, p.z], { noPreview: true });
for (const [id, name, ax] of [['x', 'Unit X', X], ['y', 'Unit Y', Y], ['z', 'Unit Z', Z]] as [string, string, V3][])
  C(`vec.unit${id}`, name, id.toUpperCase(), 'Vector', `A vector along the world ${id.toUpperCase()} axis, scaled by the factor.`, [num('Factor', 'Length of the vector', 1, { nick: 'F' })], [vec('Vector', 'The vector', undefined, { nick: 'V' })], ([f]) => [mul(ax, f)], { noPreview: true, example: `${name} with factor -10 as a load direction` });
C('vec.2pt', 'Vector 2Pt', 'Vec2Pt', 'Vector', 'The vector from point A to point B.', [pt('A', 'Start point', null), pt('B', 'End point', null), P('Unitize', 'boolean', 'Scale the result to length 1', { d: false, nick: 'U' })], [vec('Vector', 'B minus A', undefined, { nick: 'V' }), num('Length', 'Distance from A to B', undefined, { nick: 'L' })], ([a, b, u]) => { const d = sub(b, a); return [u ? unit(d) : d, len(d)]; }, { noPreview: true });
C('vec.amp', 'Amplitude', 'Amp', 'Vector', 'Sets the length of a vector, keeping its direction.', [vec('Vector', 'A vector', undefined, { nick: 'V' }), num('Amplitude', 'New length', 1, { nick: 'A' })], [vec('Vector', 'Resized vector', undefined, { nick: 'V' })], ([a, s]) => [mul(unit(a), s)], { noPreview: true });
C('vec.unitize', 'Unitize', 'Unit', 'Vector', 'Scales a vector to length 1.', [vec('Vector', 'A vector', undefined, { nick: 'V' })], [vec('Vector', 'Unit vector', undefined, { nick: 'V' })], ([a]) => [unit(a)], { noPreview: true });
C('vec.length', 'Vector Length', 'VLen', 'Vector', 'Length of a vector.', [vec('Vector', 'A vector', undefined, { nick: 'V' })], [num('Length', 'The length', undefined, { nick: 'L' })], ([a]) => [len(a)], { noPreview: true });
C('vec.reverse', 'Reverse Vector', 'VRev', 'Vector', 'Flips a vector.', [vec('Vector', 'A vector', undefined, { nick: 'V' })], [vec('Vector', 'Reversed vector', undefined, { nick: 'V' })], ([a]) => [mul(a, -1)], { noPreview: true });
C('vec.cross', 'Cross Product', 'XProd', 'Vector', 'Vector perpendicular to A and B (right-hand rule).', [vec('A', 'First vector'), vec('B', 'Second vector')], [vec('Vector', 'A × B', undefined, { nick: 'V' })], ([a, b]) => [cross(a, b)], { noPreview: true });
C('vec.dot', 'Dot Product', 'DProd', 'Vector', 'Dot product of two vectors.', [vec('A', 'First vector'), vec('B', 'Second vector')], [num('Result', 'A · B', undefined, { nick: 'D' })], ([a, b]) => [dot(a, b)], { noPreview: true });
C('vec.angle', 'Angle', 'Angle', 'Vector', 'Angle between two vectors in radians (0 to π).', [vec('A', 'First vector'), vec('B', 'Second vector')], [num('Angle', 'Angle in radians', undefined, { nick: 'A' })], ([a, b]) => [vAngle(a, b)], { noPreview: true });
C('vec.distance', 'Distance', 'Dist', 'Vector', 'Distance between two points.', [pt('A', 'First point', null), pt('B', 'Second point', null)], [num('Distance', 'The distance', undefined, { nick: 'D' })], ([a, b]) => [dist(a, b)], { noPreview: true });
C('vec.lerp', 'Point Between', 'Mid', 'Vector', 'A point on the line from A to B at parameter t (0.5 is the midpoint).', [pt('A', 'First point', null), pt('B', 'Second point', null), num('t', 'Position between A (0) and B (1)', 0.5)], [pt('Point', 'The point', null, { nick: 'P' })], ([a, b, t]) => [lerp(a, b, t)]);
for (const [id, name, pl] of [['xy', 'XY Plane', WORLD_XY], ['xz', 'XZ Plane', { k: 'plane', o: O, x: X, y: Z, z: mul(Y, -1) }], ['yz', 'YZ Plane', { k: 'plane', o: O, x: Y, y: Z, z: X }]] as [string, string, Plane][])
  C(`plane.${id}`, name, id.toUpperCase(), 'Vector', `The world ${id.toUpperCase()} plane moved to an origin point.`, [pt('Origin', 'Origin of the plane', O, { nick: 'O' })], [P('Plane', 'plane', 'The plane', { nick: 'P' })], ([o]) => [{ ...pl, o }], { noPreview: true });
C('plane.normal', 'Plane Normal', 'PlN', 'Vector', 'A plane through a point, perpendicular to a vector.', [pt('Origin', 'Origin', O, { nick: 'O' }), vec('Normal', 'Direction perpendicular to the plane', Z, { nick: 'Z' })], [P('Plane', 'plane', 'The plane', { nick: 'P' })], ([o, n]) => [planeFromNormal(o, n)], { noPreview: true });
C('plane.3pt', 'Plane 3Pt', 'Pl3', 'Vector', 'A plane through three points: A is the origin, B sets the X direction.', [pt('A', 'Origin', null), pt('B', 'Point on the X axis', null), pt('C', 'Any third point', null)], [P('Plane', 'plane', 'The plane', { nick: 'P' })], ([a, b, c]) => [planeFrom3Points(a, b, c)], { noPreview: true });
C('plane.decon', 'Deconstruct Plane', 'DePl', 'Vector', 'Origin and axes of a plane.', [P('Plane', 'plane', 'A plane', { nick: 'P' })], [pt('Origin', 'Origin', null, { nick: 'O' }), vec('X', 'X axis'), vec('Y', 'Y axis'), vec('Z', 'Normal')], ([p]) => [p.o, p.x, p.y, p.z], { noPreview: true });
C('plane.eval', 'Evaluate Plane', 'PlPt', 'Vector', 'The point at coordinates (U, V) in a plane.', [pln('Plane', 'A plane', { nick: 'P' }), num('U', 'Coordinate along the plane X axis', 0), num('V', 'Coordinate along the plane Y axis', 0)], [pt('Point', 'The point', null, { nick: 'Pt' })], ([p, a, b]) => [planePoint(p, a, b)]);
C('grid.square', 'Square Grid', 'SqGrid', 'Vector', 'A grid of points. Each row along Y is a branch.', [pln('Plane', 'Base plane', { nick: 'P' }), num('Size X', 'Cell size along X', 1, { nick: 'Sx' }), num('Size Y', 'Cell size along Y', 1, { nick: 'Sy' }), int('Count X', 'Cells along X', 5, { nick: 'Nx' }), int('Count Y', 'Cells along Y', 5, { nick: 'Ny' })],
  [P('Points', 'point', 'Grid points, one branch per row', { tree: true, nick: 'P' })], null,
  { solveTrees: ([pl, sx, sy, nx, ny]) => { const out = new DataTree<V3>(), p = (pl.first() ?? WORLD_XY) as Plane, a = Number(sx.first() ?? 1), b = Number(sy.first() ?? 1), n = Number(nx.first() ?? 5), m = Number(ny.first() ?? 5); for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) out.add([j], [planePoint(p, i * a, j * b)]); return [out]; }, example: 'Square Grid -> column base points' });
C('grid.hex', 'Hexagonal Grid', 'HexGrid', 'Vector', 'Centre points of a honeycomb pattern.', [pln('Plane', 'Base plane', { nick: 'P' }), num('Size', 'Distance from a cell centre to its corners', 1, { nick: 'S' }), int('Count X', 'Cells along X', 5, { nick: 'Nx' }), int('Count Y', 'Cells along Y', 5, { nick: 'Ny' })],
  [P('Points', 'point', 'Cell centres', { list: true, nick: 'P' })], ([p, s, nx, ny]) => { const out: V3[] = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push(planePoint(p, s * Math.sqrt(3) * (i + (j % 2) / 2), s * 1.5 * j)); return [out]; });
C('grid.radial', 'Radial Grid', 'RadGrid', 'Vector', 'Points on concentric circles. Each ring is a branch.', [pln('Plane', 'Base plane', { nick: 'P' }), num('Spacing', 'Distance between rings', 1, { nick: 'S' }), int('Rings', 'Number of rings', 4, { nick: 'Nr' }), int('Divisions', 'Points per ring', 12, { nick: 'Np' })],
  [P('Points', 'point', 'Grid points, one branch per ring', { tree: true, nick: 'P' })], null,
  { solveTrees: ([pl, s, nr, np]) => { const out = new DataTree<V3>(), p = (pl.first() ?? WORLD_XY) as Plane, sp = Number(s.first() ?? 1), R = Number(nr.first() ?? 4), N = Number(np.first() ?? 12); for (let r = 1; r <= R; r++) for (let i = 0; i < N; i++) out.add([r - 1], [planePoint(p, r * sp * Math.cos(2 * Math.PI * i / N), r * sp * Math.sin(2 * Math.PI * i / N))]); return [out]; } });
export { coerce, isPlane };
