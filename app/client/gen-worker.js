// Solo puzzles are made off the main thread: a hard one can take about a second.
import { generate } from '/shared/sudoku.js';
self.onmessage = e => self.postMessage(generate(e.data.seed, e.data.difficulty));
