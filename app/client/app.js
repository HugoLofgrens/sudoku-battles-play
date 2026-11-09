import { Board } from '/client/board.js';
import { SERVER_URL, PUBLIC_URL } from '/client/config.js';
import { settings, setSetting, applySettings, ACCENTS, CELL_STYLES, FONTS } from '/client/settings.js';
import { sfx, feel } from '/client/sound.js';
import { animate, sweep, confetti } from '/client/fx.js';
import { lineChart } from '/client/charts.js';
import { AVATAR_SYMBOLS, AVATAR_COLORS, THEMES, cleanAvatar, cleanTheme } from '/shared/looks.js';
import { tierOf } from '/shared/tiers.js';
import { ticker } from '/shared/facts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('sb-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('sb-' + k); else localStorage.setItem('sb-' + k, JSON.stringify(v)); } catch {} }
};
const DIFFS = [['medium', 'Medium'], ['hard', 'Hard'], ['extreme', 'Extreme']];
const diffName = d => (DIFFS.find(x => x[0] === d) || [, d])[1];
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ratingText = r => r ? r.rating + (r.provisional ? '?' : '') : '';
const tierBadge = (rating, provisional) => { const t = tierOf(rating, provisional); return `<span class="tier" style="--tc:${t.color}">${t.name}</span>`; };
const avatarHtml = (a, big) => { a = cleanAvatar(a); return `<span class="av${big ? ' big' : ''}" style="background:${AVATAR_COLORS[a.c]}">${AVATAR_SYMBOLS[a.s]}</span>`; };
function paintAvatar(el, a) { a = cleanAvatar(a); el.style.background = AVATAR_COLORS[a.c]; el.textContent = AVATAR_SYMBOLS[a.s]; }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const SEGS = {
  rankedDiff: DIFFS, friendDiff: DIFFS, soloDiff: DIFFS, boardDiff: DIFFS, histDiff: DIFFS, timesDiff: DIFFS,
  friendMistakes: [[1, '1 mistake'], [3, '3 mistakes'], [5, '5 mistakes']],
  rankKind: [['rating', 'Rating'], ['fastest', 'Fastest'], ['median', 'Median'], ['daily', 'Daily']],
  rankPeriod: [['all', 'All time'], ['week', 'This week']]
};
// Saved choices from an older version (e.g. the removed easy tier) fall back to the default.
function fixPrefs(p) {
  const def = { rankedDiff: 'medium', friendDiff: 'medium', friendMistakes: 3, soloDiff: 'medium', boardDiff: 'medium', histDiff: 'medium', timesDiff: 'medium', rankKind: 'rating', rankPeriod: 'all' };
  for (const k of Object.keys(def)) if (!SEGS[k].some(o => o[0] === p[k])) p[k] = def[k];
  return p;
}

