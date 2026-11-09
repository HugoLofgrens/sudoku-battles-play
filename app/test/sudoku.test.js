import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, grade, solve, DIFFICULTIES } from '../shared/sudoku.js';

test('the tiers are medium, hard and extreme', () => {
  assert.deepEqual(DIFFICULTIES, ['medium', 'hard', 'extreme']);
  assert.throws(() => generate(1, 'easy'));
});

test('one seed always gives the same puzzle', () => {
  for (const d of DIFFICULTIES) assert.deepEqual(generate(42, d).puzzle, generate(42, d).puzzle);
});

test('every puzzle has exactly one solution and the grader reaches it without a wrong step', () => {
  for (const d of DIFFICULTIES) for (let s = 1; s <= 25; s++) {
    const p = generate(s * 7919, d);
    assert.equal(solve(p.puzzle, 2, null, 1e6).count, 1, `${d} seed ${s} unique`);
    const r = grade(p.puzzle);
    assert.ok(r.solved);
    assert.deepEqual(r.grid, p.solution, `${d} seed ${s}: grader made a wrong deduction`);
  }
});

test('extreme needs swordfish or XY-wing; hard and medium never do', () => {
  for (let s = 1; s <= 25; s++) {
    assert.ok(grade(generate(s, 'extreme').puzzle).level >= 6);
    assert.ok(grade(generate(s, 'hard').puzzle).level <= 5);
    assert.ok(grade(generate(s, 'medium').puzzle).level <= 3);
  }
});
