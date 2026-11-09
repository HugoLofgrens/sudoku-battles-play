// The 9x9 board, number pad and keyboard. Same input as the prototype: tap a cell then a number,
// or pick a number first and tap cells. In a race the board only shows what the server confirmed.
import { IDX, PEERS, HOUSES, rowOf, colOf } from '/shared/sudoku.js';

// 1 = next to the pressed cell ... 4 = far end of its row or column.
const fade = (a, b) => { const d = Math.max(Math.abs(rowOf(a) - rowOf(b)), Math.abs(colOf(a) - colOf(b))); return d <= 1 ? 1 : d === 2 ? 2 : d <= 4 ? 3 : 4; };

export class Board {
  // onFx({type: 'ok'|'bad'|'note'|'house', cell, cells}) drives sound, haptics and animation.
  constructor(boardEl, padEl, { onPlace, onChange = () => {}, onFx = () => {} }) {
    this.el = boardEl; this.padEl = padEl;
    this.onPlace = onPlace; this.onChange = onChange; this.onFx = onFx;
    this.given = Array(81).fill(0); this.v = Array(81).fill(0); this.n = Array(81).fill(0);
    this.sel = null; this.active = null; this.hover = null; this.noteMode = false;
    this.locked = true; this.free = false; this.flash = -1; this.pending = new Map();
    boardEl.classList.add('locked');
    this.undoStack = [];
    this.cells = IDX.map(i => {
      const e = document.createElement('div');
      e.className = 'c';
      e.addEventListener('click', () => this.clickCell(i));
      boardEl.append(e);
      return e;
    });
    this.pad = [];
    for (let d = 1; d <= 9; d++) {
      const b = document.createElement('button');
      b.innerHTML = d + '<small></small>';
      b.addEventListener('click', e => this.digit(d, e.shiftKey));
      if (matchMedia('(hover:hover)').matches) {
        b.addEventListener('mouseenter', () => { this.hover = d; this.render(); });
        b.addEventListener('mouseleave', () => { this.hover = null; this.render(); });
      }
      padEl.append(b);
      this.pad[d] = b;
    }
  }

  // free = solo rules: any digit goes in, conflicts show red, undo works.
  load(puzzle, board, { free = false, notes = null } = {}) {
    this.given = puzzle.slice(); this.v = board.slice(); this.n = notes ? notes.slice() : Array(81).fill(0);
    this.sel = this.active = this.hover = null; this.noteMode = false; this.free = free;
    this.undoStack = []; this.pending.clear(); this.flash = -1;
    this.render();
  }
  // Server-confirmed board for a race.
  sync(board) {
    for (const i of IDX) if (board[i] && !this.v[i]) this.clearNotesFor(i, board[i]);
    this.v = board.slice();
    this.render();
  }
  clearNotesFor(i, d) { this.n[i] = 0; for (const j of PEERS[i]) this.n[j] &= ~(1 << d); }
  snap() { this.undoStack.push({ v: this.v.slice(), n: this.n.slice() }); }

  place(i, d) {
    if (this.free) {
      this.snap(); this.v[i] = d; this.clearNotesFor(i, d); this.celebrate(i);
      this.sel = null; this.active = d; this.onChange(); this.onPlace(i, d);
      return;
    }
    if (this.pending.has(i)) return;
    this.pending.set(i, d);
    this.active = d;
    this.onPlace(i, d);
  }
  // Server answer for a race move.
  placed(i, d, ok) {
    this.pending.delete(i);
    if (ok) { this.v[i] = d; this.clearNotesFor(i, d); if (this.sel === i) this.sel = null; this.celebrate(i); }
    else if (ok === false) { this.onFx({ type: 'bad', cell: i }); this.flash = i; clearTimeout(this.flashTimer); this.flashTimer = setTimeout(() => { this.flash = -1; this.render(); }, 700); }
    this.render();
  }
  toggleNote(i, d) { if (this.free) this.snap(); this.n[i] ^= 1 << d; this.active = d; this.onChange(); this.onFx({ type: 'note', cell: i }); }
  // A placed digit: pop, and a sweep for every row, column or box it finished.
  celebrate(i) {
    const done = HOUSES.filter(h => h.includes(i) && h.every(j => this.v[j]));
    this.onFx({ type: 'ok', cell: i });
    if (done.length) this.onFx({ type: 'house', cell: i, cells: [...new Set(done.flat())] });
  }

