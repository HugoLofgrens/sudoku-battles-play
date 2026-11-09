import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rate, rateGame, idle, START, RD_MAX, RD_MIN, IDLE_PERIOD_MS } from '../server/glicko2.js';

test('matches the worked example in Glickman 2013', () => {
  const p = rate({ rating: 1500, rd: 200, vol: 0.06 }, [
    { rating: 1400, rd: 30, score: 1 },
    { rating: 1550, rd: 100, score: 0 },
    { rating: 1700, rd: 300, score: 0 }
  ], { clampRd: false });
  assert.ok(Math.abs(p.rating - 1464.06) < 0.01, 'rating ' + p.rating);
  assert.ok(Math.abs(p.rd - 151.52) < 0.01, 'rd ' + p.rd);
  assert.ok(Math.abs(p.vol - 0.05999) < 0.00001, 'vol ' + p.vol);
});

test('one game is zero-sum in direction and symmetric for equal players', () => {
  const [a, b] = rateGame(START, START, 1);
  assert.ok(a.rating > 1500 && b.rating < 1500);
  assert.ok(Math.abs((a.rating - 1500) + (b.rating - 1500)) < 1e-9);
  const [c, d] = rateGame(START, START, 0.5);
  assert.ok(Math.abs(c.rating - 1500) < 1e-9 && Math.abs(d.rating - 1500) < 1e-9);
});

test('beating a much weaker established player gains little', () => {
  const strong = { rating: 1900, rd: 60, vol: 0.06 }, weak = { rating: 1300, rd: 60, vol: 0.06 };
  const [s] = rateGame(strong, weak, 1);
  assert.ok(s.rating - 1900 < 2, 'gain ' + (s.rating - 1900));
  const [, w] = rateGame(strong, weak, 0);
  assert.ok(w.rating - 1300 > 5, 'upset gain ' + (w.rating - 1300));
});

test('RD stays inside its bounds and grows when idle', () => {
  let p = START;
  for (let i = 0; i < 300; i++) p = rateGame(p, START, i % 2)[0];
  assert.ok(p.rd >= RD_MIN && p.rd <= RD_MAX);
  const later = idle(p, 52 * IDLE_PERIOD_MS);
  assert.ok(later.rd > p.rd && later.rd <= RD_MAX);
  assert.equal(idle(p, IDLE_PERIOD_MS - 1).rd, p.rd);
});

test('ratings stay finite for extreme inputs', () => {
  for (const s of [0, 0.5, 1]) {
    const [a, b] = rateGame({ rating: 3000, rd: 45, vol: 0.06 }, { rating: 100, rd: 350, vol: 0.2 }, s);
    for (const x of [a.rating, a.rd, a.vol, b.rating, b.rd, b.vol]) assert.ok(Number.isFinite(x));
  }
});
