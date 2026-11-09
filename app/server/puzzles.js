// Keeps a few ready puzzles per difficulty, made on a worker thread so a slow hard puzzle
// (up to ~1s) never stalls live games.
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { randomInt } from 'node:crypto';
import { generate, DIFFICULTIES } from '../shared/sudoku.js';

const randomSeed = () => randomInt(0, 2 ** 32);

if (!isMainThread) {
  parentPort.on('message', ({ id, difficulty, seed }) => parentPort.postMessage({ id, ...generate(seed, difficulty) }));
}

export class PuzzlePool {
  constructor(size = 4) {
    this.size = size;
    this.ready = Object.fromEntries(DIFFICULTIES.map(d => [d, []]));
    this.inflight = Object.fromEntries(DIFFICULTIES.map(d => [d, 0]));
    this.waiting = new Map();
    this.next = 1;
    this.worker = new Worker(new URL(import.meta.url));
    this.worker.unref();
    this.worker.on('message', msg => {
      const cb = this.waiting.get(msg.id);
      this.waiting.delete(msg.id);
      cb(msg);
    });
    for (const d of DIFFICULTIES) this.fill(d);
  }
  request(difficulty) {
    return new Promise(resolve => {
      const id = this.next++;
      this.waiting.set(id, resolve);
      this.worker.postMessage({ id, difficulty, seed: randomSeed() });
    });
  }
  fill(d) {
    while (this.ready[d].length + this.inflight[d] < this.size) {
      this.inflight[d]++;
      this.request(d).then(p => { this.inflight[d]--; this.ready[d].push(p); });
    }
  }
  async take(d) {
    const p = this.ready[d].shift() || await this.request(d);
    this.fill(d);
    return p;
  }
  close() { return this.worker.terminate(); }
}
