/**
 * Sparse symmetric linear algebra for the finite element solver.
 *
 *  - SymCSC: symmetric matrix, upper triangle stored in compressed-column form.
 *  - Fill-reducing ordering: minimum degree on the node graph (quotient-graph
 *    form with element absorption) and reverse Cuthill–McKee; the solver keeps
 *    whichever predicts less fill.
 *  - LDL^T factorisation without pivoting, in the up-looking form of
 *    T. A. Davis, "Algorithm 849: A concise sparse Cholesky factorization
 *    package", ACM TOMS 31(4), 2005 (re-implemented here from the paper).
 *
 * LDL^T (rather than LL^T) is used so that indefinite tangent matrices in
 * buckling and nonlinear analyses can still be factorised, and so that the
 * number of negative pivots (the inertia) is available as a stability check.
 */

export class SymCSC {
  readonly val: Float64Array;
  constructor(readonly n: number, readonly colPtr: Int32Array, readonly rowIdx: Int32Array, val?: Float64Array) {
    this.val = val ?? new Float64Array(rowIdx.length);
  }
  get nnz(): number { return this.rowIdx.length; }
  /** Add v at (i, j). Either index may be negative (constrained DOF), in which case nothing is added. */
  add(i: number, j: number, v: number): void {
    if (i < 0 || j < 0) return;
    if (i > j) { const t = i; i = j; j = t; }
    let lo = this.colPtr[j], hi = this.colPtr[j + 1] - 1;
    const ri = this.rowIdx;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, r = ri[mid];
      if (r === i) { this.val[mid] += v; return; }
      if (r < i) lo = mid + 1; else hi = mid - 1;
    }
    throw new Error(`Sparse pattern has no entry (${i}, ${j})`);
  }
  diagonal(): Float64Array {
    const d = new Float64Array(this.n);
    for (let j = 0; j < this.n; j++) { const p = this.colPtr[j + 1] - 1; if (p >= this.colPtr[j] && this.rowIdx[p] === j) d[j] = this.val[p]; }
    return d;
  }
  /** y = A x using symmetry. */
  mul(x: Float64Array, y: Float64Array = new Float64Array(this.n)): Float64Array {
    y.fill(0);
    const { colPtr, rowIdx, val } = this;
    for (let j = 0; j < this.n; j++) {
      const xj = x[j];
      let s = 0;
      for (let p = colPtr[j]; p < colPtr[j + 1]; p++) {
        const i = rowIdx[p], a = val[p];
        if (i === j) s += a * xj; else { y[i] += a * xj; s += a * x[i]; }
      }
      y[j] += s;
    }
    return y;
  }
  /** Same pattern, zero values. */
  like(): SymCSC { return new SymCSC(this.n, this.colPtr, this.rowIdx); }
  /** this + alpha * B for matrices sharing a pattern. */
  axpy(alpha: number, B: SymCSC): SymCSC {
    const C = new SymCSC(this.n, this.colPtr, this.rowIdx, Float64Array.from(this.val));
    for (let p = 0; p < C.val.length; p++) C.val[p] += alpha * B.val[p];
    return C;
  }
}

/** Build an upper-triangle pattern from element equation lists (-1 entries are skipped). */
export function buildPattern(n: number, elementEqs: Int32Array[]): SymCSC {
  const cols: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let j = 0; j < n; j++) cols[j].add(j);
  for (const eqs of elementEqs) {
    for (let a = 0; a < eqs.length; a++) {
      const i = eqs[a]; if (i < 0) continue;
      for (let b = 0; b < eqs.length; b++) { const j = eqs[b]; if (j >= i) cols[j].add(i); }
    }
  }
  const colPtr = new Int32Array(n + 1);
  for (let j = 0; j < n; j++) colPtr[j + 1] = colPtr[j] + cols[j].size;
  const rowIdx = new Int32Array(colPtr[n]);
  for (let j = 0; j < n; j++) {
    const rows = Int32Array.from(cols[j]).sort();
    rowIdx.set(rows, colPtr[j]);
  }
  return new SymCSC(n, colPtr, rowIdx);
}

// ---- orderings --------------------------------------------------------------
/** Reverse Cuthill–McKee ordering of an undirected graph. Returns perm with perm[k] = old index of new node k. */
export function rcmOrder(n: number, adj: number[][]): Int32Array {
  const perm = new Int32Array(n), visited = new Uint8Array(n);
  let count = 0;
  const deg = adj.map(a => a.length);
  const bfs = (start: number, mark: Uint8Array): number[] => {
    const order = [start]; mark[start] = 1;
    for (let h = 0; h < order.length; h++) {
      const nb = adj[order[h]].filter(x => !mark[x]).sort((a, b) => deg[a] - deg[b]);
      for (const x of nb) { if (!mark[x]) { mark[x] = 1; order.push(x); } }
    }
    return order;
  };
  for (let s = 0; s < n; s++) {
    if (visited[s]) continue;
    // Pseudo-peripheral start: repeat BFS from the last (lowest-degree) node of the previous sweep.
    let start = s;
    for (let it = 0; it < 3; it++) {
      const tmp = new Uint8Array(n);
      for (let i = 0; i < n; i++) tmp[i] = visited[i];
      const ord = bfs(start, tmp);
      const last = ord[ord.length - 1];
      if (last === start) break;
      start = last;
    }
    for (const x of bfs(start, visited)) perm[count++] = x;
  }
  perm.reverse();
  return perm;
}