// ---------- state ----------
const S = {
  token: store.get('token'), guestToken: store.get('guest'), me: null, ws: null, retry: 0,
  offset: 0, view: null, mode: 'menu', tab: 'play', keepGoing: null, queued: null, room: null,
  challenge: null, friends: [], soloStart: 0, solo: null, daily: null, dailyInfo: null, profile: null,
  prefs: fixPrefs(store.get('prefs', {})),
  look: { avatar: cleanAvatar(store.get('look', {}).avatar), theme: cleanTheme(store.get('look', {}).theme) },
  pendingJoin: (/^#r=([A-Za-z0-9]{6})$/.exec(location.hash) || [])[1] || null
};
const serverNow = () => Date.now() + S.offset;

// The browser version talks to the site it came from. The phone apps need an address: built in
// (SERVER_URL), or typed in, e.g. the computer on your Wi-Fi running the server.
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const normServer = u => { u = String(u || '').trim().replace(/\/+$/, ''); return !u ? '' : /^https?:\/\//i.test(u) ? u : 'http://' + u; };
let SERVER = normServer(store.get('server') || SERVER_URL);
const shareBase = () => (store.get('server') ? SERVER + '/' : PUBLIC_URL || (NATIVE ? SERVER + '/' : location.origin + location.pathname));

// ---------- network ----------
function connect() {
  renderServer();
  if (NATIVE && !SERVER) return;
  let ws;
  try { ws = new WebSocket(SERVER ? SERVER.replace(/^http/, 'ws') + '/ws' : (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'); }
  catch { S.online = false; renderServer(); return; }
  S.ws = ws;
  ws.onopen = () => { S.retry = 0; S.online = true; renderServer(); ws.send(JSON.stringify({ t: 'hello', token: S.token || undefined, guest: S.token ? undefined : S.guestToken || undefined })); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } on[m.t]?.(m); };
  ws.onclose = ev => {
    if (S.ws !== ws) return;
    S.ws = null; S.online = false;
    if (ev.code === 4000) return;                   // replaced by another tab; it shows its own sheet
    if (S.mode !== 'menu') setStatus('Reconnecting…');
    $('me-name').textContent = 'Connecting…'; renderServer();
    setTimeout(connect, Math.min(8000, 500 * 2 ** S.retry++));
  };
}
const send = m => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); else toast('Not connected yet.'); };
function reconnect() { if (S.ws) { const w = S.ws; S.ws = null; w.close(); } connect(); }

async function api(path, body) {
  const r = await fetch(SERVER + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

const on = {
  welcome(m) {
    S.me = m.me; S.offset = m.serverNow - Date.now();
    if (m.guestToken) { S.guestToken = m.guestToken; store.set('guest', m.guestToken); }
    if (!m.me.guest) { S.look = { avatar: cleanAvatar(m.me.avatar), theme: cleanTheme(m.me.theme) }; store.set('look', S.look); }
    applyLook(); renderMe(); renderPlay(); loadDaily();
    if (S.tab === 'friends') loadFriends();
    if (S.tab === 'profile') loadProfile();
    if (S.tab === 'ranks') loadRanks();
    if (!m.me.guest) loadFriends(true);
    setStatus('');
    if (S.pendingJoin) { send({ t: 'room.join', code: S.pendingJoin }); S.pendingJoin = null; history.replaceState(null, '', location.pathname); }
  },
  error(m) {
    if (m.code === 'bad-token') { S.token = null; store.set('token', null); reconnect(); return; }
    toast(m.message);
  },
  replaced() {
    showSheet(`<h2>Open in another tab</h2><p class="dim">You opened Sudoku Battles somewhere else.</p><button class="main" id="use-here">Use it here</button>`);
    $('use-here').onclick = () => { closeSheet(); connect(); };
  },
  queued(m) { S.queued = m; showSearching(); },
  unqueued() { S.queued = null; closeSheet(); },
  room(m) { S.room = m; showRoom(); },
  'room.closed'() { S.room = null; closeSheet(); },
  challenge(m) { S.challenge = m; showChallenge(); },
  'challenge.gone'(m) { if (S.challenge && S.challenge.code === m.code) { S.challenge = null; closeSheet(); toast('The challenge was cancelled.'); } },
  'challenge.declined'(m) { S.room = null; closeSheet(); toast(`${m.name} declined.`); },
  friends() { loadFriends(S.tab !== 'friends'); },
  game(v) { onGame(v); },
  placed(m) { if (S.mode === 'race') board.placed(m.cell, m.digit, m.ok); },
  daily(v) { onDaily(v); },
  'daily.placed'(m) { if (S.mode === 'daily') board.placed(m.cell, m.digit, m.ok); },
  'daily.done'(m) { showDailyDone(m); },
  pong(m) { S.offset = m.serverNow - Date.now(); }
};

// ---------- server address (apps only) ----------
function renderServer() {
  $('server-card').hidden = !NATIVE;
  if (!NATIVE) return;
  $('server-info').textContent = !SERVER ? 'Type the address the server shows on the computer running it. Solo works without one.'
    : S.online ? 'Connected to ' + SERVER : 'Trying to reach ' + SERVER + '…';
  if (document.activeElement !== $('server-addr')) $('server-addr').value = SERVER.replace(/^http:\/\//, '');
}
$('server-go').onclick = () => {
  SERVER = normServer($('server-addr').value);
  store.set('server', SERVER || null);
  S.me = null; reconnect();
};
$('server-addr').onkeydown = e => { if (e.key === 'Enter') $('server-go').click(); };

// ---------- look and settings ----------
function applyLook() {
  const t = THEMES[S.look.theme], r = document.documentElement.style;
  const map = { bg: 'bg', cell: 'cell', line: 'line', thick: 'thick', given: 'given', user: 'user', note: 'note', hi: 'hi', hiInk: 'hi-ink', peer: 'peer', dead: 'dead', panel: 'panel', sel: 'sel', opp: 'opp' };
  for (const [k, v] of Object.entries(map)) r.setProperty('--' + v, t[k]);
  document.querySelector('meta[name=theme-color]').content = t.bg;
  applySettings();
}
async function setLook(change) {
  S.look = { ...S.look, ...change };
  store.set('look', S.look);
  applyLook(); renderMe(); renderLookPickers();
  if (S.me && !S.me.guest) { try { S.me = { ...S.me, ...(await api('/api/me/look', S.look)) }; } catch (e) { toast(e.message); } }
}
function renderLookPickers() {
  $('pick-symbol').innerHTML = AVATAR_SYMBOLS.map((s, i) => `<button data-s="${i}" class="${i === S.look.avatar.s ? 'on' : ''}" style="background:${AVATAR_COLORS[S.look.avatar.c]};color:#111">${s}</button>`).join('');
  $('pick-color').innerHTML = AVATAR_COLORS.map((c, i) => `<button data-c="${i}" class="${i === S.look.avatar.c ? 'on' : ''}" style="background:${c}"></button>`).join('');
  $('pick-theme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<button data-v="${k}" class="${k === S.look.theme ? 'on' : ''}">${t.name}</button>`).join('');
  $('pick-accent').innerHTML = Object.entries(ACCENTS).map(([k, a]) => `<button data-a="${k}" class="${k === settings.accent ? 'on' : ''}" style="background:${a.hi}" title="${a.name}"></button>`).join('');
  $('pick-cells').innerHTML = Object.entries(CELL_STYLES).map(([k, n]) => `<button data-v="${k}" class="${k === settings.cellStyle ? 'on' : ''}">${n}</button>`).join('');
  $('pick-font').innerHTML = Object.entries(FONTS).map(([k, f]) => `<button data-v="${k}" class="${k === settings.font ? 'on' : ''}" style="font-family:${f.css}">${f.name}</button>`).join('');
  for (const [id, k] of [['set-sound', 'sound'], ['set-vibrate', 'vibrate'], ['set-counts', 'padCounts']]) $(id).setAttribute('aria-pressed', settings[k]);
}
$('pick-symbol').onclick = e => { const b = e.target.closest('[data-s]'); if (b) setLook({ avatar: { ...S.look.avatar, s: +b.dataset.s } }); };
$('pick-color').onclick = e => { const b = e.target.closest('[data-c]'); if (b) setLook({ avatar: { ...S.look.avatar, c: +b.dataset.c } }); };
$('pick-theme').onclick = e => { const b = e.target.closest('[data-v]'); if (b) setLook({ theme: b.dataset.v }); };
$('pick-accent').onclick = e => { const b = e.target.closest('[data-a]'); if (b) { setSetting('accent', b.dataset.a); renderLookPickers(); } };
$('pick-cells').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { setSetting('cellStyle', b.dataset.v); renderLookPickers(); } };
$('pick-font').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { setSetting('font', b.dataset.v); renderLookPickers(); } };
for (const [id, k] of [['set-sound', 'sound'], ['set-vibrate', 'vibrate'], ['set-counts', 'padCounts']]) {
  $(id).onclick = () => { setSetting(k, !settings[k]); renderLookPickers(); if (k === 'sound' && settings.sound) sfx('place'); };
}

// ---------- the rotating line: facts and tips ----------
const lines = ticker();
let lineAt = 0;
function showLine() {
  const text = lines[lineAt++ % lines.length];
  for (const el of document.querySelectorAll('.ticker')) {
    el.classList.add('fade');
    setTimeout(() => { el.textContent = text; el.classList.remove('fade'); }, 400);
  }
}
setInterval(showLine, 8000);

// ---------- menus ----------
function renderSegs() {
  for (const el of document.querySelectorAll('[data-pref]')) {
    const k = el.dataset.pref;
    el.innerHTML = SEGS[k].map(([v, label]) => `<button data-v="${v}" class="${S.prefs[k] === v ? 'on' : ''}">${label}</button>`).join('');
  }
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-pref] [data-v]');
  if (!b) return;
  const k = b.closest('[data-pref]').dataset.pref, raw = b.dataset.v;
  S.prefs[k] = typeof SEGS[k][0][0] === 'number' ? +raw : raw;
  store.set('prefs', S.prefs);
  renderSegs(); renderPlay();
  if (['boardDiff', 'rankKind', 'rankPeriod'].includes(k)) loadRanks();
  if (k === 'histDiff' || k === 'timesDiff') renderProfileDetail();
});

function renderMe() {
  if (!S.me) return;
  paintAvatar(document.querySelector('#me-chip .av'), S.look.avatar);
  $('me-name').textContent = S.me.name;
}
function renderPlay() {
  const guest = !S.me || S.me.guest;
  $('find').disabled = guest;
  const r = S.me?.ratings?.[S.prefs.rankedDiff];
  $('ranked-info').innerHTML = guest || !r ? 'Log in to play ranked against anyone.'
    : `${tierBadge(r.rating, r.provisional)} <b>${ratingText(r)}</b> ${diffName(S.prefs.rankedDiff)}${r.provisional ? ' · placement games' : ''}. Bigger wins, bigger gains.`;
  $('solo-continue').hidden = !store.get('solo');
}
const TABS = ['play', 'ranks', 'friends', 'profile'];
function showTab(tab) {
  S.tab = tab;
  for (const t of TABS) $('s-' + t).hidden = t !== tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  if (tab === 'friends') loadFriends();
  if (tab === 'profile') loadProfile();
  if (tab === 'ranks') loadRanks();
  if (tab === 'play') { renderPlay(); loadDaily(); }
}
document.querySelector('#tabs').onclick = e => { const b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab); };
document.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) showTab(b.dataset.go); });
$('me-chip').onclick = () => showTab('profile');

