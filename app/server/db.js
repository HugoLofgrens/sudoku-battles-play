// SQLite through Node's built-in driver: one file, no native build step. Node is single
// threaded and DatabaseSync is synchronous, so each function below runs without interleaving.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { START, CENTER, idle, rateGame } from './glicko2.js';
import { gainFor } from './rating.js';
import { DIFFICULTIES } from '../shared/sudoku.js';

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return new Store(db);
}

// Each entry runs once, in order, inside a transaction; PRAGMA user_version counts them.
// Never edit an entry that has shipped: add a new one.
const MIGRATIONS = [
  // 1: the first schema. (Databases made before versioning have these tables at version 0;
  // IF NOT EXISTS makes this a no-op for them.)
  `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass TEXT NOT NULL,
      created INTEGER NOT NULL,
      avatar TEXT NOT NULL DEFAULT '{}',
      theme TEXT NOT NULL DEFAULT 'night'
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL,
      last_used INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ratings (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      difficulty TEXT NOT NULL,
      rating REAL NOT NULL, rd REAL NOT NULL, vol REAL NOT NULL,
      games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0,
      peak REAL NOT NULL DEFAULT 1500,
      updated INTEGER NOT NULL,
      PRIMARY KEY (user_id, difficulty)
    );
    CREATE TABLE IF NOT EXISTS games (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL, difficulty TEXT NOT NULL, seed INTEGER NOT NULL, gen_version INTEGER NOT NULL,
      mistakes_allowed INTEGER NOT NULL,
      created INTEGER NOT NULL, started INTEGER, decided INTEGER, closed INTEGER,
      status TEXT NOT NULL, winner INTEGER, reason TEXT, rated INTEGER NOT NULL DEFAULT 0,
      p0_user INTEGER REFERENCES users(id), p1_user INTEGER REFERENCES users(id),
      p0_name TEXT NOT NULL, p1_name TEXT NOT NULL,
      p0_time INTEGER, p1_time INTEGER, p0_done TEXT, p1_done TEXT,
      p0_filled INTEGER, p1_filled INTEGER, p0_mistakes INTEGER, p1_mistakes INTEGER,
      p0_before REAL, p1_before REAL, p0_after REAL, p1_after REAL,
      moves TEXT
    );
    CREATE INDEX IF NOT EXISTS games_p0 ON games(p0_user, created);
    CREATE INDEX IF NOT EXISTS games_p1 ON games(p1_user, created);
    CREATE TABLE IF NOT EXISTS friends (
      a INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      b INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requester INTEGER NOT NULL,
      status TEXT NOT NULL,
      created INTEGER NOT NULL,
      PRIMARY KEY (a, b),
      CHECK (a < b)
    );
`,
  // 2: rated games remember margin and gain; every server-timed solve goes in one table that
  // all time stats and time leaderboards read from (backfilled from earlier races).
  `
    ALTER TABLE games ADD COLUMN margin REAL;
    ALTER TABLE games ADD COLUMN gain REAL;
    CREATE TABLE solves (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      difficulty TEXT NOT NULL,
      time INTEGER NOT NULL,
      at INTEGER NOT NULL,
      source TEXT NOT NULL,
      ref TEXT NOT NULL,
      PRIMARY KEY (source, ref, user_id)
    );
    CREATE INDEX solves_user ON solves(user_id, difficulty, time);
    CREATE INDEX solves_period ON solves(difficulty, at);
    INSERT OR IGNORE INTO solves SELECT p0_user, difficulty, p0_time, started + p0_time, 'race', id
      FROM games WHERE p0_user IS NOT NULL AND p0_time IS NOT NULL;
    INSERT OR IGNORE INTO solves SELECT p1_user, difficulty, p1_time, started + p1_time, 'race', id
      FROM games WHERE p1_user IS NOT NULL AND p1_time IS NOT NULL;
  `,
  // 3: the daily puzzle: one server-timed attempt per account per UTC day.
  `
    CREATE TABLE daily_runs (
      day TEXT NOT NULL,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      started INTEGER NOT NULL,
      finished INTEGER,
      status TEXT NOT NULL,
      time INTEGER,
      mistakes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (day, user_id)
    );
    CREATE INDEX daily_board ON daily_runs(day, status, time);
  `
];
export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db) {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw new Error(`database migration ${v + 1} failed: ${e.message}`); }
  }
}

