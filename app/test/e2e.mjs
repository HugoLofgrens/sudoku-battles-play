// Drives the real client in Chromium: two guests by link, then two accounts in ranked.
// Usage: npm run e2e  (screenshots go to $SHOTS or ./e2e-shots)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');   // the preinstalled copy, found through NODE_PATH
import { mkdirSync } from 'node:fs';
import { createApp } from '../server/app.js';
import { solve } from '../shared/sudoku.js';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const SHOTS = process.env.SHOTS || 'e2e-shots';
mkdirSync(SHOTS, { recursive: true });
const app = await createApp({ port: 0, host: '127.0.0.1', dbFile: ':memory:', log: () => {}, limitScale: 100 });
const base = `http://127.0.0.1:${app.port}/`;
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: false };
const errors = [];
async function page(name) {
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(name + ': ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(name + ': ' + m.text()); });
  return p;
}
const check = (cond, msg) => { if (!cond) throw new Error('FAILED: ' + msg); console.log('ok -', msg); };
const boardOf = p => p.$$eval('#board .c', cs => cs.map(c => (c.querySelector('.n') ? 0 : +c.textContent || 0)));
async function waitLive(p) { await p.waitForSelector('#s-game:not([hidden])'); await p.waitForFunction(() => !document.querySelector('#overlay').classList.contains('show'), null, { timeout: 8000 }); }
async function fill(p, solution, cells, pause = 80) {
  for (const i of cells) {
    await p.click(`#board .c:nth-child(${i + 1})`);
    await p.click(`#pad button:nth-child(${solution[i]})`);
    await p.waitForTimeout(pause);
  }
}

try {
  // ---- friend game by link, two guests ----
  const a = await page('A'), b = await page('B');
  await a.goto(base); await b.goto(base);
  await a.waitForFunction(() => document.querySelector('#me-name').textContent.startsWith('Guest'));
  check(await a.isDisabled('#find'), 'guests cannot press Find opponent');
  await a.screenshot({ path: SHOTS + '/1-home-guest.png' });
  await a.click('[data-pref="friendDiff"] [data-v="easy"]');
  await a.click('[data-pref="friendMistakes"] [data-v="3"]');
  await a.click('#make-link');
  await a.waitForSelector('#room-url');
  await a.screenshot({ path: SHOTS + '/2-link.png' });
  const url = await a.inputValue('#room-url');
  await b.goto(url);
  await waitLive(a); await waitLive(b);
  check(true, 'both players are in the race after opening the link');
  const start = await boardOf(a);
  const sol = solve(start, 1).first;
  const empties = start.map((x, i) => (x ? -1 : i)).filter(i => i >= 0);

  // B: one right, one wrong.
  await fill(b, sol, [empties[0]]);
  const wrongCell = empties[1];
  await b.click(`#board .c:nth-child(${wrongCell + 1})`);
  await b.click(`#pad button:nth-child(${sol[wrongCell] % 9 + 1})`);
  await a.waitForFunction(() => document.querySelector('#bar-opp .mis').textContent.includes('✕'));
  check(true, "A sees B's mistake");
  await a.waitForFunction(() => /^1\//.test(document.querySelector('#bar-opp .side').textContent));
  check(true, "A sees B's progress (1 cell)");

  await fill(a, sol, empties.slice(0, 20));
  await a.screenshot({ path: SHOTS + '/3-race.png' });
  await fill(a, sol, empties.slice(20));
  await a.waitForSelector('#sheet.show h1.win');
  check(true, 'A wins and sees the result sheet');
  await a.screenshot({ path: SHOTS + '/4-win.png' });
  await b.waitForSelector('#sheet.show #r-go');
  check(true, 'B is asked to keep going or stop');
  await b.screenshot({ path: SHOTS + '/5-loss-keep-going.png' });
  await b.click('#r-go');
  await fill(b, sol, empties.slice(2).concat([empties[1]]), 40);
  await b.waitForSelector('#sheet.show #r-again');
  check(/\d+:\d\d/.test(await b.textContent('#sheet .vs')), 'B finishes and gets their own time');
  await b.click('#r-again');
  await a.waitForSelector('#sheet.show #r-again:not([disabled])');
  await a.click('#r-again');
  await a.waitForFunction(() => !document.querySelector('#sheet').classList.contains('show'));
  await waitLive(a);
  check(true, 'rematch starts a new race');
  await a.close(); await b.close();

  // ---- accounts, ranked ----
  const c = await page('C'), d = await page('D');
  for (const [p, name] of [[c, 'cleo'], [d, 'dane']]) {
    await p.goto(base);
    await p.click('[data-tab="profile"]');
    await p.click('#auth-mode [data-v="register"]');
    await p.fill('#auth-name', name); await p.fill('#auth-pass', 'password123');
    await p.click('#auth-go');
    await p.waitForFunction(n => document.querySelector('#me-name').textContent === n, name);
  }
  check(true, 'two accounts registered through the UI');
  await c.click('#pick-color [data-c="3"]'); await c.click('#pick-theme [data-v="paper"]');
  await c.screenshot({ path: SHOTS + '/6-profile.png' });
  // Friend request and accept.
  await c.click('[data-tab="friends"]');
  await c.fill('#friend-name', 'dane'); await c.click('#friend-add');
  await d.click('[data-tab="friends"]');
  await d.waitForSelector('[data-faccept="cleo"]', { timeout: 12000 });
  await d.click('[data-faccept="cleo"]');
  await c.waitForSelector('[data-fchallenge="dane"].main', { timeout: 12000 });
  check(true, 'friend request accepted, dane shows as online');
  await c.screenshot({ path: SHOTS + '/7-friends.png' });

  for (const p of [c, d]) { await p.click('[data-tab="play"]'); await p.click('[data-pref="rankedDiff"] [data-v="easy"]'); await p.click('#find'); }
  await c.waitForSelector('#q-time');
  await waitLive(c); await waitLive(d);
  check(/\d/.test(await c.textContent('#bar-opp .rt')), 'ranked race shows ratings');
  const s2 = await boardOf(d), sol2 = solve(s2, 1).first;
  const e2 = s2.map((x, i) => (x ? -1 : i)).filter(i => i >= 0);
  await fill(d, sol2, e2.slice(0, 15));
  await c.screenshot({ path: SHOTS + '/8-ranked-race.png' });
  await fill(d, sol2, e2.slice(15));
  await d.waitForSelector('#sheet.show h1.win');
  const rt = await d.textContent('#sheet');
  check(/Rating \d+\?? \(\+\d+\)/.test(rt), 'winner sees a rating gain: ' + rt.match(/Rating[^)]*\)/)[0]);
  await d.screenshot({ path: SHOTS + '/9-ranked-win.png' });
  await c.waitForSelector('#sheet.show #r-stop');
  await c.click('#r-stop');
  await c.waitForSelector('#sheet.show #r-home');
  check(/\(-\d+\)/.test(await c.textContent('#sheet')), 'loser sees a rating loss');
  await c.click('#r-home');
  await c.click('[data-tab="profile"]');
  await c.waitForFunction(() => document.querySelector('#p-recent').textContent.includes('dane'));
  check(true, 'loss appears in recent games');

  // ---- solo ----
  const s = await page('S');
  await s.goto(base);
  await s.click('[data-pref="soloDiff"] [data-v="hard"]');
  await s.click('#solo-new');
  await s.waitForFunction(() => !document.querySelector('#overlay').classList.contains('show'), null, { timeout: 15000 });
  check((await boardOf(s)).filter(Boolean).length > 17, 'solo hard puzzle generated in a worker');
  await s.screenshot({ path: SHOTS + '/10-solo.png' });

  // ---- the app build: client served from another origin, talking to the server ----
  const www = new URL('../mobile/www/', import.meta.url).pathname;
  execFileSync('node', [new URL('../mobile/build.mjs', import.meta.url).pathname], { env: { ...process.env, SERVER_URL: base.slice(0, -1), PUBLIC_URL: 'https://play.example/' } });
  const shell = http.createServer(async (req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    try { const data = await readFile(join(www, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'Content-Type': extname(path) === '.js' ? 'text/javascript' : 'text/html' }); res.end(data); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => shell.listen(0, '127.0.0.1', r));
  const m = await page('M');
  await m.goto(`http://127.0.0.1:${shell.address().port}/`);
  await m.waitForFunction(() => document.querySelector('#me-name').textContent.startsWith('Guest'));
  await m.click('[data-tab="profile"]');
  await m.fill('#auth-name', 'cleo'); await m.fill('#auth-pass', 'password123'); await m.click('#auth-go');
  await m.waitForFunction(() => document.querySelector('#me-name').textContent === 'cleo');
  await m.click('[data-tab="play"]'); await m.click('#make-link');
  await m.waitForSelector('#room-url');
  check((await m.inputValue('#room-url')).startsWith('https://play.example/#r='), 'app build reaches the server cross-origin, logs in, shares a web link');
  shell.close();

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  console.log('E2E PASSED');
} catch (e) {
  console.error(e.message);
  if (errors.length) console.error('page errors:', errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  await app.close();
}