$('find').onclick = () => send({ t: 'queue', difficulty: S.prefs.rankedDiff });
$('make-link').onclick = () => send({ t: 'room.create', difficulty: S.prefs.friendDiff, mistakes: S.prefs.friendMistakes });
$('join').onclick = () => {
  const code = $('join-code').value.trim().toUpperCase().replace(/^.*#R=/, '');
  if (!/^[A-Z0-9]{6}$/.test(code)) return toast('A code is 6 letters and numbers.');
  send({ t: 'room.join', code });
};
$('join-code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };

// ---------- sheets ----------
function showSheet(html) { $('sheet-card').innerHTML = html; $('sheet').classList.add('show'); }
function closeSheet() { $('sheet').classList.remove('show'); }
let toastTimer;
function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 3000); }
function setStatus(text) { if (S.mode !== 'menu') $('status-line').textContent = text; else if (text) toast(text); }
const tickerHtml = () => `<p class="ticker">${esc(lines[(lineAt + lines.length - 1) % lines.length])}</p>`;

function showSearching() {
  const q = S.queued;
  showSheet(`<h2>Finding an opponent</h2><div class="spin"></div>
    <p class="dim" style="text-align:center">${diffName(q.difficulty)} · ${ratingText(q.rating)} · <span id="q-time">0:00</span></p>
    ${tickerHtml()}<button id="q-cancel">Cancel</button>`);
  $('q-cancel').onclick = () => send({ t: 'unqueue' });
}
function showRoom() {
  const r = S.room, url = shareBase() + '#r=' + r.code;
  const rules = `${diffName(r.rules.difficulty)} · ${plural(r.rules.mistakes, 'mistake')}`;
  if (r.invite) {
    showSheet(`<h2>Waiting for ${esc(r.invite)}</h2><div class="spin"></div><p class="dim" style="text-align:center">${rules}</p>${tickerHtml()}<button id="room-cancel">Cancel</button>`);
  } else {
    showSheet(`<h2>Send this to a friend</h2><p class="dim">${rules}. The game starts when they open it.</p>
      <p class="big" style="text-align:center;letter-spacing:4px">${r.code}</p>
      <input id="room-url" readonly value="${esc(url)}">
      <div class="row">${navigator.share ? '<button id="room-share" class="main">Share</button>' : ''}<button id="room-copy" ${navigator.share ? '' : 'class="main"'}>Copy link</button></div>
      ${tickerHtml()}<button id="room-cancel" class="ghost">Cancel</button>`);
    $('room-copy').onclick = () => copy(url, $('room-copy'));
    if ($('room-share')) $('room-share').onclick = () => navigator.share({ title: 'Sudoku Battles', text: 'Race me at sudoku', url }).catch(() => {});
  }
  $('room-cancel').onclick = () => send({ t: 'room.cancel' });
}
function copy(text, btn) {
  const done = () => { btn.textContent = 'Copied'; };
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() { const i = $('room-url'); i.select(); try { if (document.execCommand('copy')) done(); } catch {} }
}
function showChallenge() {
  const c = S.challenge;
  showSheet(`<div class="row" style="justify-content:flex-start;gap:12px">${avatarHtml(c.from.avatar, true)}<div style="flex:1"><h2>${esc(c.from.name)} challenges you</h2>
    <p class="dim">${diffName(c.rules.difficulty)} · ${plural(c.rules.mistakes, 'mistake')}</p></div></div>
    <div class="row"><button id="ch-no">Decline</button><button id="ch-yes" class="main">Accept</button></div>`);
  $('ch-yes').onclick = () => { send({ t: 'room.join', code: c.code }); S.challenge = null; closeSheet(); };
  $('ch-no').onclick = () => { send({ t: 'challenge.decline', code: c.code }); S.challenge = null; closeSheet(); };
}

