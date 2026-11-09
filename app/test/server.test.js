// Runs the real server on a free port with an in-memory database and talks to it like a client.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createApp } from '../server/app.js';
import { solve } from '../shared/sudoku.js';

let app, base;
before(async () => { app = await createApp({ port: 0, host: '127.0.0.1', dbFile: ':memory:', log: () => {}, limitScale: 100 }); base = `http://127.0.0.1:${app.port}`; });
after(async () => { await app.close(); });

async function api(path, { method = 'GET', token, body } = {}) {
  const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
}

// A scripted client: collects messages and can wait for one that matches.
async function client(hello) {
  const ws = new WebSocket(base.replace('http', 'ws') + '/ws');
  const inbox = [], waiters = [];
  ws.on('message', raw => {
    const msg = JSON.parse(raw);
    inbox.push(msg);
    for (const w of [...waiters]) if (w.pred(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
  });
  await new Promise(r => ws.on('open', r));
  const c = {
    ws, inbox,
    send: m => ws.send(JSON.stringify(m)),
    wait: (pred, ms = 5000) => {
      const hit = inbox.find(pred);
      if (hit) { inbox.splice(inbox.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const w = { pred, resolve: m => { clearTimeout(timer); inbox.splice(inbox.indexOf(m), 1); resolve(m); } };
        const timer = setTimeout(() => { waiters.splice(waiters.indexOf(w), 1); reject(new Error('timeout waiting; inbox: ' + JSON.stringify(inbox.map(x => x.t)))); }, ms);
        waiters.push(w);
      });
    },
    close: () => ws.close()
  };
  c.send({ t: 'hello', ...hello });
  c.welcome = await c.wait(m => m.t === 'welcome' || m.t === 'error');
  return c;
}
const live = g => g.t === 'game' && g.status === 'live';
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Places every missing digit, a few per tick to stay under the move rate limit.
async function solveGame(c, game) {
  const sol = solve(game.puzzle, 1).first;
  const empties = game.board.map((x, i) => (x ? -1 : i)).filter(i => i >= 0);
  for (let k = 0; k < empties.length; k++) {
    c.send({ t: 'place', cell: empties[k], digit: sol[empties[k]] });
    if (k % 10 === 9) await sleep(1000);
  }
}

test('register, login, bad login, duplicate names', async () => {
  const r = await api('/api/register', { method: 'POST', body: { name: 'alice', password: 'password1' } });
  assert.equal(r.status, 201);
  assert.ok(r.data.token);
  assert.equal(r.data.me.ratings.easy.rating, 1500);
  assert.equal(r.data.me.ratings.easy.provisional, true);
  assert.equal((await api('/api/register', { method: 'POST', body: { name: 'ALICE', password: 'password1' } })).status, 409);
  assert.equal((await api('/api/register', { method: 'POST', body: { name: 'GuestBob', password: 'password1' } })).status, 400);
  assert.equal((await api('/api/register', { method: 'POST', body: { name: 'x', password: 'password1' } })).status, 400);
  assert.equal((await api('/api/register', { method: 'POST', body: { name: 'carol', password: 'short' } })).status, 400);
  assert.equal((await api('/api/login', { method: 'POST', body: { name: 'alice', password: 'nope-nope' } })).status, 401);
  assert.equal((await api('/api/login', { method: 'POST', body: { name: 'nobody', password: 'nope-nope' } })).status, 401);
  const l = await api('/api/login', { method: 'POST', body: { name: 'Alice', password: 'password1' } });
  assert.equal(l.status, 200);
  assert.equal((await api('/api/me', { token: l.data.token })).data.name, 'alice');
  await api('/api/logout', { method: 'POST', token: l.data.token });
  assert.equal((await api('/api/me', { token: l.data.token })).status, 401);
});

test('guests cannot play ranked', async () => {
  const g = await client({});
  assert.equal(g.welcome.me.guest, true);
  assert.match(g.welcome.me.name, /^Guest\d{4}$/);
  g.send({ t: 'queue', difficulty: 'easy' });
  assert.equal((await g.wait(m => m.t === 'error')).code, 'login-required');
  g.close();
});

test('a full ranked race: first to solve wins, ratings move once, stats record it', async () => {
  const a = (await api('/api/register', { method: 'POST', body: { name: 'racer_a', password: 'password1' } })).data;
  const b = (await api('/api/register', { method: 'POST', body: { name: 'racer_b', password: 'password1' } })).data;
  const ca = await client({ token: a.token }), cb = await client({ token: b.token });
  ca.send({ t: 'queue', difficulty: 'easy' });
  cb.send({ t: 'queue', difficulty: 'easy' });
  await ca.wait(m => m.t === 'queued');
  app.matchmake();
  const ga = await ca.wait(live), gb = await cb.wait(live);
  assert.equal(ga.id, gb.id);
  assert.equal(ga.kind, 'ranked');
  assert.equal(ga.opp.name, 'racer_b');
  assert.deepEqual(ga.puzzle, gb.puzzle);
  assert.ok(!('solution' in ga));
  await sleep(ga.startAt - ga.serverNow + 50);

  // B makes one wrong move; A sees B's mistake count.
  const sol = solve(gb.puzzle, 1).first;
  const cell = gb.board.findIndex(x => !x);
  cb.send({ t: 'place', cell, digit: sol[cell] % 9 + 1 });
  assert.equal((await cb.wait(m => m.t === 'placed')).ok, false);
  await ca.wait(m => m.t === 'game' && m.opp.mistakes === 1);

  await solveGame(ca, ga);
  const endA = await ca.wait(m => m.t === 'game' && m.result, 15000);
  const endB = await cb.wait(m => m.t === 'game' && m.result, 15000);
  assert.equal(endA.result.you, 'win');
  assert.equal(endA.result.reason, 'solved');
  assert.equal(endB.result.you, 'loss');
  assert.ok(endA.ratingChange.delta > 0 && endB.ratingChange.delta < 0);
  assert.ok(endA.you.time > 0);

  // B gives up instead of playing on; the game closes and is rated exactly once.
  cb.send({ t: 'resign' });
  await cb.wait(m => m.t === 'game' && m.status === 'closed');
  const pa = (await api('/api/profile/racer_a')).data;
  assert.equal(pa.ratings.easy.games, 1);
  assert.equal(pa.ratings.easy.wins, 1);
  assert.ok(pa.ratings.easy.rating > 1500);
  assert.equal(pa.recent[0].result, 'win');
  assert.ok(pa.bestTimes.easy > 0);
  assert.equal(pa.streak, 1);
  const pb = (await api('/api/profile/racer_b')).data;
  assert.equal(pb.ratings.easy.losses, 1);
  assert.equal(pa.ratings.easy.rating - 1500, 1500 - pb.ratings.easy.rating);
  assert.equal(pa.ratings.medium.games, 0, 'other difficulties untouched');
  ca.close(); cb.close();
});

test('friend game by link between two guests, with rematch', async () => {
  const h = await client({}), j = await client({});
  h.send({ t: 'room.create', difficulty: 'easy', mistakes: 1 });
  const room = await h.wait(m => m.t === 'room');
  assert.match(room.code, /^[A-Z2-9]{6}$/);
  h.send({ t: 'room.join', code: room.code });
  assert.equal((await h.wait(m => m.t === 'error')).code, 'own-room');
  j.send({ t: 'room.join', code: room.code.toLowerCase() });
  const gj = await j.wait(live);
  assert.equal(gj.kind, 'casual');
  assert.equal(gj.mistakesAllowed, 1);
  await sleep(gj.startAt - gj.serverNow + 50);
  // One mistake with a limit of 1: out, and the host wins.
  const sol = solve(gj.puzzle, 1).first, cell = gj.board.findIndex(x => !x);
  j.send({ t: 'place', cell, digit: sol[cell] % 9 + 1 });
  const over = await h.wait(m => m.t === 'game' && m.status === 'decided');
  assert.equal(over.result.you, 'win');
  assert.equal(over.result.reason, 'mistakes');
  assert.equal(over.ratingChange, null);
  h.send({ t: 'rematch', game: over.id });
  await j.wait(m => m.t === 'game' && m.rematch.opp);
  j.send({ t: 'rematch', game: over.id });
  const next = await j.wait(m => m.t === 'game' && m.id !== over.id && m.status === 'live');
  assert.equal(next.you.index, 0, 'seats swap on rematch');
  h.close(); j.close();
});

test('friends: request, accept, challenge, decline', async () => {
  const x = (await api('/api/register', { method: 'POST', body: { name: 'fox', password: 'password1' } })).data;
  const y = (await api('/api/register', { method: 'POST', body: { name: 'fey', password: 'password1' } })).data;
  assert.equal((await api('/api/friends/add', { method: 'POST', token: x.token, body: { name: 'nobody' } })).status, 404);
  assert.equal((await api('/api/friends/add', { method: 'POST', token: x.token, body: { name: 'fey' } })).data.status, 'pending');
  assert.equal((await api('/api/friends', { token: y.token })).data[0].status, 'incoming');
  const cx = await client({ token: x.token }), cy = await client({ token: y.token });
  cx.send({ t: 'room.create', difficulty: 'medium', mistakes: 3, invite: 'fey' });
  assert.equal((await cx.wait(m => m.t === 'error')).code, 'not-friends');
  assert.equal((await api('/api/friends/accept', { method: 'POST', token: y.token, body: { name: 'fox' } })).status, 200);
  const list = (await api('/api/friends', { token: x.token })).data;
  assert.deepEqual([list[0].name, list[0].status, list[0].online], ['fey', 'friend', true]);
  cx.send({ t: 'room.create', difficulty: 'medium', mistakes: 3, invite: 'fey' });
  const ch = await cy.wait(m => m.t === 'challenge');
  assert.equal(ch.from.name, 'fox');
  cy.send({ t: 'challenge.decline', code: ch.code });
  assert.equal((await cx.wait(m => m.t === 'challenge.declined')).name, 'fey');
  cx.send({ t: 'room.create', difficulty: 'medium', mistakes: 3, invite: 'fey' });
  const ch2 = await cy.wait(m => m.t === 'challenge');
  cy.send({ t: 'room.join', code: ch2.code });
  const g = await cx.wait(live, 8000);
  assert.equal(g.difficulty, 'medium');
  cx.close(); cy.close();
});

test('a second login replaces the first socket', async () => {
  const u = (await api('/api/register', { method: 'POST', body: { name: 'twice', password: 'password1' } })).data;
  const c1 = await client({ token: u.token });
  const c2 = await client({ token: u.token });
  await c1.wait(m => m.t === 'replaced');
  assert.equal(c2.welcome.me.name, 'twice');
  c2.close();
});

test('sign-up is rate limited per address', async () => {
  const small = await createApp({ port: 0, host: '127.0.0.1', dbFile: ':memory:', log: () => {} });
  const url = `http://127.0.0.1:${small.port}/api/register`;
  const codes = [];
  for (let k = 0; k < 6; k++) codes.push((await fetch(url, { method: 'POST', body: JSON.stringify({ name: 'rl' + k, password: 'password1' }) })).status);
  await small.close();
  assert.deepEqual(codes, [201, 201, 201, 201, 201, 429]);
});

test('static files and path traversal', async () => {
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/shared/sudoku.js')).status, 200);
  assert.equal((await fetch(base + '/server/db.js')).status, 404);
  assert.equal((await fetch(base + '/client/../server/db.js')).status, 404);
  assert.equal((await fetch(base + '/client/%2e%2e/server/db.js')).status, 404);
});
