// Plays the real Android app in an emulator: a live friend race against a scripted opponent.
// Run by CI (.github/workflows/apps.yml, job android-emulator) with the server on the host at
// :8080 and an APK built with SERVER_URL=http://10.0.2.2:8080 (the emulator's name for the host).
//   adb install -r <apk> && node test/android.mjs <screenshot dir>
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import WebSocket from 'ws';
import { solve } from '../shared/sudoku.js';
const { _android: android } = createRequire(import.meta.url)('playwright');

const [shots = 'android-shots'] = process.argv.slice(2);
// Never hang CI: a stuck step fails the run instead.
setTimeout(() => { console.error('FAILED: timed out'); process.exit(1); }, 8 * 60e3).unref();
const PKG = 'com.hugolofgrens.sudokubattles';
mkdirSync(shots, { recursive: true });
const check = (ok, msg) => { if (!ok) throw new Error('FAILED: ' + msg); console.log('ok -', msg); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const [device] = await android.devices();
check(!!device, 'emulator found: ' + device.model());
await device.shell(`am start -n ${PKG}/.MainActivity`);
const page = await (await device.webView({ pkg: PKG }, { timeout: 60000 })).page();
const shot = async name => { await sleep(600); await device.screenshot({ path: `${shots}/${name}.png` }); };

try {
  await page.waitForFunction(() => document.querySelector('#me-name').textContent.startsWith('Guest'), null, { timeout: 60000 });
  check(true, 'app connected to the server as ' + await page.textContent('#me-name'));
  await shot('1-home');

  await page.click('[data-pref="friendDiff"] [data-v="medium"]');
  await page.click('#make-link');
  await page.waitForSelector('#room-url');
  const code = (await page.inputValue('#room-url')).split('#r=')[1];
  check(/^[A-Z0-9]{6}$/.test(code), 'game link made: ' + code);
  await shot('2-link');

  // The opponent: a plain WebSocket client that fills one right cell every 1.5 s.
  const bot = new WebSocket('ws://127.0.0.1:8080/ws');
  let botGame = null;
  bot.on('message', raw => {
    const m = JSON.parse(raw);
    if (m.t === 'welcome') bot.send(JSON.stringify({ t: 'room.join', code }));
    if (m.t === 'game' && !botGame && m.status === 'live') botGame = m;
  });
  await page.waitForFunction(() => !document.querySelector('#board').classList.contains('locked'), null, { timeout: 30000 });
  check(true, 'race started on the phone');
  const sol = solve(botGame.puzzle, 1).first;
  const empties = botGame.puzzle.map((x, i) => (x ? -1 : i)).filter(i => i >= 0);
  let k = 0;
  const botTimer = setInterval(() => { if (k < 12) bot.send(JSON.stringify({ t: 'place', cell: empties[k], digit: sol[empties[k++]] })); }, 1500);

  // The phone player taps cells and numbers like a person would.
  const tap = async i => { await page.click(`#board .c:nth-child(${i + 1})`); await page.click(`#pad button:nth-child(${sol[i]})`); };
  for (const i of empties.slice(0, 8)) await tap(i);
  await page.click(`#board .c:nth-child(${empties[9] + 1})`);            // a pressed cell: gray row, column, box
  await page.waitForFunction(() => /^[1-9]\d*\//.test(document.querySelector('#bar-opp .side').textContent));
  check(true, 'phone shows the opponent progress live');
  await shot('3-race');

  for (const i of empties.slice(8)) await tap(i);
  await page.waitForSelector('#sheet.show h1.win', { timeout: 30000 });
  check(true, 'phone player solved it first and won');
  await shot('4-win');
  clearInterval(botTimer); bot.close();

  await page.click('#r-home');
  await page.click('[data-pref="soloDiff"] [data-v="extreme"]');
  await page.click('#solo-new');
  await page.waitForFunction(() => !document.querySelector('#overlay').classList.contains('show'), null, { timeout: 30000 });
  check(true, 'solo extreme puzzle generated on the phone');
  await shot('5-solo-extreme');
  console.log('ANDROID PASSED');
} catch (e) {
  await device.screenshot({ path: `${shots}/failure.png` }).catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await device.close().catch(() => {});
  process.exit(process.exitCode || 0);
}