// ---------- friends ----------
async function loadFriends(quiet) {
  const guest = !S.me || S.me.guest;
  $('friends-guest').hidden = !guest; $('friends-acct').hidden = guest;
  if (guest) { $('friends-badge').hidden = true; return; }
  try { S.friends = await api('/api/friends'); } catch (e) { if (!quiet) toast(e.message); return; }
  const inc = S.friends.filter(f => f.status === 'incoming');
  $('friends-badge').hidden = !inc.length; $('friends-badge').textContent = inc.length;
  $('incoming-card').hidden = !inc.length;
  $('incoming').innerHTML = inc.map(f => `<div class="item">${avatarHtml(f.avatar)}<span class="grow">${esc(f.name)}</span>
    <button data-fdecline="${esc(f.name)}" class="ghost">Decline</button><button data-faccept="${esc(f.name)}" class="main">Accept</button></div>`).join('');
  const rest = S.friends.filter(f => f.status !== 'incoming').sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
  $('friends-empty').hidden = rest.length > 0;
  $('friends').innerHTML = rest.map(f => f.status === 'outgoing'
    ? `<div class="item">${avatarHtml(f.avatar)}<span class="grow">${esc(f.name)}</span><span class="dim">Request sent</span><button data-fremove="${esc(f.name)}" class="ghost">Cancel</button></div>`
    : `<div class="item"><span class="dot ${f.playing ? 'play' : f.online ? 'on' : ''}"></span>${avatarHtml(f.avatar)}<span class="grow">${esc(f.name)}<br><span class="dim">${f.playing ? 'In a game' : f.online ? 'Online' : 'Offline'}</span></span>
       <button data-fchallenge="${esc(f.name)}" ${f.online && !f.playing ? 'class="main"' : 'disabled'}>Challenge</button><button data-fremove="${esc(f.name)}" class="ghost" title="Remove">✕</button></div>`).join('');
}
$('friend-add').onclick = async () => {
  const name = $('friend-name').value.trim();
  $('friend-err').textContent = '';
  if (!name) return;
  try { const r = await api('/api/friends/add', { name }); $('friend-name').value = ''; toast(r.status === 'accepted' ? `You and ${name} are friends.` : `Request sent to ${name}.`); loadFriends(); }
  catch (e) { $('friend-err').textContent = e.message; }
};
$('friend-name').onkeydown = e => { if (e.key === 'Enter') $('friend-add').click(); };
$('s-friends').addEventListener('click', async e => {
  const b = e.target.closest('button');
  if (!b) return;
  try {
    if (b.dataset.faccept) { await api('/api/friends/accept', { name: b.dataset.faccept }); loadFriends(); }
    else if (b.dataset.fdecline) { await api('/api/friends/remove', { name: b.dataset.fdecline }); loadFriends(); }
    else if (b.dataset.fremove) { if (confirm(`Remove ${b.dataset.fremove}?`)) { await api('/api/friends/remove', { name: b.dataset.fremove }); loadFriends(); } }
    else if (b.dataset.fchallenge) pickChallenge(b.dataset.fchallenge);
  } catch (err) { toast(err.message); }
});
function pickChallenge(name) {
  showSheet(`<h2>Challenge ${esc(name)}</h2><div class="seg" data-pref="friendDiff"></div><div class="seg" data-pref="friendMistakes"></div>
    <div class="row"><button id="pc-cancel" class="ghost">Cancel</button><button id="pc-go" class="main">Send challenge</button></div>`);
  renderSegs();
  $('pc-cancel').onclick = closeSheet;
  $('pc-go').onclick = () => send({ t: 'room.create', difficulty: S.prefs.friendDiff, mistakes: S.prefs.friendMistakes, invite: name });
}
setInterval(() => { if (S.tab === 'friends' && S.mode === 'menu' && S.me && !S.me.guest) loadFriends(true); }, 10000);

// ---------- ranks ----------
async function loadRanks() {
  const kind = S.prefs.rankKind, daily = kind === 'daily', times = kind === 'fastest' || kind === 'median';
  $('ranks-diff').hidden = daily; $('ranks-period').hidden = !times;
  const d = S.prefs.boardDiff, period = S.prefs.rankPeriod;
  let rows = [], note = '';
  try {
    if (kind === 'rating') { rows = (await api('/api/leaderboard/' + d)).map(r => ({ ...r, value: `<b>${r.rating}${r.provisional ? '?' : ''}</b>`, extra: tierBadge(r.rating, r.provisional) })); note = '? = still in placement games.'; }
    else if (times) {
      rows = (await api(`/api/times/${d}?kind=${kind}&period=${period}`)).map(r => ({ ...r, value: `<b>${clock(r.time)}</b>`, extra: r.solves ? `<span class="dim">${r.solves} solves</span>` : '' }));
      note = kind === 'fastest' ? 'Best single solve, timed by the server.' : `Typical time (median). Needs ${period === 'week' ? 5 : 10} solves.`;
    } else {
      const info = S.dailyInfo = await api('/api/daily');
      rows = info.board.map(r => ({ ...r, value: `<b>${clock(r.time)}</b>`, extra: r.mistakes ? `<span class="dim">${plural(r.mistakes, 'mistake')}</span>` : '' }));
      note = `Daily #${info.number} · ${diffName(info.difficulty)} · ${info.solved} solved · resets in ${clock(info.resetsAt - serverNow()).replace(/:\d\d$/, '')} min`;
    }
  } catch (e) { note = e.message; }
  $('ranks-note').textContent = note;
  $('ranks-empty').hidden = rows.length > 0;
  $('ranks-empty').textContent = 'No one here yet. Be the first.';
  const me = S.me?.name;
  $('ranks').innerHTML = rows.map((r, i) => `<div class="item${r.name === me ? ' me' : ''}"><span class="rank-n ${i < 3 ? 'medal-' + (i + 1) : ''}">${i < 3 ? '●' : i + 1}</span>${avatarHtml(r.avatar)}
    <span class="grow">${esc(r.name)} ${r.extra || ''}</span>${r.value}</div>`).join('');
}

