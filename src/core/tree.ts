/**
 * Hierarchical data trees.
 *
 * Every wire in the graph carries a DataTree: an ordered set of branches, each
 * addressed by a path (a list of non-negative integers, written {0;2;1}) and
 * holding a flat list of items. A single value is a tree with one branch {0}
 * containing one item.
 *
 * Conventions used throughout Nodal (our own definitions, documented in the
 * user guide so behavior is predictable):
 *  - Branches are always kept sorted lexicographically by path.
 *  - `simplify` strips the longest prefix shared by all paths but always leaves
 *    at least one index, so a single-branch tree keeps its last index.
 *  - `reverse` reverses the items inside each branch (branch order is kept).
 *  - Cross-reference matching is row-major: the FIRST input varies slowest.
 */

export type Path = number[];
export interface Branch<T = unknown> { path: Path; items: T[] }
export type Matching = 'longest' | 'shortest' | 'cross';

export const pathKey = (p: readonly number[]): string => p.join(';');
export const pathText = (p: readonly number[]): string => `{${p.join(';')}}`;

/** Lexicographic comparison; a shorter path sorts before its extensions. */
export function comparePaths(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

export class DataTree<T = unknown> {
  private map = new Map<string, Branch<T>>();
  private sorted: Branch<T>[] | null = [];

  static of<T>(item: T): DataTree<T> { return new DataTree<T>().add([0], [item]); }
  static fromList<T>(items: readonly T[], path: Path = [0]): DataTree<T> {
    return new DataTree<T>().add(path, items);
  }
  static fromBranches<T>(branches: readonly Branch<T>[]): DataTree<T> {
    const t = new DataTree<T>();
    for (const b of branches) t.add(b.path, b.items);
    return t;
  }

  /** Append items to the branch at `path`, creating it if needed. */
  add(path: readonly number[], items: readonly T[]): this {
    const k = pathKey(path);
    let b = this.map.get(k);
    if (!b) { b = { path: [...path], items: [] }; this.map.set(k, b); this.sorted = null; }
    for (const it of items) b.items.push(it);
    return this;
  }
  /** Make sure a (possibly empty) branch exists. */
  ensure(path: readonly number[]): this { return this.add(path, []); }

  get branches(): Branch<T>[] {
    if (!this.sorted) this.sorted = [...this.map.values()].sort((a, b) => comparePaths(a.path, b.path));
    return this.sorted;
  }
  get branchCount(): number { return this.map.size; }
  get dataCount(): number { let n = 0; for (const b of this.map.values()) n += b.items.length; return n; }
  get isEmpty(): boolean { return this.dataCount === 0; }
  branch(path: readonly number[]): T[] | undefined { return this.map.get(pathKey(path))?.items; }
  allItems(): T[] { const out: T[] = []; for (const b of this.branches) for (const it of b.items) out.push(it); return out; }
  first(): T | undefined { for (const b of this.branches) if (b.items.length) return b.items[0]; return undefined; }

  map_<U>(fn: (item: T, path: Path, index: number) => U): DataTree<U> {
    const t = new DataTree<U>();
    for (const b of this.branches) t.add(b.path, b.items.map((it, i) => fn(it, b.path, i)));
    return t;
  }

  // ---- tree operations -------------------------------------------------
  /** All items into the single branch {0}. */
  flatten(): DataTree<T> { return DataTree.fromList(this.allItems()); }

  /** Every item into its own branch: item i of {A} goes to {A;i}. */
  graft(): DataTree<T> {
    const t = new DataTree<T>();
    for (const b of this.branches) {
      if (b.items.length === 0) t.ensure([...b.path, 0]);
      b.items.forEach((it, i) => t.add([...b.path, i], [it]));
    }
    return t;
  }

  /** Remove the path prefix shared by all branches (at least one index stays). */
  simplify(): DataTree<T> {
    const bs = this.branches;
    if (bs.length === 0) return new DataTree<T>();
    let common = Math.min(...bs.map(b => b.path.length)) - 1;
    for (let i = 0; i < common; i++) {
      const v = bs[0].path[i];
      if (bs.some(b => b.path[i] !== v)) { common = i; break; }
    }
    common = Math.max(0, common);
    const t = new DataTree<T>();
    for (const b of bs) t.add(b.path.slice(common), b.items);
    return t;
  }

  /** Reverse the items inside each branch. */
  reverse(): DataTree<T> {
    const t = new DataTree<T>();
    for (const b of this.branches) t.add(b.path, [...b.items].reverse());
    return t;
  }

  /** Remove the last `depth` path indices, merging branches that collide. */
  trim(depth = 1): DataTree<T> {
    const t = new DataTree<T>();
    for (const b of this.branches) {
      const p = b.path.slice(0, Math.max(1, b.path.length - depth));
      t.add(b.path.length - depth < 1 ? [0] : p, b.items);
    }
    return t;
  }

  /** Rewrite each path with `fn`; branches mapped to the same path are merged in order. */
  mapPaths(fn: (path: Path) => Path): DataTree<T> {
    const t = new DataTree<T>();
    for (const b of this.branches) t.add(fn([...b.path]), b.items);
    return t;
  }

  /** Union of trees; branches with equal paths are concatenated in argument order. */
  static merge<T>(trees: readonly DataTree<T>[]): DataTree<T> {
    const t = new DataTree<T>();
    for (const tr of trees) for (const b of tr.branches) t.add(b.path, b.items);
    return t;
  }

  /** Plain-object form, used for persistence and for crossing worker boundaries. */
  toJSON(): Branch<T>[] { return this.branches.map(b => ({ path: [...b.path], items: [...b.items] })); }
  toString(): string {
    return this.branches.map(b => `${pathText(b.path)} N=${b.items.length}`).join('\n');
  }
}

/**
 * Path mapping with lexical masks, e.g. "{A;B}" -> "{B;A}" or "{A;B}" -> "{A}".
 * Source letters bind to the indices of each path; each target index is an
 * arithmetic expression in those letters (evaluated by `evalIndex`). Paths
 * whose length differs from the source mask are left unchanged.
 */
export function mapPathsByMask<T>(
  tree: DataTree<T>, source: string, target: string,
  evalIndex: (expr: string, vars: Record<string, number>) => number,
): DataTree<T> {
  const parse = (s: string): string[] => {
    const m = s.trim().match(/^\{(.*)\}$/);
    if (!m) throw new Error(`Path mask must look like {A;B}: "${s}"`);
    return m[1].split(';').map(x => x.trim()).filter(x => x.length > 0);
  };
  const src = parse(source), dst = parse(target);
  if (dst.length === 0) throw new Error('Target mask needs at least one index');
  return tree.mapPaths(path => {
    if (path.length !== src.length) return path;
    const vars: Record<string, number> = {};
    src.forEach((name, i) => { vars[name] = path[i]; });
    return dst.map(e => {
      const v = Math.round(evalIndex(e, vars));
      if (!Number.isFinite(v) || v < 0) throw new Error(`Path index "${e}" evaluated to ${v}`);
      return v;
    });
  });
}

/**
 * Item matching inside one set of matched branches.
 * Returns one index tuple per iteration: tuples[k][j] is the index into list j.
 *  - longest: shorter lists repeat their last item (the default)
 *  - shortest: iteration stops at the shortest list
 *  - cross: every combination, first list varying slowest
 * If any list is empty there are no iterations.
 */
export function matchIndices(lengths: readonly number[], mode: Matching): number[][] {
  if (lengths.length === 0) return [[]];
  if (lengths.some(n => n === 0)) return [];
  const out: number[][] = [];
  if (mode === 'cross') {
    const total = lengths.reduce((a, b) => a * b, 1);
    for (let k = 0; k < total; k++) {
      const tup = new Array<number>(lengths.length);
      let r = k;
      for (let j = lengths.length - 1; j >= 0; j--) { tup[j] = r % lengths[j]; r = Math.floor(r / lengths[j]); }
      out.push(tup);
    }
    return out;
  }
  const n = mode === 'shortest' ? Math.min(...lengths) : Math.max(...lengths);
  for (let k = 0; k < n; k++) out.push(lengths.map(len => Math.min(k, len - 1)));
  return out;
}

/**
 * Branch matching between several input trees. Branches are paired by their
 * position in sorted order, and a tree with fewer branches repeats its last
 * one. The output path for each pairing comes from the tree with the most
 * branches (ties: the deepest path, then the first input).
 */
export function matchBranches(trees: readonly DataTree[]): { path: Path; lists: unknown[][] }[] {
  if (trees.length === 0) return [{ path: [0], lists: [] }];
  const counts = trees.map(t => t.branchCount);
  if (counts.some(c => c === 0)) return [];
  const n = Math.max(...counts);
  const out: { path: Path; lists: unknown[][] }[] = [];
  for (let j = 0; j < n; j++) {
    const bs = trees.map((t, k) => t.branches[Math.min(j, counts[k] - 1)]);
    let master = -1;
    for (let k = 0; k < trees.length; k++) {
      if (counts[k] !== n) continue;
      if (master < 0 || bs[k].path.length > bs[master].path.length) master = k;
    }
    out.push({ path: [...bs[master].path], lists: bs.map(b => b.items) });
  }
  return out;
}