/**
 * Minimum-degree ordering in quotient-graph form. Eliminated nodes become
 * "elements" whose variable lists stand for the cliques they create, and an
 * element absorbs the elements adjacent to its pivot, so storage never grows.
 * Degrees are exact (external degree), which is affordable at node level.
 */
export function minDegreeOrder(n: number, adj: number[][]): Int32Array {
  const avar: Set<number>[] = adj.map(a => new Set(a));
  const aelt: number[][] = Array.from({ length: n }, () => []);
  const evars: (number[] | null)[] = new Array(n).fill(null);
  const eliminated = new Uint8Array(n), mark = new Int32Array(n).fill(-1);
  const degree = new Int32Array(n);
  // Degree buckets as doubly linked lists.
  const head = new Int32Array(n + 1).fill(-1), next = new Int32Array(n).fill(-1), prev = new Int32Array(n).fill(-1);
  const insert = (i: number, d: number) => { degree[i] = d; prev[i] = -1; next[i] = head[d]; if (head[d] >= 0) prev[head[d]] = i; head[d] = i; };
  const remove = (i: number) => {
    const d = degree[i];
    if (prev[i] >= 0) next[prev[i]] = next[i]; else head[d] = next[i];
    if (next[i] >= 0) prev[next[i]] = prev[i];
  };
  for (let i = 0; i < n; i++) insert(i, avar[i].size);
  const perm = new Int32Array(n);
  let stamp = 0, minDeg = 0;
  for (let k = 0; k < n; k++) {
    while (minDeg < n && head[minDeg] < 0) minDeg++;
    const p = head[minDeg];
    remove(p); eliminated[p] = 1; perm[k] = p;
    // Lp = variables adjacent to p directly or through its elements.
    const Lp: number[] = [];
    stamp++; mark[p] = stamp;
    for (const x of avar[p]) if (mark[x] !== stamp) { mark[x] = stamp; Lp.push(x); }
    for (const e of aelt[p]) {
      for (const x of evars[e]!) if (!eliminated[x] && mark[x] !== stamp) { mark[x] = stamp; Lp.push(x); }
      evars[e] = null;                                  // absorbed into the new element p
    }
    evars[p] = Lp;
    const inLp = stamp;
    for (const x of Lp) {
      avar[x].delete(p);
      // Edges inside the new clique are represented by element p; drop them from the explicit lists.
      for (const y of avar[x]) if (mark[y] === inLp) avar[x].delete(y);
      const el = aelt[x].filter(e => evars[e] !== null);
      el.push(p); aelt[x] = el;
    }
    for (const x of Lp) {
      stamp++; mark[x] = stamp;
      let d = 0;
      for (const y of avar[x]) if (mark[y] !== stamp) { mark[y] = stamp; d++; }
      for (const e of aelt[x]) for (const y of evars[e]!) if (!eliminated[y] && mark[y] !== stamp) { mark[y] = stamp; d++; }
      remove(x); insert(x, d);
      if (d < minDeg) minDeg = d;
    }
    // Restore the Lp marks invalidated above is unnecessary: stamps only move forward.
    avar[p].clear(); aelt[p] = [];
  }
  return perm;
}

/** Number of entries in the Cholesky factor of a graph under a given ordering (strictly lower part). */
export function fillCount(n: number, adj: number[][], perm: Int32Array): number {
  const inv = new Int32Array(n);
  for (let k = 0; k < n; k++) inv[perm[k]] = k;
  const parent = new Int32Array(n).fill(-1), flag = new Int32Array(n).fill(-1);
  let total = 0;
  for (let k = 0; k < n; k++) {
    flag[k] = k;
    for (const nb of adj[perm[k]]) {
      let i = inv[nb];
      if (i >= k) continue;
      for (; flag[i] !== k; i = parent[i]) { if (parent[i] === -1) parent[i] = k; total++; flag[i] = k; }
    }
  }
  return total;
}

// ---- LDL^T ----------------------------------------------------------------
export interface Factor {
  n: number;
  Lp: Int32Array; Li: Int32Array; Lx: Float64Array; D: Float64Array;
  /** Equations whose pivot was (numerically) zero; the matrix is singular if non-empty. */
  zeroPivots: number[];
  /** Number of negative pivots = number of negative eigenvalues (Sylvester's law of inertia). */
  negativePivots: number;
  nnzL: number;
  solve(b: Float64Array): Float64Array;
}

export interface FactorOptions {
  /** Relative pivot tolerance against the original diagonal. */
  tol?: number;
  /** If set, tiny pivots are replaced by this multiple of the diagonal instead of stopping (used to locate all mechanisms). */
  regularise?: boolean;
  cancelled?: () => boolean;
}

