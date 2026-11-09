// Time stats and time leaderboards, all from the solves table (server-timed solves only, so
// nothing a client claims can get in). Pure functions over the store; app.js only routes.
import { DIFFICULTIES } from '../shared/sudoku.js';

export const MIN_FOR_RANK = 5;        // solves before your median is compared with others
export const MIN_FOR_MEDIAN_BOARD = { all: 10, week: 5 };

// Nearest-rank percentile of ascending times: the time that p% of solves are at or under.
export function pct(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}
const medianOf = sorted => {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
};

// Monday 00:00 UTC of the week containing t.
export function weekStart(t) {
  const d = new Date(t), day = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
}

// Per user, ascending times since `since`.
function byUser(store, difficulty, since) {
  const m = new Map();
  for (const r of store.solvesSince(difficulty, since)) { if (!m.has(r.user_id)) m.set(r.user_id, []); m.get(r.user_id).push(r.time); }
  for (const a of m.values()) a.sort((x, y) => x - y);
  return m;
}

// One player's spread of times per difficulty, and where their median ranks among players.
export function timeStats(store, userId) {
  const out = {};
  for (const d of DIFFICULTIES) {
    const t = store.solveTimes(userId, d);
    if (!t.length) { out[d] = { count: 0 }; continue; }
    const s = { count: t.length, best: t[0], mean: Math.round(t.reduce((a, b) => a + b, 0) / t.length), median: medianOf(t),
      p25: pct(t, 25), p10: pct(t, 10), p5: pct(t, 5), fasterThan: null, of: 0 };
    if (t.length >= MIN_FOR_RANK) {
      const others = [...byUser(store, d, 0)].filter(([u, ts]) => u !== userId && ts.length >= MIN_FOR_RANK).map(([, ts]) => medianOf(ts));
      s.of = others.length + 1;
      s.fasterThan = others.length ? Math.round(100 * others.filter(m => m > s.median).length / others.length) : 100;
    }
    out[d] = s;
  }
  return out;
}

// Leaderboards: kind 'fastest' (best single solve) or 'median' (typical time, needs enough
// solves), period 'all' or 'week'.
export function timeBoard(store, difficulty, kind, period, now, limit = 50) {
  const since = period === 'week' ? weekStart(now) : 0;
  if (kind === 'fastest') return store.fastest(difficulty, since, limit).map(r => ({ userId: r.user_id, name: r.name, avatar: r.avatar, time: r.time }));
  const need = MIN_FOR_MEDIAN_BOARD[period];
  const rows = [...byUser(store, difficulty, since)].filter(([, t]) => t.length >= need)
    .map(([u, t]) => ({ userId: u, time: medianOf(t), solves: t.length }))
    .sort((a, b) => a.time - b.time || b.solves - a.solves).slice(0, limit);
  const users = new Map(store.usersById(rows.map(r => r.userId)).map(u => [u.id, u]));
  return rows.map(r => ({ ...r, name: users.get(r.userId)?.name, avatar: users.get(r.userId)?.avatar }));
}