// ---------- profile ----------
let authMode = 'login';
$('auth-mode').onclick = e => {
  const b = e.target.closest('[data-v]'); if (!b) return;
  authMode = b.dataset.v;
  for (const x of $('auth-mode').children) x.classList.toggle('on', x === b);
  $('auth-go').textContent = authMode === 'login' ? 'Log in' : 'Create account';
  $('auth-pass').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('auth-err').textContent = '';
};
$('auth-go').onclick = async () => {
  $('auth-err').textContent = '';
  try {
    const r = await api('/api/' + authMode, { name: $('auth-name').value.trim(), password: $('auth-pass').value, avatar: S.look.avatar });
    S.token = r.token; store.set('token', r.token);
    $('auth-pass').value = '';
    if (authMode === 'register') await api('/api/me/look', S.look).catch(() => {});
    reconnect();
  } catch (e) { $('auth-err').textContent = e.message; }
};
$('auth-pass').onkeydown = e => { if (e.key === 'Enter') $('auth-go').click(); };
$('logout').onclick = async () => {
  await api('/api/logout', {}).catch(() => {});
  S.token = null; store.set('token', null); S.me = null; reconnect(); showTab('profile');
};
async function loadProfile() {
  renderLookPickers();
  const guest = !S.me || S.me.guest;
  $('auth-card').hidden = !guest; $('profile-acct').hidden = guest; $('logout').hidden = guest;
  if (guest) return;
  let p;
  try { p = S.profile = await api('/api/profile/' + encodeURIComponent(S.me.name)); } catch (e) { return toast(e.message); }
  S.me.ratings = p.ratings;
  paintAvatar($('p-av'), S.look.avatar);
  $('p-name').textContent = p.name;
  $('p-joined').textContent = 'Joined ' + new Date(p.joined).toLocaleDateString();
  $('p-ratings').innerHTML = DIFFS.map(([d, label]) => { const r = p.ratings[d]; return `<div class="tile"><b>${ratingText(r)}</b><span>${label} · ${r.games} rated</span><br>${tierBadge(r.rating, r.provisional)}</div>`; }).join('');
  $('p-totals').innerHTML = `<div class="tile"><b>${p.totals.wins}/${p.totals.losses}/${p.totals.draws}</b><span>Won/lost/drawn</span></div>
    <div class="tile"><b>${p.streak}</b><span>Win streak</span></div><div class="tile"><b>${p.bestStreak}</b><span>Best streak</span></div>`;
  $('p-norecent').hidden = p.recent.length > 0;
  $('p-recent').innerHTML = p.recent.map(g => {
    const delta = g.ratingAfter != null ? g.ratingAfter - g.ratingBefore : null;
    return `<div class="item"><span class="${g.result}" style="width:44px;font-weight:700">${g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw'}</span>
      <span class="grow">vs ${esc(g.opponent)}<br><span class="dim">${diffName(g.difficulty)} · ${g.kind === 'ranked' ? 'Ranked' : 'Friend'} · ${reasonShort(g.reason)}</span></span>
      <span style="text-align:right">${g.time != null ? clock(g.time) : '–'}<br><span class="dim">${delta == null ? '' : (delta >= 0 ? '+' : '') + delta}</span></span></div>`;
  }).join('');
  renderProfileDetail();
}
function renderProfileDetail() {
  const p = S.profile;
  if (!p) return;
  const hist = p.history[S.prefs.histDiff] || [];
  const pts = [[p.joined, 500], ...hist];
  $('p-chart').innerHTML = hist.length ? lineChart([{ points: pts, color: 'var(--hi)' }], { xFmt: t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), yFmt: v => Math.round(v), step: true })
    : `<p class="dim">Play ranked ${diffName(S.prefs.histDiff).toLowerCase()} to start your graph.</p>`;
  const t = p.times[S.prefs.timesDiff];
  if (!t || !t.count) { $('p-times').innerHTML = `<p class="dim">No ${diffName(S.prefs.timesDiff).toLowerCase()} solves yet. Races and the daily count.</p>`; return; }
  const cell = (v, label) => `<div><b>${v == null ? '–' : clock(v)}</b><span>${label}</span></div>`;
  $('p-times').innerHTML = `<div class="stats">${cell(t.median, 'Median')}${cell(t.mean, 'Average')}${cell(t.best, 'Fastest')}${cell(t.p25, 'Best 25%')}${cell(t.p10, 'Best 10%')}${cell(t.p5, 'Best 5%')}</div>
    <p class="dim">${plural(t.count, 'solve')}. ${t.fasterThan == null ? 'Solve 5 to see how you compare.' : `Your median is faster than <b>${t.fasterThan}%</b> of ${plural(t.of - 1, 'other player')}.`}</p>`;
}
const reasonShort = r => ({ solved: 'solved', mistakes: 'mistakes', resign: 'gave up', disconnect: 'left', timeout: 'time cap' }[r] || r);

