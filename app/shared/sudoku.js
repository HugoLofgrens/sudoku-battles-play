// Sudoku core shared by server and clients. Pure, deterministic: (seed, difficulty) always gives the same puzzle.
// Moved from the hosted prototype (index.html) without changing the algorithm.
const ALL = 0x3FE, IDX = [...Array(81).keys()];
const rowOf = i => i / 9 | 0, colOf = i => i % 9, boxOf = i => (rowOf(i) / 3 | 0) * 3 + (colOf(i) / 3 | 0);
const HOUSES = [];
for (let k = 0; k < 9; k++) HOUSES.push(IDX.filter(i => rowOf(i) === k));
for (let k = 0; k < 9; k++) HOUSES.push(IDX.filter(i => colOf(i) === k));
for (let k = 0; k < 9; k++) HOUSES.push(IDX.filter(i => boxOf(i) === k));
const PEERS = IDX.map(i => IDX.filter(j => j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))));
const pop = m => { let n = 0; while (m) { m &= m - 1; n++; } return n; };
// sfc32: integer-only, so one seed gives one puzzle on every device and in any language.
function makeRng(seed) {
  let a = 0x9E3779B9, b = 0x243F6A88, c = 0xB7E15162, d = seed >>> 0;
  const next = () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 15; i++) next();
  return next;
}
const shuffle = (a, rng) => { for (let i = a.length - 1; i > 0; i--) { const j = rng() % (i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const combos = (a, k, s = 0, cur = [], out = []) => {
  if (cur.length === k) { out.push(cur.slice()); return out; }
  for (let i = s; i < a.length; i++) { cur.push(a[i]); combos(a, k, i + 1, cur, out); cur.pop(); }
  return out;
};

// ---------- brute-force solver (uniqueness + grid fill) ----------
// Gives up after maxNodes and returns count -1. A step limit, not a clock, so every device agrees.
const NODE_LIMIT = 20000;
function solve(grid, limit = 2, rng = null, maxNodes = NODE_LIMIT) {
  const g = grid.slice(), R = Array(9).fill(0), C = Array(9).fill(0), B = Array(9).fill(0), empties = [];
  for (const i of IDX) {
    if (g[i]) { const b = 1 << g[i]; R[rowOf(i)] |= b; C[colOf(i)] |= b; B[boxOf(i)] |= b; } else empties.push(i);
  }
  let count = 0, first = null, nodes = 0, aborted = false;
  (function rec() {
    if (++nodes > maxNodes) { aborted = true; return; }
    let best = -1, bestM = 0, bestN = 10;
    for (const i of empties) {
      if (g[i]) continue;
      const m = ALL & ~(R[rowOf(i)] | C[colOf(i)] | B[boxOf(i)]), n = pop(m);
      if (n < bestN) { best = i; bestM = m; bestN = n; if (n <= 1) break; }
    }
    if (best < 0) { count++; if (!first) first = g.slice(); return; }
    const ds = []; for (let d = 1; d <= 9; d++) if (bestM >> d & 1) ds.push(d);
    if (rng) shuffle(ds, rng);
    const r = rowOf(best), c = colOf(best), x = boxOf(best);
    for (const d of ds) {
      const b = 1 << d;
      g[best] = d; R[r] |= b; C[c] |= b; B[x] |= b;
      rec();
      g[best] = 0; R[r] &= ~b; C[c] &= ~b; B[x] &= ~b;
      if (count >= limit || aborted) return;
    }
  })();
  return { count: aborted ? -1 : count, first };
}

// ---------- human-technique grader: rejects easy puzzles and ones that need guessing ----------
function grade(p) {
  const g = p.slice(), c = Array(81).fill(0);
  for (const i of IDX) if (!g[i]) { let m = ALL; for (const j of PEERS[i]) if (g[j]) m &= ~(1 << g[j]); c[i] = m; }
  const put = (i, d) => { g[i] = d; c[i] = 0; for (const j of PEERS[i]) c[j] &= ~(1 << d); };
  const strip = (cells, mask) => { let ch = false; for (const i of cells) if (c[i] & mask) { c[i] &= ~mask; ch = true; } return ch; };

  function singles() {
    for (const i of IDX) if (pop(c[i]) === 1) { put(i, 31 - Math.clz32(c[i])); return true; }
    for (const h of HOUSES) for (let d = 1; d <= 9; d++) {
      const s = h.filter(i => c[i] >> d & 1);
      if (s.length === 1) { put(s[0], d); return true; }
    }
    return false;
  }
  function locked() {
    for (const h of HOUSES) for (let d = 1; d <= 9; d++) {
      const s = h.filter(i => c[i] >> d & 1);
      if (s.length < 2) continue;
      for (const o of HOUSES) {
        if (o === h || !s.every(i => o.includes(i))) continue;
        if (strip(o.filter(i => !s.includes(i)), 1 << d)) return true;
      }
    }
    return false;
  }
  function subsets(k) {
    for (const h of HOUSES) {
      const open = h.filter(i => c[i]);
      if (open.length <= k) continue;
      for (const set of combos(open, k)) {            // naked
        const u = set.reduce((m, i) => m | c[i], 0);
        if (pop(u) === k && strip(open.filter(i => !set.includes(i)), u)) return true;
      }
      const digits = []; for (let d = 1; d <= 9; d++) if (open.some(i => c[i] >> d & 1)) digits.push(d);
      for (const set of combos(digits, k)) {          // hidden
        const mask = set.reduce((m, d) => m | 1 << d, 0), cells = open.filter(i => c[i] & mask);
        if (cells.length === k && set.every(d => cells.some(i => c[i] >> d & 1)) && strip(cells, ALL & ~mask)) return true;
      }
    }
    return false;
  }
  function xwing() {
    for (const [from, to] of [[0, 9], [9, 0]]) for (let d = 1; d <= 9; d++) {
      const pos = [];
      for (let k = 0; k < 9; k++) { const p = []; HOUSES[from + k].forEach((i, n) => { if (c[i] >> d & 1) p.push(n); }); pos.push(p); }
      for (let a = 0; a < 9; a++) if (pos[a].length === 2) for (let b = a + 1; b < 9; b++) {
        if (pos[b].length !== 2 || pos[b][0] !== pos[a][0] || pos[b][1] !== pos[a][1]) continue;
        const skip = new Set([...HOUSES[from + a], ...HOUSES[from + b]]);
        let ch = false;
        for (const n of pos[a]) ch = strip(HOUSES[to + n].filter(i => !skip.has(i)), 1 << d) || ch;
        if (ch) return true;
      }
    }
    return false;
  }

  let level = 0, hard = 0;
  const steps = [[singles, 1], [locked, 2], [() => subsets(2), 3], [() => subsets(3), 4], [xwing, 5]];
  for (;;) {
    if (g.every(Boolean)) return { solved: true, level, hard };
    let moved = false;
    for (const [fn, lv] of steps) if (fn()) { level = Math.max(level, lv); if (lv >= 3) hard++; moved = true; break; }
    if (!moved) return { solved: false, level, hard };
  }
}

// ---------- generator ----------
function dig(rng, minClues = 0) {
  let sol = null;
  while (!sol) sol = solve(Array(81).fill(0), 1, rng).first;
  const g = sol.slice();
  for (const i of shuffle(IDX.filter(i => i <= 40), rng)) {
    if (g.filter(Boolean).length <= minClues) break;
    const j = 80 - i, a = g[i], b = g[j];
    g[i] = g[j] = 0;
    if (solve(g, 2).count !== 1) { g[i] = a; g[j] = b; }
  }
  return { puzzle: g, solution: sol };
}
// Bump when anything above changes: the same seed then gives a different puzzle.
// Bump when anything above changes: the same seed then gives a different puzzle.
export const GENERATOR_VERSION = 1;
const MIN_HARD = 3;

// Difficulty tiers. Each test only looks at the puzzle, so a seed maps to one puzzle per tier.
//   easy:   at least 36 clues, needs nothing past locked candidates (the old battle puzzles)
//   medium: fully dug, needs locked candidates or naked/hidden pairs, nothing harder
//   hard:   needs triples or X-wing, or 3+ pair-level steps (the old solo puzzles)
export const DIFFICULTIES = ['easy', 'medium', 'hard'];
const TIERS = {
  easy:   { minClues: 36, ok: r => r.solved && r.level <= 2 },
  medium: { minClues: 0,  ok: r => r.solved && r.level >= 2 && r.level <= 3 && r.hard < MIN_HARD },
  hard:   { minClues: 0,  ok: r => r.solved && (r.level >= 4 || r.hard >= MIN_HARD) }
};

export function generate(seed, difficulty) {
  const tier = TIERS[difficulty];
  if (!tier) throw new Error('unknown difficulty ' + difficulty);
  const rng = makeRng(seed >>> 0);
  for (;;) {
    const d = dig(rng, tier.minClues);
    if (tier.ok(grade(d.puzzle))) return { seed: seed >>> 0, difficulty, version: GENERATOR_VERSION, puzzle: d.puzzle, solution: d.solution };
  }
}

export { IDX, HOUSES, PEERS, rowOf, colOf, boxOf, makeRng, solve, grade };