  digit(d, forceNote) {
    if (this.locked) return;
    if (this.sel !== null && !this.v[this.sel]) {
      if (this.noteMode || forceNote) this.toggleNote(this.sel, d); else this.place(this.sel, d);
    } else {
      this.active = this.sel === null && this.active === d ? null : d;
      this.sel = null;
    }
    this.render();
  }
  clickCell(i) {
    if (this.locked) return;
    if (this.v[i]) { this.sel = i; this.active = this.v[i]; }
    else if (this.sel === i && this.active) { if (this.noteMode) this.toggleNote(i, this.active); else this.place(i, this.active); }
    else this.sel = i;
    this.render();
  }
  erase() {
    const i = this.sel;
    if (this.locked || i === null || this.given[i]) return;
    if (this.v[i] && !this.free) return;          // confirmed race digits are final
    if (!this.v[i] && !this.n[i]) return;
    if (this.free) this.snap();
    this.v[i] = 0; this.n[i] = 0; this.onChange(); this.render();
  }
  undo() {
    if (this.locked || !this.free || !this.undoStack.length) return;
    const s = this.undoStack.pop(); this.v = s.v; this.n = s.n; this.onChange(); this.render();
  }
  toggleNotes() { this.noteMode = !this.noteMode; this.render(); }
  move(dr, dc) {
    if (this.locked) return;
    if (this.sel === null) this.sel = 40;
    else this.sel = ((rowOf(this.sel) + dr + 9) % 9) * 9 + (colOf(this.sel) + dc + 9) % 9;
    if (this.v[this.sel]) this.active = this.v[this.sel];
    this.render();
  }
  deselect() { if (this.sel !== null || this.active !== null) { this.sel = this.active = null; this.render(); } }

  key(e) {
    const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (m && !e.ctrlKey && !e.metaKey && !e.altKey) this.digit(+m[1], e.shiftKey);
    else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') this.undo();
    else if (e.ctrlKey || e.metaKey || e.altKey) return false;
    else if (e.key === 'ArrowUp') this.move(-1, 0);
    else if (e.key === 'ArrowDown') this.move(1, 0);
    else if (e.key === 'ArrowLeft') this.move(0, -1);
    else if (e.key === 'ArrowRight') this.move(0, 1);
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') this.erase();
    else if (e.code === 'KeyN') this.toggleNotes();
    else if (e.code === 'KeyU') this.undo();
    else if (e.key === 'Escape') this.deselect();
    else if ((e.key === 'Enter' || e.key === ' ') && this.sel !== null && !this.v[this.sel] && this.active && !this.locked) {
      if (this.noteMode) this.toggleNote(this.sel, this.active); else this.place(this.sel, this.active);
      this.render();
    } else return false;
    return true;
  }

  render() {
    const { v, n, given } = this, show = this.hover || this.active;
    const bad = this.free ? IDX.map(i => v[i] && !given[i] ? PEERS[i].some(j => v[j] === v[i]) : false) : null;
    for (const i of IDX) {
      const e = this.cells[i], x = v[i], pend = this.pending.get(i);
      let cl = 'c';
      if (colOf(i) % 3 === 2 && colOf(i) < 8) cl += ' r';
      if (rowOf(i) % 3 === 2 && rowOf(i) < 8) cl += ' b';
      if (i === this.flash) cl += ' miss';
      if (given[i]) cl += ' given'; else if (x) cl += ' user'; else if (pend) cl += ' pend';
      if (bad && bad[i]) cl += ' bad';
      // Only what a player could see on paper: the pressed cell's row, column and box (gray,
      // strongest next to it) and every copy of the chosen number (blue). No hints about
      // where a number can still go.
      if (show && x === show) cl += ' same';
      else if (this.sel !== null && PEERS[this.sel].includes(i)) cl += ' peer k' + fade(this.sel, i);
      if (i === this.sel) cl += ' sel';
      e.className = cl;
      if (x || pend) e.textContent = x || pend;
      else if (n[i]) {
        let h = '<div class="n">';
        for (let d = 1; d <= 9; d++) h += `<span${n[i] >> d & 1 && d === show ? ' class="on"' : ''}>${n[i] >> d & 1 ? d : ''}</span>`;
        e.innerHTML = h + '</div>';
      } else e.textContent = '';
    }
    for (let d = 1; d <= 9; d++) {
      const left = 9 - v.filter(x => x === d).length;
      this.pad[d].className = (d === show ? 'on ' : '') + (left <= 0 ? 'done' : '');
      this.pad[d].lastChild.textContent = left > 0 ? left : '✓';
    }
    this.el.classList.toggle('locked', this.locked);
    this.padEl.classList.toggle('notes', this.noteMode);
  }
}