export function factorLDL(A: SymCSC, opt: FactorOptions = {}): Factor {
  const n = A.n, Ap = A.colPtr, Ai = A.rowIdx, Ax = A.val;
  const tol = opt.tol ?? 1e-12;
  // -- symbolic: elimination tree and column counts
  const Parent = new Int32Array(n).fill(-1), Flag = new Int32Array(n), Lnz = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    Flag[k] = k;
    for (let p = Ap[k]; p < Ap[k + 1]; p++) {
      let i = Ai[p];
      if (i < k) for (; Flag[i] !== k; i = Parent[i]) { if (Parent[i] === -1) Parent[i] = k; Lnz[i]++; Flag[i] = k; }
    }
  }
  const Lp = new Int32Array(n + 1);
  for (let k = 0; k < n; k++) Lp[k + 1] = Lp[k] + Lnz[k];
  const nnzL = Lp[n];
  const Li = new Int32Array(nnzL), Lx = new Float64Array(nnzL), D = new Float64Array(n);
  // -- numeric
  const Y = new Float64Array(n), Pattern = new Int32Array(n), diag0 = new Float64Array(n);
  const zeroPivots: number[] = [];
  let negativePivots = 0;
  Lnz.fill(0);
  for (let k = 0; k < n; k++) {
    if ((k & 2047) === 0 && opt.cancelled?.()) throw new Error('Analysis cancelled');
    // Non-zero pattern of row k of L, in topological order, from the elimination tree.
    let top = n;
    Flag[k] = k;
    for (let p = Ap[k]; p < Ap[k + 1]; p++) {
      let i = Ai[p];
      if (i > k) continue;
      Y[i] += Ax[p];
      if (i === k) diag0[k] = Ax[p];
      let len = 0;
      for (; Flag[i] !== k; i = Parent[i]) { Pattern[len++] = i; Flag[i] = k; }
      while (len > 0) Pattern[--top] = Pattern[--len];
    }
    let dk = Y[k]; Y[k] = 0;
    for (; top < n; top++) {
      const i = Pattern[top], yi = Y[i];
      Y[i] = 0;
      const p2 = Lp[i] + Lnz[i];
      for (let p = Lp[i]; p < p2; p++) Y[Li[p]] -= Lx[p] * yi;
      const lki = yi / D[i];
      dk -= lki * yi;
      Li[p2] = k; Lx[p2] = lki; Lnz[i]++;
    }
    const scale = Math.abs(diag0[k]);
    if (Math.abs(dk) <= tol * scale || scale === 0 || !Number.isFinite(dk)) {
      zeroPivots.push(k);
      // Keep going with a stiff artificial pivot so that every mechanism is found in one pass.
      dk = scale > 0 ? scale : 1;
      if (!opt.regularise && zeroPivots.length > 50) break;
    } else if (dk < 0) negativePivots++;
    D[k] = dk;
  }
  const solve = (b: Float64Array): Float64Array => {
    const x = Float64Array.from(b);
    for (let j = 0; j < n; j++) { const xj = x[j]; if (xj !== 0) for (let p = Lp[j]; p < Lp[j + 1]; p++) x[Li[p]] -= Lx[p] * xj; }
    for (let j = 0; j < n; j++) x[j] /= D[j];
    for (let j = n - 1; j >= 0; j--) { let s = x[j]; for (let p = Lp[j]; p < Lp[j + 1]; p++) s -= Lx[p] * x[Li[p]]; x[j] = s; }
    return x;
  };
  return { n, Lp, Li, Lx, D, zeroPivots, negativePivots, nnzL, solve };
}

// ---- small dense helpers (reduced eigenproblems, element matrices) --------------
/** Cyclic Jacobi eigen-decomposition of a dense symmetric matrix. Returns ascending eigenvalues and column eigenvectors. */
export function jacobiEigen(Ain: number[][]): { values: number[]; vectors: number[][] } {
  const n = Ain.length, A = Ain.map(r => [...r]);
  const V: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0, dia = 0;
    for (let i = 0; i < n; i++) { dia += A[i][i] * A[i][i]; for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j]; }
    if (off <= 1e-30 * (dia + 1e-300)) break;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++) { const apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++) { const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a][a] - A[b][b]);
  return { values: idx.map(i => A[i][i]), vectors: V.map(row => idx.map(i => row[i])) };
}
/** Dense Cholesky factor (lower) of an SPD matrix; throws if not positive definite. */
export function denseCholesky(A: number[][]): number[][] {
  const n = A.length, L = A.map(r => r.map(() => 0));
  for (let j = 0; j < n; j++) {
    let s = A[j][j];
    for (let k = 0; k < j; k++) s -= L[j][k] * L[j][k];
    if (!(s > 0)) throw new Error('Matrix is not positive definite');
    L[j][j] = Math.sqrt(s);
    for (let i = j + 1; i < n; i++) {
      let t = A[i][j];
      for (let k = 0; k < j; k++) t -= L[i][k] * L[j][k];
      L[i][j] = t / L[j][j];
    }
  }
  return L;
}