// ---------- daily ----------
async function loadDaily() {
  try { S.dailyInfo = await api('/api/daily'); } catch { return; }
  const i = S.dailyInfo, you = i.you;
  $('daily-title').innerHTML = `Daily #${i.number} <span class="dim">· ${diffName(i.difficulty)}</span>`;
  $('daily-info').textContent = you?.status === 'solved' ? `Solved in ${clock(you.time)} · #${you.rank} of ${i.solved}`
    : you && you.status !== 'playing' ? 'Done for today. New puzzle at midnight UTC.'
    : `${i.solved} solved today. One try${S.me?.guest ? ' (log in to get on the board)' : ''}.`;
  $('daily-go').textContent = you && you.status !== 'playing' ? 'Board' : you ? 'Resume' : 'Play';
}
$('daily-go').onclick = () => {
  const you = S.dailyInfo?.you;
  if (you && you.status !== 'playing') { S.prefs.rankKind = 'daily'; store.set('prefs', S.prefs); renderSegs(); return showTab('ranks'); }
  send({ t: 'daily.start' });
};
function onDaily(v) {
  S.offset = v.serverNow - Date.now();
  const fresh = S.mode !== 'daily' || !S.daily || S.daily.day !== v.day;
  if (fresh) { enterGame('daily'); board.load(v.puzzle, v.board); } else board.sync(v.board);
  const was = S.daily?.status;
  S.daily = v;
  board.locked = v.status !== 'playing'; board.render();
  let mis = '';
  for (let k = 0; k < v.mistakesAllowed; k++) mis += k < v.mistakes ? '<span class="x">✕</span>' : '○';
  $('status-line').innerHTML = `Daily #${v.number} · ${diffName(v.difficulty)} · <span class="mis">${mis}</span>`;
  $('t-quit').textContent = v.status === 'playing' ? 'Give up' : 'Home';
  if (v.status !== 'playing' && was !== v.status) showDailyDone(v);
}
async function showDailyDone(v) {
  if (v.status === 'solved') { feel('win'); confetti([getComputedStyle(document.documentElement).getPropertyValue('--hi'), '#ffffff', '#e2b84a', '#6bd68a']); }
  else sfx('lose');
  let rank = '';
  try { const i = S.dailyInfo = await api('/api/daily'); if (i.you?.rank) rank = `#${i.you.rank} of ${i.solved} today`; } catch {}
  const head = { solved: 'Solved', out: 'Out of mistakes', gaveup: 'You gave up', timeout: 'Out of time' }[v.status] || 'Done';
  showSheet(`<h1 class="${v.status === 'solved' ? 'win' : 'loss'}">${head}</h1>
    ${v.status === 'solved' ? `<p class="big">${clock(v.time)}</p><p class="dim">${rank || (S.me?.guest ? 'Log in to get on the daily board.' : '')}</p>` : '<p class="dim">New puzzle at midnight UTC.</p>'}
    ${tickerHtml()}<div class="row"><button id="d-home">Home</button><button id="d-board" class="main">Daily board</button></div>`);
  $('d-home').onclick = leaveGame;
  $('d-board').onclick = () => { leaveGame(); S.prefs.rankKind = 'daily'; store.set('prefs', S.prefs); renderSegs(); showTab('ranks'); };
}

// ---------- game screen ----------
const board = new Board($('board'), $('pad'), {
  onPlace: (i, d) => S.mode === 'race' ? send({ t: 'place', cell: i, digit: d }) : S.mode === 'daily' ? send({ t: 'daily.place', cell: i, digit: d }) : soloPlaced(),
  onChange: () => { if (S.mode === 'solo') saveSolo(); },
  onFx: fx => {
    const el = document.querySelector(`#board .c:nth-child(${fx.cell + 1})`);
    if (fx.type === 'ok') { feel('place'); animate(el, 'popped'); }
    else if (fx.type === 'bad') { feel('wrong'); animate($('wrap'), 'shake'); }
    else if (fx.type === 'house') { feel('house'); sweep(fx.cells, fx.cell); }
    else if (fx.type === 'note') sfx('note');
  }
});
function enterGame(mode) {
  S.mode = mode;
  document.body.classList.add('ingame');
  document.body.classList.toggle('single', mode !== 'race');
  for (const t of TABS) $('s-' + t).hidden = true;
  $('s-game').hidden = false;
  $('t-undo').hidden = mode !== 'solo';
  $('t-quit').textContent = mode === 'solo' ? 'Leave' : 'Give up';
  $('status-line').textContent = '';
  overlay('');
}
function leaveGame() {
  if (S.mode === 'race') send({ t: 'leave' });
  S.mode = 'menu'; S.view = null; S.keepGoing = null; S.daily = null;
  document.body.classList.remove('ingame', 'single');
  $('s-game').hidden = true; closeSheet();
  showTab('play');
  if (S.me && !S.me.guest) refreshMe();
}
// Fresh ratings for the menu after a rated game.
async function refreshMe() { try { S.me = { ...S.me, ...(await api('/api/me')) }; renderPlay(); } catch {} }
function overlay(html, cls = '') { $('overlay').innerHTML = html; $('overlay').className = html ? 'show ' + cls : ''; }

$('t-erase').onclick = () => board.erase();
$('t-undo').onclick = () => board.undo();
$('t-notes').onclick = () => { board.toggleNotes(); $('t-notes').classList.toggle('on', board.noteMode); };
$('t-quit').onclick = () => {
  if (S.mode === 'solo') return leaveGame();
  if (S.mode === 'daily') {
    if (S.daily?.status === 'playing') { if (confirm('Give up today\'s puzzle? You only get one try.')) send({ t: 'daily.giveup' }); }
    else leaveGame();
    return;
  }
  const v = S.view;
  if (!v) return leaveGame();
  if (v.status === 'live' && v.canAbort) { if (confirm('Abort this game? No rating change.')) send({ t: 'abort' }); }
  else if (v.status === 'live' && !v.you.done) { if (confirm('Give up? You lose this game, and it counts as a big loss.')) send({ t: 'resign' }); }
  else if (v.status === 'decided' && !v.you.done) send({ t: 'resign' });
  else leaveGame();
};
document.addEventListener('keydown', e => {
  if (S.mode === 'menu' || $('sheet').classList.contains('show') || e.target.closest?.('input')) return;
  if (board.key(e)) { e.preventDefault(); $('t-notes').classList.toggle('on', board.noteMode); }
});
document.addEventListener('mousedown', e => { if (e.target.closest('#pad,#tools')) e.preventDefault(); });
document.addEventListener('click', e => { if (S.mode !== 'menu' && !e.target.closest('#board,#pad,#tools,#sheet')) board.deselect(); });

