import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Match, RULES } from '../server/match.js';
import { generate } from '../shared/sudoku.js';

const P = generate(12345, 'easy');
function make(opts = {}) {
  const sent = [[], []];
  const m = new Match({
    id: 'g1', kind: 'ranked', difficulty: 'easy', mistakes: 3, seed: P.seed, puzzle: P.puzzle, solution: P.solution,
    players: [{ key: 'a', userId: 1, name: 'A' }, { key: 'b', userId: 2, name: 'B' }], now: 0,
    emit: (i, msg) => sent[i].push(msg), ...opts
  });
  m.sent = sent;
  return m;
}
const empties = IDXS => IDXS.filter(i => !P.puzzle[i]);
const EMPTY = empties([...Array(81).keys()]);
const wrongDigit = c => (P.solution[c] % 9) + 1;
function start(m) { m.connect(0, 0); m.connect(1, 0); return RULES.countdownMs; }
// One move per 100ms so the rate limit never trips.
function solveAll(m, i, t) { for (const c of EMPTY) { t += 100; m.place(i, c, P.solution[c], t); } return t; }

test('starts with a countdown once both connect, and refuses moves before go', () => {
  const m = make();
  m.connect(0, 0);
  assert.equal(m.status, 'waiting');
  m.connect(1, 500);
  assert.equal(m.status, 'live');
  assert.equal(m.startAt, 500 + RULES.countdownMs);
  assert.equal(m.place(0, EMPTY[0], P.solution[EMPTY[0]], 600).reason, 'countdown');
});

test('first to fill the grid wins; the other may keep going until they stop', () => {
  const m = make();
  let decided = 0, closed = 0;
  m.onDecided = () => decided++; m.onClosed = () => closed++;
  const t = solveAll(m, 0, start(m));
  assert.equal(m.status, 'decided');
  assert.deepEqual([m.result.winner, m.result.reason], [0, 'solved']);
  assert.equal(m.time(0), t - RULES.countdownMs);
  assert.equal(m.place(1, EMPTY[0], P.solution[EMPTY[0]], t + 100).ok, true);   // keeps going
  const t2 = solveAll(m, 1, t + 100 - 100 + 100);
  assert.equal(m.status, 'closed');
  assert.equal(m.result.winner, 0, 'finishing later does not change the result');
  assert.ok(m.time(1) > 0);
  assert.equal(decided, 1); assert.equal(closed, 1);
  assert.ok(t2 > t);
});

test('wrong digits count as mistakes and are not placed; the limit knocks you out', () => {
  const m = make();
  let t = start(m);
  const c = EMPTY[0];
  assert.equal(m.place(0, c, wrongDigit(c), ++t).ok, false);
  assert.equal(m.p[0].board[c], 0);
  m.place(0, c, wrongDigit(c), ++t);
  assert.equal(m.status, 'live');
  m.place(0, c, wrongDigit(c), ++t);
  assert.equal(m.p[0].done, 'out');
  assert.deepEqual([m.status, m.result.winner, m.result.reason], ['decided', 1, 'mistakes']);
  assert.equal(m.place(0, c, P.solution[c], ++t).reason, 'finished');
});

test('refuses givens, filled cells, bad input, and floods', () => {
  const m = make();
  let t = start(m) + 1;
  const given = P.puzzle.findIndex(Boolean);
  assert.equal(m.place(0, given, 5, t).reason, 'filled');
  assert.equal(m.place(0, 81, 5, t).reason, 'bad-cell');
  assert.equal(m.place(0, EMPTY[0], 0, t).reason, 'bad-digit');
  assert.equal(m.place(0, '3', 5, t).reason, 'bad-cell');
  m.place(0, EMPTY[0], P.solution[EMPTY[0]], t);
  assert.equal(m.place(0, EMPTY[0], P.solution[EMPTY[0]], t).reason, 'filled');
  let refused = 0;
  for (let k = 0; k < 40; k++) if (m.place(1, EMPTY[k], P.solution[EMPTY[k]], t).reason === 'too-fast') refused++;
  assert.ok(refused > 0);
});

test('resign loses before the result and only stops play after it', () => {
  const m = make();
  const t = start(m);
  m.place(1, EMPTY[0], P.solution[EMPTY[0]], t + 1);
  m.resign(0, t + 2);
  assert.deepEqual([m.result.winner, m.result.reason], [1, 'resign']);
  assert.equal(m.status, 'decided');
  m.resign(1, t + 3);
  assert.equal(m.status, 'closed');
  assert.equal(m.result.winner, 1);
});

test('abort only early and only before trying a cell', () => {
  const m = make();
  const t = start(m);
  assert.equal(m.canAbort(0, t + 1000), true);
  m.place(0, EMPTY[0], P.solution[EMPTY[0]], t + 1000);
  assert.equal(m.abort(0, t + 1001), false);
  assert.equal(m.canAbort(1, t + RULES.abortWindowMs), false);
  assert.equal(m.abort(1, t + 1002), true);
  assert.equal(m.status, 'aborted');
});

test('no-show aborts', () => {
  const m = make();
  m.connect(0, 0);
  m.tick(RULES.noShowMs - 1);
  assert.equal(m.status, 'waiting');
  m.tick(RULES.noShowMs);
  assert.deepEqual([m.status, m.result.reason], ['aborted', 'no-show']);
});

test('a drop has a grace period; reconnecting in time keeps the game', () => {
  const m = make();
  const t = start(m);
  m.place(0, EMPTY[0], P.solution[EMPTY[0]], t + 1);
  m.disconnect(0, t + 5000);
  m.tick(t + 5000 + RULES.graceMs - 1);
  assert.equal(m.status, 'live');
  m.connect(0, t + 5000 + RULES.graceMs - 1);
  m.tick(t + 5000 + RULES.graceMs + 10);
  assert.equal(m.status, 'live');
  m.disconnect(0, t + 60000);
  m.tick(t + 60000 + RULES.graceMs);
  assert.deepEqual([m.status, m.result.winner, m.result.reason], ['decided', 1, 'disconnect']);
});

test('leaving right away without trying a cell aborts instead of losing', () => {
  const m = make();
  const t = start(m);
  m.disconnect(1, t + 2000);
  m.tick(t + 2000 + RULES.graceMs);
  assert.deepEqual([m.status, m.result.reason], ['aborted', 'left-early']);
});

test('the time cap decides by progress, equal progress is a draw', () => {
  const m = make();
  const t = start(m);
  m.place(0, EMPTY[0], P.solution[EMPTY[0]], t + 1);
  m.tick(t + RULES.capMs.easy);
  assert.deepEqual([m.status, m.result.winner, m.result.reason], ['closed', 0, 'timeout']);
  const d = make();
  const t2 = start(d);
  d.tick(t2 + RULES.capMs.easy);
  assert.equal(d.result.winner, null);
});

test('views never leak the solution or the opponent board', () => {
  const m = make();
  const t = start(m);
  m.place(1, EMPTY[0], P.solution[EMPTY[0]], t + 1);
  const v = m.view(0, t + 2);
  const json = JSON.stringify(v);
  assert.ok(!json.includes('solution'));
  assert.equal(v.board[EMPTY[0]], 0);
  assert.equal(v.opp.filled, 1);
  assert.equal(v.you.index, 0);
});
