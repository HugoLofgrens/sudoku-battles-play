// One live 1v1 race. Pure logic: no sockets, no database, no timers. The caller passes `now`
// into every call and calls tick(now) a few times a second. Every rule lives here, so tests can
// drive a whole match with a fake clock. docs/SPEC.md explains each rule in words.

export const RULES = {
  countdownMs: 3000,        // both connected -> 3, 2, 1 -> go
  noShowMs: 20000,          // a player who never connects in this window aborts the match
  graceMs: 30000,           // a dropped player has this long to come back
  abortWindowMs: 20000,     // from the start, a player who has not tried a cell may abort
  capMs: { medium: 40 * 60e3, hard: 60 * 60e3, extreme: 90 * 60e3 },
  mistakeOptions: [1, 3, 5],
  rankedMistakes: 3,
  maxMoveRate: 15           // placements per second per player; more is dropped
};

export class Match {
  // players: [{key, userId|null, name, avatar, rating|null}] (index 0 and 1)
  constructor({ id, kind, difficulty, mistakes, seed, puzzle, solution, players, now, emit }) {
    if (!RULES.capMs[difficulty]) throw new Error('bad difficulty');
    if (!RULES.mistakeOptions.includes(mistakes)) throw new Error('bad mistakes');
    Object.assign(this, { id, kind, difficulty, mistakes, seed, puzzle, solution });
    this.emit = emit || (() => {});            // emit(playerIndex, message)
    this.createdAt = now;
    this.startAt = null;
    this.status = 'waiting';                    // waiting -> live -> decided -> closed, or aborted
    this.result = null;                         // {winner: 0|1|null, reason, at}
    this.toFill = puzzle.filter(x => !x).length;
    this.rematch = [false, false];
    this.p = players.map(info => ({
      info, connected: false, everConnected: false, droppedAt: null,
      board: puzzle.slice(), filled: 0, mistakes: 0, attempts: 0,
      done: null, doneAt: null,                 // done: solved | out | gaveup | disconnect | timeout
      moves: [], rateWindow: [0, 0]
    }));
  }

  get open() { return this.status !== 'closed' && this.status !== 'aborted'; }
  other(i) { return 1 - i; }
  time(i) { const p = this.p[i]; return p.done === 'solved' ? p.doneAt - this.startAt : null; }

  connect(i, now) {
    const p = this.p[i];
    p.connected = true; p.everConnected = true; p.droppedAt = null;
    if (this.status === 'waiting' && this.p.every(x => x.everConnected)) {
      this.status = 'live';
      this.startAt = now + RULES.countdownMs;
    }
    this.sync(now);
  }

  disconnect(i, now) {
    const p = this.p[i];
    if (!p.connected) return;
    p.connected = false; p.droppedAt = now;
    this.sync(now);
  }

  // Returns {ok, reason}. ok is true for a right digit, false for a wrong one (counted as a
  // mistake), and undefined when the move was refused without counting.
  place(i, cell, digit, now) {
    const p = this.p[i];
    if (this.status !== 'live' && this.status !== 'decided') return { reason: 'not-live' };
    if (now < this.startAt) return { reason: 'countdown' };
    if (p.done) return { reason: 'finished' };
    if (!Number.isInteger(cell) || cell < 0 || cell > 80) return { reason: 'bad-cell' };
    if (!Number.isInteger(digit) || digit < 1 || digit > 9) return { reason: 'bad-digit' };
    if (p.board[cell]) return { reason: 'filled' };
    const sec = Math.floor(now / 1000);
    if (p.rateWindow[0] !== sec) p.rateWindow = [sec, 0];
    if (++p.rateWindow[1] > RULES.maxMoveRate) return { reason: 'too-fast' };

    p.attempts++;
    const ok = this.solution[cell] === digit;
    p.moves.push([now - this.startAt, cell, digit, ok ? 1 : 0]);
    if (ok) {
      p.board[cell] = digit;
      p.filled++;
      if (p.filled === this.toFill) {
        p.done = 'solved'; p.doneAt = now;
        if (this.status === 'live') this.decide(i, 'solved', now);
      }
    } else {
      p.mistakes++;
      if (p.mistakes >= this.mistakes) {
        p.done = 'out'; p.doneAt = now;
        if (this.status === 'live') this.decide(this.other(i), 'mistakes', now);
      }
    }
    this.afterChange(now);
    return { ok };
  }