function paintBar(el, p, total, mistakesAllowed) {
  paintAvatar(el.querySelector('.av'), p.avatar);
  el.querySelector('.nm').textContent = p.name;
  el.querySelector('.rt').innerHTML = p.rating ? `${ratingText(p.rating)} ${tierBadge(p.rating.rating, p.rating.provisional)}` : '';
  el.querySelector('.prog i').style.width = (100 * p.filled / total) + '%';
  el.classList.toggle('near', !p.done && p.filled / total >= 0.85);
  let mis = '';
  for (let k = 0; k < mistakesAllowed; k++) mis += k < p.mistakes ? '<span class="x">✕</span>' : '○';
  const tail = p.done === 'solved' ? clock(p.time) : p.done === 'out' ? 'Out' : p.done === 'gaveup' ? 'Gave up' : p.done === 'disconnect' ? 'Left' : `${p.filled}/${total}`;
  el.querySelector('.side').innerHTML = `${tail} <span class="mis">${mis}</span>`;
}

function onGame(v) {
  S.offset = v.serverNow - Date.now();
  const fresh = !S.view || S.view.id !== v.id;
  if (fresh) {
    S.queued = null; S.room = null; S.keepGoing = null; S.lastCount = null; closeSheet();
    enterGame('race');
    board.load(v.puzzle, v.board);
  } else board.sync(v.board);
  const before = S.view;
  S.view = v;
  const playing = (v.status === 'live' || v.status === 'decided') && !v.you.done;
  board.locked = !playing || serverNow() < v.startAt;
  board.render();
  paintBar($('bar-opp'), v.opp, v.toFill, v.mistakesAllowed);
  paintBar($('bar-me'), v.you, v.toFill, v.mistakesAllowed);
  $('t-quit').textContent = v.status === 'live' && v.canAbort ? 'Abort' : playing ? (v.status === 'decided' ? 'Stop' : 'Give up') : 'Home';
  $('status-line').textContent = v.status === 'live' && !v.opp.connected ? `${v.opp.name} disconnected` : v.status === 'decided' && playing ? 'Playing on' : '';

  if (v.status === 'aborted') return showAborted(v);
  if (v.status === 'decided' || v.status === 'closed') {
    if (!before?.result && v.result) {
      if (v.result.you === 'win') { feel('win'); confetti([getComputedStyle(document.documentElement).getPropertyValue('--hi'), '#ffffff', '#e2b84a', '#6bd68a']); }
      else sfx('lose');
    }
    if (playing && S.keepGoing === v.id) { closeSheet(); return; }
    showResult(v, playing);
  }
}
function showAborted(v) {
  const why = { 'no-show': 'Your opponent never showed up.', 'left-early': 'A player left before starting.', 'server-restart': 'The server restarted.', aborted: v.result.by === v.you.index ? 'You aborted the game.' : `${v.opp.name} aborted the game.` }[v.result.reason] || 'Game aborted.';
  showSheet(`<h1>Game aborted</h1><p class="dim">${why} No rating change.</p>${resultButtons(v)}`);
  wireResultButtons(v);
}
function reasonLine(v) {
  const youWon = v.result.you === 'win', opp = esc(v.opp.name);
  switch (v.result.reason) {
    case 'solved': return youWon ? 'You solved it first.' : `${opp} solved it first.`;
    case 'mistakes': return youWon ? `${opp} made ${plural(v.mistakesAllowed, 'mistake')}.` : `You made ${plural(v.mistakesAllowed, 'mistake')}.`;
    case 'resign': return youWon ? `${opp} gave up.` : 'You gave up.';
    case 'disconnect': return youWon ? `${opp} left the game.` : 'You were gone too long.';
    case 'timeout': return 'Time cap reached. Most cells filled wins.';
  }
  return '';
}
// Progress over time for both players; red dots are mistakes.
function replayChart(v) {
  if (!v.timeline) return '';
  const series = (moves, color, label) => {
    let n = 0; const points = [[0, 0]], marks = [];
    for (const [t, ok] of moves) { if (ok) points.push([t, ++n]); else marks.push([t, n]); }
    return { points, marks, color, label };
  };
  return lineChart([series(v.timeline.you, 'var(--hi)', 'You'), series(v.timeline.opp, 'var(--opp)', v.opp.name)],
    { xFmt: clock, yFmt: y => Math.round(y), step: true, yZero: true, height: 130 });
}
function showResult(v, canPlayOn) {
  const title = v.result.you === 'win' ? 'You won' : v.result.you === 'loss' ? 'You lost' : 'Draw';
  const rc = v.ratingChange;
  const bonus = rc && rc.gain > 1.05 ? ` · margin ×${rc.gain.toFixed(1)}` : '';
  const rating = rc ? `<p class="${rc.delta >= 0 ? 'win' : 'loss'}" style="font-weight:700">${rc.after}${rc.provisional ? '?' : ''} (${rc.delta >= 0 ? '+' : ''}${rc.delta}) ${tierBadge(rc.after, rc.provisional)}<span class="dim" style="font-weight:400">${bonus}</span></p>` : '';
  const t = p => (p.time != null ? clock(p.time) : p.done === 'out' ? 'Out' : p.done === 'gaveup' ? 'Gave up' : p.done === 'disconnect' ? 'Left' : `${p.filled}/${v.toFill}`);
  const vs = `<div class="vs"><div>${avatarHtml(v.you.avatar)}<div class="t">${t(v.you)}</div><span class="dim">You</span></div><span class="dim">vs</span>
    <div>${avatarHtml(v.opp.avatar)}<div class="t">${t(v.opp)}</div><span class="dim">${esc(v.opp.name)}</span></div></div>`;
  const playOn = canPlayOn ? `<p class="dim">Your board is still open. Keep going to finish it for your own time. It does not change the result.</p>
    <div class="row"><button id="r-stop">Stop</button><button id="r-go" class="main">Keep going</button></div>` : '';
  showSheet(`<h1 class="${v.result.you}">${title}</h1><p>${reasonLine(v)}</p>${rating}${vs}${canPlayOn ? '' : replayChart(v)}${playOn}${canPlayOn ? '' : resultButtons(v)}`);
  if (canPlayOn) {
    $('r-go').onclick = () => { S.keepGoing = v.id; closeSheet(); };
    $('r-stop').onclick = () => send({ t: 'resign' });
  } else wireResultButtons(v);
}
function resultButtons(v) {
  if (v.kind === 'ranked') return `<div class="row"><button id="r-home">Home</button><button id="r-again" class="main">New ${v.difficulty} game</button></div>`;
  const label = v.rematch?.you ? 'Waiting…' : v.rematch?.opp ? `Accept rematch` : 'Rematch';
  return `${v.rematch?.opp && !v.rematch?.you ? `<p class="dim">${esc(v.opp.name)} wants a rematch.</p>` : ''}
    <div class="row"><button id="r-home">Home</button>${v.status === 'aborted' ? '' : `<button id="r-again" class="main" ${v.rematch?.you ? 'disabled' : ''}>${label}</button>`}</div>`;
}
function wireResultButtons(v) {
  $('r-home').onclick = leaveGame;
  if (!$('r-again')) return;
  $('r-again').onclick = () => {
    if (v.kind === 'ranked') { S.prefs.rankedDiff = v.difficulty; leaveGame(); send({ t: 'queue', difficulty: v.difficulty }); }
    else send({ t: 'rematch', game: v.id });
  };
}