export const SESSION_TTL = 90 * 24 * 3600e3;    // a token unused for 90 days stops working


const pair = (x, y) => (x < y ? [x, y] : [y, x]);

class Store {
  constructor(db) {
    this.db = db;
    this.q = {};
    const prep = (k, sql) => (this.q[k] = db.prepare(sql));
    prep('userByName', 'SELECT * FROM users WHERE name = ?');
    prep('userById', 'SELECT * FROM users WHERE id = ?');
    prep('addUser', 'INSERT INTO users (name, pass, created, avatar) VALUES (?, ?, ?, ?)');
    prep('setLook', 'UPDATE users SET avatar = ?, theme = ? WHERE id = ?');
    prep('addSession', 'INSERT INTO sessions (token_hash, user_id, created, last_used) VALUES (?, ?, ?, ?)');
    prep('session', 'SELECT * FROM sessions WHERE token_hash = ?');
    prep('touchSession', 'UPDATE sessions SET last_used = ? WHERE token_hash = ?');
    prep('dropSession', 'DELETE FROM sessions WHERE token_hash = ?');
    prep('rating', 'SELECT * FROM ratings WHERE user_id = ? AND difficulty = ?');
    prep('ratings', 'SELECT * FROM ratings WHERE user_id = ?');
    prep('putRating', `INSERT INTO ratings (user_id, difficulty, rating, rd, vol, games, wins, losses, draws, peak, updated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, difficulty) DO UPDATE SET rating = excluded.rating, rd = excluded.rd, vol = excluded.vol,
        games = excluded.games, wins = excluded.wins, losses = excluded.losses, draws = excluded.draws,
        peak = excluded.peak, updated = excluded.updated`);
    prep('addGame', `INSERT INTO games (id, kind, difficulty, seed, gen_version, mistakes_allowed, created, status, p0_user, p1_user, p0_name, p1_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?)`);
    prep('game', 'SELECT * FROM games WHERE id = ?');
    prep('markRated', "UPDATE games SET rated = 1 WHERE id = ? AND rated = 0 AND kind = 'ranked'");
    prep('gameRatings', 'UPDATE games SET p0_before = ?, p1_before = ?, p0_after = ?, p1_after = ?, margin = ?, gain = ? WHERE id = ?');
    prep('saveGame', `UPDATE games SET status = ?, started = ?, decided = ?, closed = ?, winner = ?, reason = ?,
      p0_time = ?, p1_time = ?, p0_done = ?, p1_done = ?, p0_filled = ?, p1_filled = ?, p0_mistakes = ?, p1_mistakes = ?, moves = ?
      WHERE id = ?`);
    prep('recent', `SELECT * FROM games WHERE (p0_user = ? OR p1_user = ?) AND status IN ('decided', 'closed')
      ORDER BY created DESC LIMIT ?`);
    prep('friendRow', 'SELECT * FROM friends WHERE a = ? AND b = ?');
    prep('addFriend', 'INSERT INTO friends (a, b, requester, status, created) VALUES (?, ?, ?, ?, ?)');
    prep('acceptFriend', "UPDATE friends SET status = 'accepted' WHERE a = ? AND b = ? AND status = 'pending' AND requester != ?");
    prep('dropFriend', 'DELETE FROM friends WHERE a = ? AND b = ?');
    prep('friendsOf', `SELECT f.*, u.id AS uid, u.name, u.avatar FROM friends f
      JOIN users u ON u.id = CASE WHEN f.a = ? THEN f.b ELSE f.a END
      WHERE f.a = ? OR f.b = ? ORDER BY u.name`);
    prep('history', `SELECT difficulty, decided AS at, CASE WHEN p0_user = ? THEN p0_after ELSE p1_after END AS rating
      FROM games WHERE rated = 1 AND (p0_user = ? OR p1_user = ?) ORDER BY decided`);
    prep('abortRunning', "UPDATE games SET status = 'aborted', reason = 'server-restart', closed = ? WHERE status IN ('waiting', 'live')");
    prep('closeDecided', "UPDATE games SET status = 'closed', closed = ? WHERE status = 'decided'");
    prep('dailyRun', 'SELECT * FROM daily_runs WHERE day = ? AND user_id = ?');
    prep('startDaily', "INSERT OR IGNORE INTO daily_runs (day, user_id, started, status) VALUES (?, ?, ?, 'playing')");
    prep('endDaily', "UPDATE daily_runs SET finished = ?, status = ?, time = ?, mistakes = ? WHERE day = ? AND user_id = ? AND status = 'playing'");
    prep('dailyBoard', `SELECT u.name, u.avatar, d.time, d.mistakes FROM daily_runs d JOIN users u ON u.id = d.user_id
      WHERE d.day = ? AND d.status = 'solved' ORDER BY d.time, d.finished LIMIT ?`);
    prep('dailyRank', "SELECT COUNT(*) AS n FROM daily_runs WHERE day = ? AND status = 'solved' AND time < ?");
    prep('dailyCount', "SELECT COUNT(*) AS n FROM daily_runs WHERE day = ? AND status = 'solved'");
    prep('addSolve', 'INSERT OR IGNORE INTO solves (user_id, difficulty, time, at, source, ref) VALUES (?, ?, ?, ?, ?, ?)');
    prep('solveTimes', 'SELECT time FROM solves WHERE user_id = ? AND difficulty = ? ORDER BY time');
    prep('solvesSince', 'SELECT user_id, time FROM solves WHERE difficulty = ? AND at >= ?');
    prep('fastest', `SELECT s.user_id, u.name, u.avatar, MIN(s.time) AS time FROM solves s JOIN users u ON u.id = s.user_id
      WHERE s.difficulty = ? AND s.at >= ? GROUP BY s.user_id ORDER BY time LIMIT ?`);
    prep('leaders', `SELECT u.name, u.avatar, r.rating, r.rd, r.games FROM ratings r JOIN users u ON u.id = r.user_id
      WHERE r.difficulty = ? AND r.rd <= ? ORDER BY r.rating DESC LIMIT ?`);
  }

