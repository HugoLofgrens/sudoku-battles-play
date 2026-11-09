import { test } from 'node:test';
import assert from 'node:assert/strict';
import { margin, gainFor, shown, MAX_GAIN, SHOWN_MAX } from '../server/rating.js';
import { rateGame, START, CENTER, SCALE } from '../server/glicko2.js';
import { tierOf } from '../shared/tiers.js';
import { openDb } from '../server/db.js';

test('everyone starts at 500; the curve tops out at 10,000 and never goes below 1', () => {
  assert.equal(shown(START.rating), 500);
  assert.equal(shown(CENTER + SCALE * 20), SHOWN_MAX);
  assert.equal(shown(CENTER - SCALE * 50), 1);
  assert.ok(shown(CENTER + SCALE) > shown(CENTER) && shown(CENTER) > shown(CENTER - SCALE));
});

test('margin: loser progress for solves, full for forfeits, none for draws', () => {
  assert.equal(margin({ winner: 0, reason: 'solved' }, [50, 25], 50), 0.5);
  assert.equal(margin({ winner: 1, reason: 'solved' }, [49, 50], 50), 1 - 49 / 50);
  for (const reason of ['mistakes', 'resign', 'disconnect']) assert.equal(margin({ winner: 0, reason }, [5, 40], 50), 1);
  assert.equal(margin({ winner: 0, reason: 'timeout' }, [30, 20], 50), 0.2);
  assert.equal(margin({ winner: null, reason: 'timeout' }, [20, 20], 50), 0);
});

test('a blowout moves ratings further than a photo finish, never past double', () => {
  const est = { rating: 1500, rd: 60, vol: 0.06 };
  const [close] = rateGame(est, est, 1, gainFor(0.02, 1500, 1500));
  const [blow] = rateGame(est, est, 1, gainFor(1, 1500, 1500));
  const [plain] = rateGame(est, est, 1, 1);
  assert.ok(blow.rating - 1500 > close.rating - 1500);
  assert.ok(Math.abs((blow.rating - 1500) / (plain.rating - 1500) - MAX_GAIN) < 1e-9);
  assert.ok(close.rating > 1500, 'a win always gains');
});

test('a favourite crushing a much weaker player gets a damped bonus', () => {
  assert.ok(gainFor(1, 2300, 1300) < gainFor(1, 1300, 2300));
  assert.equal(gainFor(1, 1300, 2300), MAX_GAIN);
  assert.ok(gainFor(1, 2300, 1300) > 1);
});

test('tiers follow the shown rating; placement while provisional', () => {
  assert.equal(tierOf(500, true).name, 'Placement');
  assert.equal(tierOf(500).name, 'Silver');
  assert.equal(tierOf(10000).name, 'Grandmaster');
  assert.equal(tierOf(100).name, 'Bronze');
});

test('simulated ladder: ratings sort players by skill, the average stays put', () => {
  // 120 players with hidden skill; equal-ish ratings are paired; the faster player usually wins
  // and wins bigger when the skill gap is bigger.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const players = Array.from({ length: 120 }, (_, i) => ({ skill: (i - 60) / 20, r: { ...START } }));
  for (let round = 0; round < 150; round++) {
    const order = players.slice().sort((a, b) => a.r.rating - b.r.rating + (rnd() - 0.5) * 200);
    for (let k = 0; k + 1 < order.length; k += 2) {
      const a = order[k], b = order[k + 1];
      const pA = 1 / (1 + Math.exp(-(a.skill - b.skill) * 1.5));
      const aWins = rnd() < pA;
      const d = Math.min(1, Math.abs(a.skill - b.skill) / 3 + rnd() * 0.3);
      const w = aWins ? a : b, l = aWins ? b : a;
      const [nw, nl] = rateGame(w.r, l.r, 1, gainFor(d, w.r.rating, l.r.rating));
      w.r = nw; l.r = nl;
    }
  }
  const ratings = players.map(p => p.r.rating);
  for (const r of ratings) assert.ok(Number.isFinite(r));
  const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
  assert.ok(Math.abs(mean - CENTER) < 40, 'no inflation: mean ' + mean);
  // Spearman rank correlation between hidden skill and rating.
  const rank = a => { const s = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = []; s.forEach(([, i], k) => (r[i] = k)); return r; };
  const rs = rank(players.map(p => p.skill)), rr = rank(ratings), n = players.length;
  const rho = 1 - 6 * rs.reduce((acc, v, i) => acc + (v - rr[i]) ** 2, 0) / (n * (n * n - 1));
  assert.ok(rho > 0.95, 'skill and rating agree: ' + rho.toFixed(3));
});

test('migrations: a fresh database reaches the latest version and old sessions expire', () => {
  const s = openDb(':memory:');
  assert.equal(s.db.prepare('PRAGMA user_version').get().user_version, 3);
  const id = s.addUser('olduser', 'x', {}, 0);
  s.addSession('h', id, 0);
  assert.ok(s.session('h', 1000));
  assert.equal(s.session('h', 91 * 24 * 3600e3), null);
});