  // Before the result: give up = lose. After it: stop playing on.
  resign(i, now) {
    const p = this.p[i];
    if (p.done || (this.status !== 'live' && this.status !== 'decided')) return false;
    p.done = 'gaveup'; p.doneAt = now;
    if (this.status === 'live') this.decide(this.other(i), 'resign', now);
    this.afterChange(now);
    return true;
  }

  canAbort(i, now) {
    if (this.status === 'waiting') return true;
    return this.status === 'live' && this.p[i].attempts === 0 && now - this.startAt < RULES.abortWindowMs;
  }

  abort(i, now, reason = 'aborted') {
    if (!this.canAbort(i, now)) return false;
    this.status = 'aborted';
    this.result = { winner: null, reason, at: now, by: i };
    this.sync(now);
    return true;
  }

  tick(now) {
    if (this.status === 'waiting') {
      if (now - this.createdAt >= RULES.noShowMs) {
        this.status = 'aborted';
        this.result = { winner: null, reason: 'no-show', at: now };
        this.sync(now);
      }
      return;
    }
    if (!this.open) return;
    const cap = this.startAt + RULES.capMs[this.difficulty];
    if (now >= cap) {
      if (this.status === 'live') {
        const [a, b] = this.p.map(x => x.filled);
        this.decide(a === b ? null : a > b ? 0 : 1, 'timeout', now);
      }
      for (const p of this.p) if (!p.done) { p.done = 'timeout'; p.doneAt = now; }
      this.afterChange(now);
      return;
    }
    let changed = false;
    this.p.forEach((p, i) => {
      if (changed === 'abort' || p.connected || p.droppedAt === null || p.done || now - p.droppedAt < RULES.graceMs) return;
      if (this.status === 'live' && p.attempts === 0 && p.droppedAt - this.startAt < RULES.abortWindowMs) {
        this.status = 'aborted';
        this.result = { winner: null, reason: 'left-early', at: now, by: i };
        changed = 'abort';
        return;
      }
      p.done = 'disconnect'; p.doneAt = now;
      if (this.status === 'live') this.decide(this.other(i), 'disconnect', now);
      changed = true;
    });
    if (changed === 'abort') this.sync(now);
    else if (changed) this.afterChange(now);
  }

  decide(winner, reason, now) {
    this.status = 'decided';
    this.result = { winner, reason, at: now };
    if (this.onDecided) this.onDecided(this);
  }

  afterChange(now) {
    if (this.status === 'decided' && this.p.every(p => p.done)) {
      this.status = 'closed';
      if (this.onClosed) this.onClosed(this);
    }
    this.sync(now);
  }

  // What player i may see. Never the solution, never the opponent's board.
  view(i, now) {
    const me = this.p[i], op = this.p[this.other(i)];
    return {
      t: 'game', id: this.id, kind: this.kind, difficulty: this.difficulty, mistakesAllowed: this.mistakes,
      status: this.status, puzzle: this.puzzle, board: me.board, toFill: this.toFill,
      startAt: this.startAt, serverNow: now, capAt: this.startAt && this.startAt + RULES.capMs[this.difficulty],
      canAbort: this.canAbort(i, now),
      you: { index: i, ...this.publicInfo(me), filled: me.filled, mistakes: me.mistakes, done: me.done, time: this.time(i) },
      opp: { ...this.publicInfo(op), filled: op.filled, mistakes: op.mistakes, done: op.done, time: this.time(this.other(i)), connected: op.connected },
      result: this.result && { ...this.result, you: this.result.winner === null ? 'draw' : this.result.winner === i ? 'win' : 'loss' },
      ratingChange: this.ratingChange ? this.ratingChange[i] : null,
      rematch: { you: this.rematch[i], opp: this.rematch[this.other(i)] },
      // For the replay chart once the result is in: [ms from go, 1 right / 0 mistake] per move.
      timeline: this.result && this.status !== 'aborted' ? { you: me.moves.map(m => [m[0], m[3]]), opp: op.moves.map(m => [m[0], m[3]]) } : null
    };
  }
  publicInfo(p) { return { name: p.info.name, avatar: p.info.avatar, rating: p.info.rating, guest: !p.info.userId }; }

  sync(now) { for (const i of [0, 1]) this.emit(i, this.view(i, now)); }
}