  tx(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  // ---- users and sessions ----
  userByName(name) { return this.q.userByName.get(name); }
  userById(id) { return this.q.userById.get(id); }
  addUser(name, pass, avatar, now) { return Number(this.q.addUser.run(name, pass, now, JSON.stringify(avatar)).lastInsertRowid); }
  setLook(id, avatar, theme) { this.q.setLook.run(JSON.stringify(avatar), theme, id); }
  addSession(hash, userId, now) { this.q.addSession.run(hash, userId, now, now); }
  session(hash, now = Date.now()) {
    const s = this.q.session.get(hash);
    if (s && now - s.last_used > SESSION_TTL) { this.dropSession(hash); return null; }
    return s;
  }
  touchSession(hash, now) { this.q.touchSession.run(now, hash); }
  dropSession(hash) { this.q.dropSession.run(hash); }

  // ---- ratings ----
  // The stored rating with idle RD growth applied, or the starting rating.
  rating(userId, difficulty, now) {
    const r = this.q.rating.get(userId, difficulty);
    if (!r) return { ...START, games: 0, wins: 0, losses: 0, draws: 0, peak: CENTER, updated: now };
    return { ...r, ...idle(r, now - r.updated) };
  }
  ratings(userId, now) {
    const out = {};
    for (const d of DIFFICULTIES) out[d] = this.rating(userId, d, now);
    return out;
  }

  // Applies one ranked result exactly once. margin is 0..1 (rating.js). Returns
  // [{before, after}, {before, after}] or null when the game was already rated, is not ranked,
  // or does not have two different accounts.
  rateGame(gameId, difficulty, users, winner, now, margin = 0) {
    return this.tx(() => {
      if (!users[0] || !users[1] || users[0] === users[1]) return null;
      if (this.q.markRated.run(gameId).changes !== 1) return null;
      const before = users.map(u => this.rating(u, difficulty, now));
      const score = winner === null ? 0.5 : winner === 0 ? 1 : 0;
      const gain = winner === null ? 1 : gainFor(margin, before[winner].rating, before[1 - winner].rating);
      const after = rateGame(before[0], before[1], score, gain);
      users.forEach((u, i) => {
        const b = before[i], a = after[i], s = i === 0 ? score : 1 - score;
        this.q.putRating.run(u, difficulty, a.rating, a.rd, a.vol, b.games + 1,
          b.wins + (s === 1 ? 1 : 0), b.losses + (s === 0 ? 1 : 0), b.draws + (s === 0.5 ? 1 : 0),
          Math.max(b.peak, a.rating), now);
      });
      this.q.gameRatings.run(before[0].rating, before[1].rating, after[0].rating, after[1].rating, margin, gain, gameId);
      return before.map((b, i) => ({ before: b, after: after[i], gain }));
    });
  }

  // ---- games ----
  addGame(m) {
    const [a, b] = m.p.map(p => p.info);
    this.q.addGame.run(m.id, m.kind, m.difficulty, m.seed, m.genVersion, m.mistakes, m.createdAt,
      a.userId ?? null, b.userId ?? null, a.name, b.name);
  }
  saveGame(m) {
    const [a, b] = m.p;
    m.p.forEach((p, i) => {
      const t = m.time(i);
      if (t != null && p.info.userId) this.addSolve(p.info.userId, m.difficulty, t, m.startAt + t, 'race', m.id);
    });
    this.q.saveGame.run(m.status, m.startAt, m.result?.at ?? null, m.status === 'closed' ? Date.now() : null,
      m.result?.winner ?? null, m.result?.reason ?? null,
      m.time(0), m.time(1), a.done, b.done, a.filled, b.filled, a.mistakes, b.mistakes,
      JSON.stringify([a.moves, b.moves]), m.id);
  }
  game(id) { return this.q.game.get(id); }
  recent(userId, limit = 20) { return this.q.recent.all(userId, userId, limit); }

  // ---- friends ----
  friendRow(x, y) { return this.q.friendRow.get(...pair(x, y)); }
  addFriend(from, to, now) {
    const row = this.friendRow(from, to);
    if (row) {
      // They already asked me: asking back accepts.
      if (row.status === 'pending' && row.requester === to) { this.q.acceptFriend.run(...pair(from, to), from); return 'accepted'; }
      return row.status;
    }
    this.q.addFriend.run(...pair(from, to), from, 'pending', now);
    return 'pending';
  }
  acceptFriend(me, them) { return this.q.acceptFriend.run(...pair(me, them), me).changes === 1; }
  dropFriend(me, them) { return this.q.dropFriend.run(...pair(me, them)).changes === 1; }
  friendsOf(id) { return this.q.friendsOf.all(id, id, id); }

  leaders(difficulty, maxRd, limit) { return this.q.leaders.all(difficulty, maxRd, limit); }

  // Rating after each rated game, oldest first: [{difficulty, at, rating}].
  history(userId) { return this.q.history.all(userId, userId, userId); }

  // Games that were running when the server stopped: unfinished ones are aborted (never
  // rated), decided ones are closed (their rating was already applied).
  recover(now) {
    const aborted = this.q.abortRunning.run(now).changes;
    this.q.closeDecided.run(now);
    return aborted;
  }

  // ---- solves (server-timed only: races and the daily puzzle) ----
  addSolve(userId, difficulty, time, at, source, ref) { this.q.addSolve.run(userId, difficulty, time, at, source, ref); }
  solveTimes(userId, difficulty) { return this.q.solveTimes.all(userId, difficulty).map(r => r.time); }
  // [{user_id, time}] for every solve since `since`, for medians and percentiles.
  solvesSince(difficulty, since) { return this.q.solvesSince.all(difficulty, since); }
  fastest(difficulty, since, limit) { return this.q.fastest.all(difficulty, since, limit); }
  usersById(ids) { return ids.length ? this.db.prepare(`SELECT id, name, avatar FROM users WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids) : []; }

  // ---- daily puzzle ----
  dailyRun(day, userId) { return this.q.dailyRun.get(day, userId); }
  startDaily(day, userId, now) { return this.q.startDaily.run(day, userId, now).changes === 1; }
  endDaily(day, userId, status, time, mistakes, now) { this.q.endDaily.run(now, status, time, mistakes, day, userId); }
  dailyBoard(day, limit) { return this.q.dailyBoard.all(day, limit); }
  dailyRank(day, time) { return this.q.dailyRank.get(day, time).n + 1; }
  dailyCount(day) { return this.q.dailyCount.get(day).n; }
}
