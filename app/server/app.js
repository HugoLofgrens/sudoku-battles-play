// HTTP API + WebSocket hub. docs/PROTOCOL.md lists every endpoint and message.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { Match, RULES } from './match.js';
import { PuzzlePool } from './puzzles.js';
import { PROVISIONAL_RD } from './glicko2.js';
import { checkName, checkPassword, hashPassword, verifyPassword, DUMMY_HASH, newToken, hashToken, Limiter } from './auth.js';
import { cleanAvatar, cleanTheme } from '../shared/looks.js';
import { DIFFICULTIES, GENERATOR_VERSION } from '../shared/sudoku.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ROOM_TTL = 15 * 60e3, KEEP_FINISHED = 10 * 60e3;

export const matchWindow = waitMs => (waitMs >= 60e3 ? Infinity : 150 + 50 * Math.floor(waitMs / 5e3));

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
class Reply { constructor(status, payload) { this.status = status; this.payload = payload; } }

export async function createApp({ dbFile = join(ROOT, 'data', 'sudoku.db'), port = 8080, host = '0.0.0.0', log = console.log, now = Date.now, limitScale = 1 } = {}) {
  const store = openDb(dbFile);
  const pool = new PuzzlePool();
  const clients = new Map();          // key -> {ws, ident}
  const guests = new Map();           // guest token -> ident
  const games = new Map();            // game id -> Match
  const active = new Map();           // key -> game id, while that player still has a game to play
  const queues = Object.fromEntries(DIFFICULTIES.map(d => [d, new Map()]));   // key -> entry
  const rooms = new Map();            // code -> room
  const limits = { login: new Limiter(10 * limitScale, 15 * 60e3), signup: new Limiter(5 * limitScale, 60 * 60e3), friend: new Limiter(30 * limitScale, 60 * 60e3) };

  // ---------- identities ----------
  const lookOf = u => { try { return cleanAvatar(JSON.parse(u.avatar)); } catch { return cleanAvatar(null); } };
  const keyOfUser = id => 'u:' + id;
  function ratingView(r) { return { rating: Math.round(r.rating), rd: Math.round(r.rd), provisional: r.rd > PROVISIONAL_RD, games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, peak: Math.round(r.peak) }; }
  function meView(u) {
    const rs = store.ratings(u.id, now());
    return { id: u.id, name: u.name, avatar: lookOf(u), theme: u.theme, guest: false,
      ratings: Object.fromEntries(Object.entries(rs).map(([d, r]) => [d, ratingView(r)])) };
  }
  function userFromToken(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    const h = hashToken(token), s = store.session(h);
    if (!s) return null;
    store.touchSession(h, now());
    return store.userById(s.user_id);
  }
  function newGuest() {
    let name;
    do name = 'Guest' + randomInt(1000, 10000); while ([...guests.values()].some(g => g.name === name));
    const token = newToken();
    const ident = { key: 'g:' + randomBytes(9).toString('base64url'), userId: null, name, avatar: { s: randomInt(0, 12), c: randomInt(0, 8) }, guest: true };
    guests.set(token, ident);
    return { token, ident };
  }

  // ---------- sending ----------
  const send = (key, msg) => { const c = clients.get(key); if (c && c.ws.readyState === 1) c.ws.send(JSON.stringify(msg)); };
  const fail = (key, code, message) => send(key, { t: 'error', code, message });

  // ---------- games ----------
  async function startMatch(kind, difficulty, mistakes, idents) {
    const puzzle = await pool.take(difficulty);
    const t = now();
    const players = idents.map(id => ({
      key: id.key, userId: id.userId, name: id.name, avatar: id.avatar,
      rating: kind === 'ranked' ? ratingView(store.rating(id.userId, difficulty, t)) : null
    }));
    const m = new Match({ id: randomBytes(8).toString('base64url'), kind, difficulty, mistakes, seed: puzzle.seed,
      puzzle: puzzle.puzzle, solution: puzzle.solution, players, now: t,
      emit: (i, msg) => send(players[i].key, msg) });
    m.genVersion = puzzle.version;
    m.lastStatus = m.status;
    m.onDecided = onDecided;
    m.onClosed = mm => store.saveGame(mm);
    games.set(m.id, m);
    store.addGame(m);
    for (const id of idents) {
      for (const q of Object.values(queues)) q.delete(id.key);
      dropRoomsOf(id.key);
      active.set(id.key, m.id);
    }
    players.forEach((p, i) => { if (clients.has(p.key)) m.connect(i, t); });
    afterMatch(m);
    return m;
  }
  function onDecided(m) {
    if (m.kind === 'ranked' && m.result.winner !== undefined) {
      const users = m.p.map(p => p.info.userId);
      const r = store.rateGame(m.id, m.difficulty, users, m.result.winner, m.result.at);
      if (r) m.ratingChange = r.map(x => ({ before: Math.round(x.before.rating), after: Math.round(x.after.rating), delta: Math.round(x.after.rating) - Math.round(x.before.rating), provisional: x.after.rd > PROVISIONAL_RD }));
    }
    store.saveGame(m);
  }
  // Housekeeping after anything touched a match.
  function afterMatch(m) {
    if (m.status !== m.lastStatus) {
      m.lastStatus = m.status;
      if (m.status === 'aborted') store.saveGame(m);
      if (!m.open) m.endedAt = now();
    }
    m.p.forEach(p => { if ((p.done || !m.open) && active.get(p.info.key) === m.id) active.delete(p.info.key); });
  }
  const gameOf = key => { const id = active.get(key); return id ? games.get(id) : null; };
  const seat = (m, key) => m.p.findIndex(p => p.info.key === key);

  // A player who wants a new game: refuse during a live race, stop playing on after the result.
  function freeUp(key) {
    const m = gameOf(key);
    if (!m) return true;
    const i = seat(m, key);
    if (m.status === 'live') return false;
    if (m.status === 'waiting') { m.abort(i, now()); afterMatch(m); return true; }
    m.resign(i, now()); afterMatch(m);
    return true;
  }

  // ---------- rooms (friend games, by link or challenge) ----------
  function dropRoomsOf(key) {
    for (const [code, r] of rooms) if (r.hostKey === key) {
      rooms.delete(code);
      if (r.invite) send(keyOfUser(r.invite), { t: 'challenge.gone', code });
    }
  }
  function roomCode() { let c; do { c = ''; for (let i = 0; i < 6; i++) c += ROOM_ALPHABET[randomInt(0, ROOM_ALPHABET.length)]; } while (rooms.has(c)); return c; }

  // ---------- matchmaking ----------
  function matchmake() {
    const t = now();
    for (const d of DIFFICULTIES) {
      const list = [...queues[d].values()].sort((a, b) => a.since - b.since);
      const taken = new Set();
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        if (taken.has(a.key)) continue;
        let best = null, bestGap = Infinity;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (taken.has(b.key) || b.userId === a.userId) continue;
          const gap = Math.abs(a.rating - b.rating);
          if (gap <= Math.max(matchWindow(t - a.since), matchWindow(t - b.since)) && gap < bestGap) { best = b; bestGap = gap; }
        }
        if (!best) continue;
        taken.add(a.key); taken.add(best.key);
        queues[d].delete(a.key); queues[d].delete(best.key);
        const ia = clients.get(a.key)?.ident, ib = clients.get(best.key)?.ident;
        if (!ia || !ib) continue;
        startMatch('ranked', d, RULES.rankedMistakes, randomInt(0, 2) ? [ia, ib] : [ib, ia]).catch(e => log('match failed', e));
      }
    }
  }

  // ---------- websocket messages ----------
  const handlers = {
    queue(c, msg) {
      const { ident } = c;
      if (ident.guest) return fail(ident.key, 'login-required', 'Log in to play ranked.');
      if (!DIFFICULTIES.includes(msg.difficulty)) return fail(ident.key, 'bad-request', 'Unknown difficulty.');
      if (!freeUp(ident.key)) return fail(ident.key, 'in-game', 'Finish or resign your game first.');
      for (const q of Object.values(queues)) q.delete(ident.key);
      dropRoomsOf(ident.key);
      const r = store.rating(ident.userId, msg.difficulty, now());
      const entry = { key: ident.key, userId: ident.userId, rating: r.rating, since: now() };
      queues[msg.difficulty].set(ident.key, entry);
      send(ident.key, { t: 'queued', difficulty: msg.difficulty, since: entry.since, rating: ratingView(r) });
    },
    unqueue(c) {
      for (const q of Object.values(queues)) q.delete(c.ident.key);
      send(c.ident.key, { t: 'unqueued' });
    },
    'room.create'(c, msg) {
      const { ident } = c;
      if (!DIFFICULTIES.includes(msg.difficulty) || !RULES.mistakeOptions.includes(msg.mistakes)) return fail(ident.key, 'bad-request', 'Bad rules.');
      if (!freeUp(ident.key)) return fail(ident.key, 'in-game', 'Finish or resign your game first.');
      for (const q of Object.values(queues)) q.delete(ident.key);
      let invite = null;
      if (msg.invite != null) {
        if (ident.guest) return fail(ident.key, 'login-required', 'Log in to challenge friends.');
        const u = typeof msg.invite === 'string' && store.userByName(msg.invite);
        const f = u && store.friendRow(ident.userId, u.id);
        if (!f || f.status !== 'accepted') return fail(ident.key, 'not-friends', 'You can only challenge friends.');
        if (!clients.has(keyOfUser(u.id))) return fail(ident.key, 'offline', `${u.name} is offline.`);
        invite = u.id;
      }
      dropRoomsOf(ident.key);
      const room = { code: roomCode(), hostKey: ident.key, rules: { difficulty: msg.difficulty, mistakes: msg.mistakes }, created: now(), invite };
      rooms.set(room.code, room);
      send(ident.key, { t: 'room', code: room.code, rules: room.rules, invite: msg.invite ?? null });
      if (invite) send(keyOfUser(invite), { t: 'challenge', code: room.code, rules: room.rules, from: { name: ident.name, avatar: ident.avatar } });
    },
    'room.cancel'(c) { dropRoomsOf(c.ident.key); send(c.ident.key, { t: 'room.closed' }); },
    'room.join'(c, msg) {
      const { ident } = c;
      const code = typeof msg.code === 'string' ? msg.code.toUpperCase() : '';
      const room = rooms.get(code);
      if (!room) return fail(ident.key, 'no-room', 'That game link has expired.');
      if (room.hostKey === ident.key) return fail(ident.key, 'own-room', 'Send the link to a friend. You cannot join your own game.');
      if (room.invite && room.invite !== ident.userId) return fail(ident.key, 'not-invited', 'That challenge is for someone else.');
      const host = clients.get(room.hostKey);
      if (!host) { rooms.delete(code); return fail(ident.key, 'host-offline', 'Your friend is not online any more.'); }
      if (gameOf(room.hostKey)?.status === 'live') return fail(ident.key, 'host-busy', 'Your friend is in another game.');
      if (!freeUp(ident.key)) return fail(ident.key, 'in-game', 'Finish or resign your game first.');
      freeUp(room.hostKey);
      rooms.delete(code);
      startMatch('casual', room.rules.difficulty, room.rules.mistakes, [host.ident, ident]).catch(e => log('match failed', e));
    },
    'challenge.decline'(c, msg) {
      const room = rooms.get(msg.code);
      if (!room || room.invite !== c.ident.userId) return;
      rooms.delete(msg.code);
      send(room.hostKey, { t: 'challenge.declined', name: c.ident.name });
    },
    place(c, msg) {
      const m = gameOf(c.ident.key);
      if (!m) return fail(c.ident.key, 'no-game', 'You are not in a game.');
      const r = m.place(seat(m, c.ident.key), msg.cell, msg.digit, now());
      send(c.ident.key, { t: 'placed', cell: msg.cell, digit: msg.digit, ok: r.ok ?? null, reason: r.reason ?? null });
      afterMatch(m);
    },
    resign(c) { const m = gameOf(c.ident.key); if (m) { m.resign(seat(m, c.ident.key), now()); afterMatch(m); } },
    abort(c) {
      const m = gameOf(c.ident.key);
      if (m && !m.abort(seat(m, c.ident.key), now())) fail(c.ident.key, 'cannot-abort', 'Too late to abort.');
      if (m) afterMatch(m);
    },
    rematch(c, msg) {
      const m = games.get(msg.game);
      const i = m ? seat(m, c.ident.key) : -1;
      if (i < 0 || m.kind !== 'casual' || (m.status !== 'decided' && m.status !== 'closed')) return fail(c.ident.key, 'no-rematch', 'Rematch is not available.');
      const o = m.p[1 - i].info;
      if (!clients.has(o.key) || (active.get(o.key) && active.get(o.key) !== m.id) || m.rematchStarted) return fail(c.ident.key, 'opponent-unavailable', `${o.name} has left.`);
      m.rematch[i] = true;
      if (m.rematch[0] && m.rematch[1]) {
        m.rematchStarted = true;
        for (const p of m.p) if (!freeUp(p.info.key)) return;
        const ids = m.p.map(p => clients.get(p.info.key).ident).reverse();
        startMatch('casual', m.difficulty, m.mistakes, ids).catch(e => log('match failed', e));
      } else m.sync(now());
    },
    leave(c) { const m = gameOf(c.ident.key); if (m && m.status !== 'live') freeUp(c.ident.key); },
    ping(c) { send(c.ident.key, { t: 'pong', serverNow: now() }); }
  };

  function onHello(ws, msg) {
    let ident, guestToken = null, me;
    const user = msg.token ? userFromToken(msg.token) : null;
    if (msg.token && !user) return ws.send(JSON.stringify({ t: 'error', code: 'bad-token', message: 'Session expired. Log in again.' }));
    if (user) {
      ident = { key: keyOfUser(user.id), userId: user.id, name: user.name, avatar: lookOf(user), guest: false };
      me = meView(user);
    } else {
      const g = typeof msg.guest === 'string' && guests.get(msg.guest);
      if (g) { ident = g; guestToken = msg.guest; } else ({ token: guestToken, ident } = newGuest());
      me = { name: ident.name, avatar: ident.avatar, guest: true };
    }
    const old = clients.get(ident.key);
    if (old && old.ws !== ws) { old.replaced = true; old.ws.send(JSON.stringify({ t: 'replaced' })); old.ws.close(4000, 'replaced'); }
    const c = { ws, ident };
    clients.set(ident.key, c);
    ws.client = c;
    ws.send(JSON.stringify({ t: 'welcome', me, guestToken, serverNow: now(), rules: { mistakeOptions: RULES.mistakeOptions, rankedMistakes: RULES.rankedMistakes, capMs: RULES.capMs } }));
    const m = gameOf(ident.key);
    if (m) { m.connect(seat(m, ident.key), now()); afterMatch(m); }
    notifyFriends(ident);
  }
  function onClose(ws) {
    const c = ws.client;
    if (!c || c.replaced || clients.get(c.ident.key) !== c) return;
    clients.delete(c.ident.key);
    for (const q of Object.values(queues)) q.delete(c.ident.key);
    dropRoomsOf(c.ident.key);
    const m = gameOf(c.ident.key);
    if (m) { m.disconnect(seat(m, c.ident.key), now()); afterMatch(m); }
    notifyFriends(c.ident);
  }
  function notifyFriends(ident) {
    if (!ident.userId) return;
    for (const f of store.friendsOf(ident.userId)) if (f.status === 'accepted') send(keyOfUser(f.uid), { t: 'friends' });
  }

  // ---------- HTTP API ----------
  async function body(req) {
    let size = 0; const chunks = [];
    for await (const ch of req) { size += ch.length; if (size > 8192) throw new HttpError(413, 'Too large'); chunks.push(ch); }
    try { return JSON.parse(Buffer.concat(chunks).toString() || '{}'); } catch { throw new HttpError(400, 'Bad JSON'); }
  }
  function authed(req) {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const u = m && userFromToken(m[1]);
    if (!u) throw new HttpError(401, 'Log in first.');
    return u;
  }
  const ipOf = req => req.socket.remoteAddress || '?';
  function issue(u) { const token = newToken(); store.addSession(hashToken(token), u.id, now()); return { token, me: meView(u) }; }
  function gameRow(g, userId) {
    const i = g.p0_user === userId ? 0 : 1, o = 1 - i;
    const res = g.winner === null ? 'draw' : g.winner === i ? 'win' : 'loss';
    return { id: g.id, kind: g.kind, difficulty: g.difficulty, when: g.created, result: res, reason: g.reason,
      opponent: g['p' + o + '_name'], time: g['p' + i + '_time'], mistakes: g['p' + i + '_mistakes'],
      ratingBefore: g['p' + i + '_before'] == null ? null : Math.round(g['p' + i + '_before']),
      ratingAfter: g['p' + i + '_after'] == null ? null : Math.round(g['p' + i + '_after']) };
  }
  function profile(u) {
    const games = store.recent(u.id, 200).map(g => gameRow(g, u.id));
    const best = {};
    for (const g of games) if (g.time != null && (best[g.difficulty] == null || g.time < best[g.difficulty])) best[g.difficulty] = g.time;
    let streak = 0, bestStreak = 0, run = 0;
    for (const g of [...games].reverse()) { run = g.result === 'win' ? run + 1 : 0; bestStreak = Math.max(bestStreak, run); }
    for (const g of games) { if (g.result !== 'win') break; streak++; }
    const me = meView(u);
    return { name: u.name, avatar: me.avatar, joined: u.created, ratings: me.ratings, bestTimes: best, streak, bestStreak,
      totals: { games: games.length, wins: games.filter(g => g.result === 'win').length, losses: games.filter(g => g.result === 'loss').length, draws: games.filter(g => g.result === 'draw').length },
      recent: games.slice(0, 20) };
  }

  const routes = {
    'POST /api/register': async req => {
      const b = await body(req);
      if (!limits.signup.hit(ipOf(req))) throw new HttpError(429, 'Too many new accounts. Try later.');
      const err = checkName(b.name) || checkPassword(b.password);
      if (err) throw new HttpError(400, err);
      if (store.userByName(b.name)) throw new HttpError(409, 'That name is taken.');
      let id;
      try { id = store.addUser(b.name, hashPassword(b.password), cleanAvatar(b.avatar), now()); }
      catch { throw new HttpError(409, 'That name is taken.'); }
      return new Reply(201, issue(store.userById(id)));
    },
    'POST /api/login': async req => {
      const b = await body(req);
      if (!limits.login.hit(ipOf(req) + '|' + String(b.name).toLowerCase())) throw new HttpError(429, 'Too many tries. Wait 15 minutes.');
      const u = typeof b.name === 'string' && store.userByName(b.name);
      const ok = verifyPassword(String(b.password ?? ''), u ? u.pass : DUMMY_HASH);
      if (!u || !ok) throw new HttpError(401, 'Wrong name or password.');
      return issue(u);
    },
    'POST /api/logout': async req => {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (m) store.dropSession(hashToken(m[1]));
      return {};
    },
    'GET /api/me': async req => meView(authed(req)),
    'POST /api/me/look': async req => {
      const u = authed(req), b = await body(req);
      store.setLook(u.id, cleanAvatar(b.avatar), cleanTheme(b.theme));
      const c = clients.get(keyOfUser(u.id));
      if (c) c.ident.avatar = cleanAvatar(b.avatar);
      return meView(store.userById(u.id));
    },
    'GET /api/profile': async (req, arg) => {
      const u = store.userByName(decodeURIComponent(arg || ''));
      if (!u) throw new HttpError(404, 'No such player.');
      return profile(u);
    },
    'GET /api/leaderboard': async (req, arg) => {
      if (!DIFFICULTIES.includes(arg)) throw new HttpError(404, 'Unknown difficulty.');
      return store.leaders(arg, PROVISIONAL_RD, 50).map(r => ({ name: r.name, avatar: (() => { try { return cleanAvatar(JSON.parse(r.avatar)); } catch { return cleanAvatar(null); } })(), rating: Math.round(r.rating), games: r.games }));
    },
    'GET /api/friends': async req => {
      const u = authed(req);
      return store.friendsOf(u.id).map(f => ({
        name: f.name, avatar: (() => { try { return cleanAvatar(JSON.parse(f.avatar)); } catch { return cleanAvatar(null); } })(),
        status: f.status === 'accepted' ? 'friend' : f.requester === u.id ? 'outgoing' : 'incoming',
        online: f.status === 'accepted' && clients.has(keyOfUser(f.uid)),
        playing: f.status === 'accepted' && gameOf(keyOfUser(f.uid))?.status === 'live'
      }));
    },
    'POST /api/friends/add': async req => {
      const u = authed(req), b = await body(req);
      if (!limits.friend.hit(String(u.id))) throw new HttpError(429, 'Too many requests.');
      const t = typeof b.name === 'string' && store.userByName(b.name);
      if (!t) throw new HttpError(404, 'No player with that name.');
      if (t.id === u.id) throw new HttpError(400, 'That is you.');
      const status = store.addFriend(u.id, t.id, now());
      send(keyOfUser(t.id), { t: 'friends' });
      return { status };
    },
    'POST /api/friends/accept': async req => {
      const u = authed(req), b = await body(req);
      const t = typeof b.name === 'string' && store.userByName(b.name);
      if (!t || !store.acceptFriend(u.id, t.id)) throw new HttpError(404, 'No request from that player.');
      send(keyOfUser(t.id), { t: 'friends' });
      return { status: 'accepted' };
    },
    'POST /api/friends/remove': async req => {
      const u = authed(req), b = await body(req);
      const t = typeof b.name === 'string' && store.userByName(b.name);
      if (t && store.dropFriend(u.id, t.id)) send(keyOfUser(t.id), { t: 'friends' });
      return {};
    }
  };

  async function serveStatic(req, res, path) {
    if (path === '/' || path === '/index.html') path = '/client/index.html';
    const file = normalize(join(ROOT, path));
    const ok = ['client', 'shared'].some(d => file.startsWith(join(ROOT, d) + sep));
    if (!ok) { res.writeHead(404); return res.end('Not found'); }
    try {
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url.pathname);
    const parts = url.pathname.split('/');            // ['', 'api', name, arg]
    const isSub = ['friends', 'me'].includes(parts[2]) && parts[3];
    const route = routes[`${req.method} /api/${parts[2]}${isSub ? '/' + parts[3] : ''}`];
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    try {
      if (!route) throw new HttpError(404, 'Not found');
      const out = await route(req, isSub ? undefined : parts[3]);
      const { status, payload } = out instanceof Reply ? out : { status: 200, payload: out };
      res.writeHead(status); res.end(JSON.stringify(payload));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log('api error', e);
      res.writeHead(status); res.end(JSON.stringify({ error: status === 500 ? 'Server error' : e.message }));
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
  wss.on('connection', ws => {
    let windowStart = 0, count = 0;
    ws.on('message', raw => {
      const t = now();
      if (t - windowStart >= 1000) { windowStart = t; count = 0; }
      if (++count > 40) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg.t !== 'string') return;
      try {
        if (!ws.client) { if (msg.t === 'hello') onHello(ws, msg); return; }
        const h = Object.prototype.hasOwnProperty.call(handlers, msg.t) && handlers[msg.t];
        if (h) h(ws.client, msg);
      } catch (e) { log('ws error', e); }
    });
    ws.on('close', () => onClose(ws));
    ws.on('error', () => {});
  });

  const timers = [
    setInterval(() => {
      const t = now();
      for (const m of games.values()) {
        if (m.open) { m.tick(t); afterMatch(m); }
        else if (t - m.endedAt > KEEP_FINISHED) games.delete(m.id);
      }
      for (const [code, r] of rooms) if (t - r.created > ROOM_TTL) rooms.delete(code);
    }, 250),
    setInterval(matchmake, 1000),
    setInterval(() => { for (const ws of wss.clients) ws.ping(); }, 25e3)
  ];

  await new Promise(r => server.listen(port, host, r));
  return {
    port: server.address().port, store, games, queues, rooms, matchmake,
    async close() {
      timers.forEach(clearInterval);
      for (const ws of wss.clients) ws.terminate();
      await new Promise(r => wss.close(r));
      await new Promise(r => server.close(r));
      await pool.close();
      store.db.close();
    }
  };
}
