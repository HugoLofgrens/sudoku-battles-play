// The daily puzzle: one puzzle for everyone per UTC day. Accounts get one server-timed attempt
// that counts for the daily board; guests can play it too, off the board. The solution never
// leaves the server, the clock starts when the run starts and keeps running if you leave.
import { generate } from '../shared/sudoku.js';

export const DAILY_RULES = { mistakes: 3, capMs: 90 * 60e3, maxMoveRate: 15 };
// Monday..Sunday: harder toward the weekend.
const BY_WEEKDAY = ['medium', 'medium', 'hard', 'hard', 'hard', 'extreme', 'extreme'];
const EPOCH = Date.UTC(2026, 10, 9);          // daily #1

export const dayKey = t => new Date(t).toISOString().slice(0, 10);
export const dayNumber = day => Math.floor((Date.parse(day) - EPOCH) / 86400e3) + 1;
export const difficultyOf = day => BY_WEEKDAY[(new Date(day).getUTCDay() + 6) % 7];
// FNV-1a: a stable 32-bit seed from the date, the same on every server.
export function seedOf(day) {
  let h = 0x811c9dc5;
  for (const ch of 'daily:' + day) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}

const cache = new Map();
export function puzzleOf(day) {
  if (!cache.has(day)) {
    if (cache.size > 3) cache.delete(cache.keys().next().value);
    cache.set(day, generate(seedOf(day), difficultyOf(day)));
  }
  return cache.get(day);
}

// One player's attempt. Same move rules as a race.
export class DailyRun {
  constructor(day, startedAt) {
    const p = puzzleOf(day);
    Object.assign(this, { day, difficulty: p.difficulty, puzzle: p.puzzle, solution: p.solution, startedAt });
    this.board = p.puzzle.slice(); this.toFill = p.puzzle.filter(x => !x).length;
    this.filled = 0; this.mistakes = 0; this.status = 'playing'; this.time = null; this.rateWindow = [0, 0];
  }
  tick(now) {
    if (this.status === 'playing' && now - this.startedAt >= DAILY_RULES.capMs) { this.status = 'timeout'; return true; }
    return false;
  }
  place(cell, digit, now) {
    if (this.tick(now) || this.status !== 'playing') return { reason: 'finished' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 80) return { reason: 'bad-cell' };
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return { reason: 'bad-digit' };
    if (this.board[cell]) return { reason: 'filled' };
    const sec = Math.floor(now / 1000);
    if (this.rateWindow[0] !== sec) this.rateWindow = [sec, 0];
    if (++this.rateWindow[1] > DAILY_RULES.maxMoveRate) return { reason: 'too-fast' };
    if (this.solution[cell] !== digit) {
      if (++this.mistakes >= DAILY_RULES.mistakes) this.status = 'out';
      return { ok: false };
    }
    this.board[cell] = digit;
    if (++this.filled === this.toFill) { this.status = 'solved'; this.time = now - this.startedAt; }
    return { ok: true };
  }
  giveUp() { if (this.status === 'playing') this.status = 'gaveup'; }
  view(now) {
    return { t: 'daily', day: this.day, number: dayNumber(this.day), difficulty: this.difficulty, puzzle: this.puzzle,
      board: this.board, toFill: this.toFill, filled: this.filled, mistakes: this.mistakes, mistakesAllowed: DAILY_RULES.mistakes,
      status: this.status, time: this.time, startedAt: this.startedAt, serverNow: now, capAt: this.startedAt + DAILY_RULES.capMs };
  }
}