// ---------- solo ----------
let worker;
function newSolo() {
  enterGame('solo');
  board.locked = true; board.load(Array(81).fill(0), Array(81).fill(0)); board.locked = true; board.render();
  overlay(`<div><div>Making a puzzle…</div>${tickerHtml()}</div>`);
  worker ??= new Worker('/client/gen-worker.js', { type: 'module' });
  worker.onmessage = e => {
    const p = e.data;
    S.solo = { seed: p.seed, difficulty: p.difficulty, puzzle: p.puzzle, solution: p.solution, elapsed: 0 };
    S.soloStart = Date.now();
    board.load(p.puzzle, p.puzzle, { free: true }); board.locked = false; board.render();
    overlay(''); saveSolo();
  };
  worker.postMessage({ seed: crypto.getRandomValues(new Uint32Array(1))[0], difficulty: S.prefs.soloDiff });
}
function continueSolo() {
  const s = store.get('solo');
  if (!s) return newSolo();
  enterGame('solo');
  S.solo = s; S.soloStart = Date.now() - s.elapsed;
  board.load(s.puzzle, s.v, { free: true, notes: s.n }); board.locked = false; board.render();
}
function saveSolo() {
  if (S.mode !== 'solo' || !S.solo) return;
  S.solo.elapsed = Date.now() - S.soloStart;
  store.set('solo', { ...S.solo, v: board.v, n: board.n });
}
function soloPlaced() {
  if (!board.v.every((x, i) => x === S.solo.solution[i])) return;
  const time = Date.now() - S.soloStart, best = store.get('best', {});
  const record = !best[S.solo.difficulty] || time < best[S.solo.difficulty];
  if (record) { best[S.solo.difficulty] = time; store.set('best', best); }
  store.set('solo', null);
  board.locked = true; board.render();
  S.solo.done = time;
  feel('win'); confetti([getComputedStyle(document.documentElement).getPropertyValue('--hi'), '#ffffff', '#e2b84a']);
  showSheet(`<h1>Solved</h1><p class="big">${clock(time)}</p><p class="dim">${record ? 'New best for ' + diffName(S.solo.difficulty) + '!' : 'Best ' + diffName(S.solo.difficulty) + ': ' + clock(best[S.solo.difficulty])}</p>
    ${tickerHtml()}<div class="row"><button id="s-home">Home</button><button id="s-next" class="main">Next puzzle</button></div>`);
  $('s-home').onclick = leaveGame;
  $('s-next').onclick = () => { closeSheet(); newSolo(); };
}
$('solo-new').onclick = () => { if (!store.get('solo') || confirm('Start a new puzzle? Your saved one will be lost.')) newSolo(); };
$('solo-continue').onclick = continueSolo;
addEventListener('pagehide', saveSolo);

// ---------- clock ----------
setInterval(() => {
  if (S.mode === 'race' && S.view) {
    const v = S.view, now = serverNow();
    if (v.status === 'live' && now < v.startAt) {
      const n = Math.ceil((v.startAt - now) / 1000);
      if (S.lastCount !== n) { S.lastCount = n; overlay(`<span>${n}</span>`, 'count'); feel('tick'); }
      $('clock').textContent = '0:00';
      return;
    }
    if ($('overlay').classList.contains('count')) { overlay(''); feel('go'); board.locked = !!v.you.done; board.render(); }
    $('clock').textContent = clock(v.you.time ?? ((v.status === 'live' || v.status === 'decided') && !v.you.done ? now - v.startAt : (v.result?.at ?? now) - v.startAt));
  } else if (S.mode === 'daily' && S.daily) {
    const d = S.daily;
    $('clock').textContent = clock(d.time ?? (d.status === 'playing' ? serverNow() - d.startedAt : 0));
  } else if (S.mode === 'solo' && S.solo) $('clock').textContent = clock(S.solo.done ?? Date.now() - S.soloStart);
  if (S.queued && $('q-time')) $('q-time').textContent = clock(serverNow() - S.queued.since);
}, 200);
setInterval(() => { if (S.ws?.readyState === 1) S.ws.send('{"t":"ping"}'); }, 20000);

// ---------- boot ----------
renderSegs(); applyLook(); renderLookPickers(); renderPlay(); showLine();
addEventListener('hashchange', () => {
  const m = /^#r=([A-Za-z0-9]{6})$/.exec(location.hash);
  if (m && S.ws?.readyState === 1) { send({ t: 'room.join', code: m[1] }); history.replaceState(null, '', location.pathname); }
});
connect();
