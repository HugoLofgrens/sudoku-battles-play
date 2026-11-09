// The rotating line in the middle of the menus and waiting screens. Short, checked facts and
// tips (sources: claude-memory sudoku/SB2-sudoku-knowledge.md, checked 2026-11-09).
export const FACTS = [
  '"Sudoku" is short for Japanese "the digits must remain single".',
  'Modern sudoku first ran in 1979, as "Number Place" in a Dell puzzle magazine.',
  'Its inventor, architect Howard Garns, never saw his name in print.',
  'Nikoli brought it to Japan in the 1980s and gave it its name.',
  'In 2004 The Times printed sudoku and the world caught the craze.',
  'There are 6,670,903,752,021,072,936,960 ways to fill a sudoku grid.',
  'Remove symmetry and 5,472,730,538 truly different grids remain.',
  '17 clues is the minimum. 16 never gives a unique puzzle (proven 2012).',
  'Proving 16 clues fail took about 7 million computer hours.',
  'With 78 clues the answer is always unique. With 77 it can still split.',
  'Euler studied Latin squares, sudoku\'s ancestor, in the 1780s.',
  'A Paris paper printed a sudoku-like puzzle in 1892.',
  'Solving sudoku of any size is NP-complete: no known shortcut scales.',
  'The first World Sudoku Championship was held in Lucca, Italy, in 2006.',
  'Kota Morinishi of Japan has won the world title a record four times.',
  'A proper sudoku has exactly one answer and never needs a guess.'
];
export const TIPS = [
  'Start with the fullest row, column or box.',
  'Cross-hatch: scan a digit\'s rows and columns to find its one free cell in a box.',
  'Hidden single: if a digit fits only one cell in a row, column or box, it goes there.',
  'Naked single: a cell with one candidate left is solved.',
  'After each placement, check its row, column and box. New singles hide there.',
  'Two cells in a house with the same two candidates own those digits.',
  'A digit stuck on one line inside a box leaves that line elsewhere.',
  'X-wing: a digit locked to the same two columns in two rows clears those columns.',
  'Swordfish is an X-wing across three rows.',
  'XY-wing: pivot {x,y}, wings {x,z} and {y,z}. Any cell seeing both wings loses z.',
  'Fill the obvious first. Notes cost time on easy cells.',
  'Speed solvers only note cells with two or three candidates.',
  'Three mistakes end a race. Unsure? Take a note, not a guess.'
];
// Facts and tips alternate, in a fresh order each session.
export function ticker() {
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const f = shuffle(FACTS), t = shuffle(TIPS), out = [];
  for (let i = 0; i < Math.max(f.length, t.length); i++) { if (f[i]) out.push(f[i]); if (t[i]) out.push(t[i]); }
  return out;
}
