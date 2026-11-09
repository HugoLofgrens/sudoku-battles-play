import { Board } from '/client/board.js';
import { AVATAR_SYMBOLS, AVATAR_COLORS, THEMES, cleanAvatar, cleanTheme } from '/shared/looks.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
const store = {
  get(k, d = null) { try { const v = localStorage.getItem('sb-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('sb-' + k); else localStorage.setItem('sb-' + k, JSON.stringify(v)); } catch {} }
};
const DIFFS = [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard']];
const clock = ms => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const ratingText = r => r ? r.rating + (r.provisional ? '?' : '') : '';
const avatarHtml = (a, big) => { a = cleanAvatar(a); return `<span class="av${big ? ' big' : ''}" style="background:${AVATAR_COLORS[a.c]}">${AVATAR_SYMBOLS[a.s]}</span>`; };
function paintAvatar(el, a) { a = cleanAvatar(a); el.style.background = AVATAR_COLORS[a.c]; el.textContent = AVATAR_SYMBOLS[a.s]; }

// ---------- state ----------
const S = {
  token: store.get('token'), guestToken: store.get('guest'), me: null, ws: null, retry: 0,
  offset: 0, view: null, mode: 'menu', tab: 'play', keepGoing: null, queued: null, room: null,
  challenge: null, friends: [], soloStart: 0, solo: null,
  prefs: { rankedDiff: 'easy', friendDiff: 'easy', friendMistakes: 3, soloDiff: 'medium', boardDiff: 'easy', ...store.get('prefs', {}) },
  look: { avatar: cleanAvatar(store.get('look', {}).avatar), theme: cleanTheme(store.get('look', {}).theme) },
  pendingJoin: (/^#r=([A-Za-z0-9]{6})$/.exec(location.hash) || [])[1] || null
};
const serverNow = () => Date.now() + S.offset;

// ---------- network ----------
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  S.ws = ws;
  ws.onopen = () => { S.retry = 0; ws.send(JSON.stringify({ t: 'hello', token: S.token || undefined, guest: S.token ? undefined : S.guestToken || undefined })); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } on[m.t]?.(m); };
  ws.onclose = ev => {
    if (S.ws !== ws) return;
    S.ws = null;
    if (ev.code === 4000) return;                   // replaced by another tab; it shows its own sheet
    setStatus('Reconnecting…');
    setTimeout(connect, Math.min(8000, 500 * 2 ** S.retry++));
  };
}
const send = m => { if (S.ws && S.ws.readyState === 1) S.ws.send(JSON.stringify(m)); else toast('Not connected yet.'); };
function reconnect() { if (S.ws) { const w = S.ws; S.ws = null; w.close(); } connect(); }

async function api(path, body) {
  const r = await fetch(path, {
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
    applyTheme(); renderMe(); renderPlay();
    if (S.tab === 'friends') loadFriends();
    if (S.tab === 'profile') loadProfile();
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
  pong(m) { S.offset = m.serverNow - Date.now(); }
};

// ---------- look ----------
function applyTheme() {
  const t = THEMES[S.look.theme], r = document.documentElement.style;
  const map = { bg: 'bg', cell: 'cell', line: 'line', thick: 'thick', given: 'given', user: 'user', note: 'note', hi: 'hi', hiInk: 'hi-ink', peer: 'peer', dead: 'dead', panel: 'panel' };
  for (const [k, v] of Object.entries(map)) r.setProperty('--' + v, t[k]);
  document.querySelector('meta[name=theme-color]').content = t.bg;
}
async function setLook(change) {
  S.look = { ...S.look, ...change };
  store.set('look', S.look);
  applyTheme(); renderMe(); renderLookPickers();
  if (S.me && !S.me.guest) { try { S.me = { ...S.me, ...(await api('/api/me/look', S.look)) }; } catch (e) { toast(e.message); } }
}
function renderLookPickers() {
  $('pick-symbol').innerHTML = AVATAR_SYMBOLS.map((s, i) => `<button data-s="${i}" class="${i === S.look.avatar.s ? 'on' : ''}" style="background:${AVATAR_COLORS[S.look.avatar.c]};color:#111">${s}</button>`).join('');
  $('pick-color').innerHTML = AVATAR_COLORS.map((c, i) => `<button data-c="${i}" class="${i === S.look.avatar.c ? 'on' : ''}" style="background:${c}"></button>`).join('');
  $('pick-theme').innerHTML = Object.entries(THEMES).map(([k, t]) => `<button data-v="${k}" class="${k === S.look.theme ? 'on' : ''}">${t.name}</button>`).join('');
}
$('pick-symbol').onclick = e => { const b = e.target.closest('[data-s]'); if (b) setLook({ avatar: { ...S.look.avatar, s: +b.dataset.s } }); };
$('pick-color').onclick = e => { const b = e.target.closest('[data-c]'); if (b) setLook({ avatar: { ...S.look.avatar, c: +b.dataset.c } }); };
$('pick-theme').onclick = e => { const b = e.target.closest('[data-v]'); if (b) setLook({ theme: b.dataset.v }); };

// ---------- menus ----------
const SEGS = {
  rankedDiff: DIFFS, friendDiff: DIFFS, soloDiff: DIFFS, boardDiff: DIFFS,
  friendMistakes: [[1, '1 mistake'], [3, '3 mistakes'], [5, '5 mistakes']]
};
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
  if (k === 'boardDiff') loadLeaders();
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
  $('ranked-info').textContent = guest ? 'Log in to play ranked against anyone.' : `Your ${S.prefs.rankedDiff} rating: ${ratingText(r)}${r.provisional ? ' (settles after a few games)' : ''}. 3 mistakes and you're out.`;
  $('solo-continue').hidden = !store.get('solo');
}
function showTab(tab) {
  S.tab = tab;
  for (const t of ['play', 'friends', 'profile']) $('s-' + t).hidden = t !== tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  if (tab === 'friends') loadFriends();
  if (tab === 'profile') loadProfile();
  if (tab === 'play') renderPlay();
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

function showSearching() {
  const q = S.queued;
  showSheet(`<h2>Finding an opponent</h2><div class="spin"></div>
    <p class="dim" style="text-align:center">${DIFFS.find(d => d[0] === q.difficulty)[1]} · your rating ${ratingText(q.rating)} · <span id="q-time">0:00</span></p>
    <button id="q-cancel">Cancel</button>`);
  $('q-cancel').onclick = () => send({ t: 'unqueue' });
}
function showRoom() {
  const r = S.room, url = location.origin + location.pathname + '#r=' + r.code;
  const rules = `${DIFFS.find(d => d[0] === r.rules.difficulty)[1]} · ${r.rules.mistakes} mistake${r.rules.mistakes > 1 ? 's' : ''}`;
  if (r.invite) {
    showSheet(`<h2>Waiting for ${esc(r.invite)}</h2><div class="spin"></div><p class="dim" style="text-align:center">${rules}</p><button id="room-cancel">Cancel</button>`);
  } else {
    showSheet(`<h2>Send this to a friend</h2><p class="dim">${rules}. The game starts when they open it.</p>
      <p class="big" style="text-align:center;letter-spacing:4px">${r.code}</p>
      <input id="room-url" readonly value="${esc(url)}">
      <div class="row">${navigator.share ? '<button id="room-share" class="main">Share</button>' : ''}<button id="room-copy" ${navigator.share ? '' : 'class="main"'}>Copy link</button></div>
      <button id="room-cancel" class="ghost">Cancel</button>`);
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
    <p class="dim">${DIFFS.find(d => d[0] === c.rules.difficulty)[1]} · ${c.rules.mistakes} mistake${c.rules.mistakes > 1 ? 's' : ''}</p></div></div>
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
  renderLookPickers(); loadLeaders();
  const guest = !S.me || S.me.guest;
  $('auth-card').hidden = !guest; $('profile-acct').hidden = guest; $('logout').hidden = guest;
  if (guest) return;
  let p;
  try { p = await api('/api/profile/' + encodeURIComponent(S.me.name)); } catch (e) { return toast(e.message); }
  S.me.ratings = p.ratings;
  paintAvatar($('p-av'), S.look.avatar);
  $('p-name').textContent = p.name;
  $('p-joined').textContent = 'Joined ' + new Date(p.joined).toLocaleDateString();
  $('p-ratings').innerHTML = DIFFS.map(([d, label]) => `<div class="tile"><b>${ratingText(p.ratings[d])}</b><span>${label}<br>${p.ratings[d].games} rated</span></div>`).join('');
  $('p-totals').innerHTML = `<div class="tile"><b>${p.totals.wins}/${p.totals.losses}/${p.totals.draws}</b><span>Won/lost/drawn</span></div>
    <div class="tile"><b>${p.streak}</b><span>Win streak</span></div><div class="tile"><b>${p.bestStreak}</b><span>Best streak</span></div>`;
  const best = DIFFS.filter(([d]) => p.bestTimes[d]).map(([d, l]) => `${l} ${clock(p.bestTimes[d])}`);
  $('p-best').textContent = best.length ? 'Fastest solves: ' + best.join(' · ') : '';
  $('p-norecent').hidden = p.recent.length > 0;
  $('p-recent').innerHTML = p.recent.map(g => {
    const delta = g.ratingAfter != null ? g.ratingAfter - g.ratingBefore : null;
    return `<div class="item"><span class="${g.result}" style="width:44px;font-weight:700">${g.result === 'win' ? 'Won' : g.result === 'loss' ? 'Lost' : 'Draw'}</span>
      <span class="grow">vs ${esc(g.opponent)}<br><span class="dim">${DIFFS.find(d => d[0] === g.difficulty)[1]} · ${g.kind === 'ranked' ? 'Ranked' : 'Friend'} · ${reasonShort(g.reason)}</span></span>
      <span style="text-align:right">${g.time != null ? clock(g.time) : '–'}<br><span class="dim">${delta == null ? '' : (delta >= 0 ? '+' : '') + delta}</span></span></div>`;
  }).join('');
}
const reasonShort = r => ({ solved: 'solved', mistakes: 'mistakes', resign: 'gave up', disconnect: 'left', timeout: 'time cap' }[r] || r);
async function loadLeaders() {
  let rows = [];
  try { rows = await api('/api/leaderboard/' + S.prefs.boardDiff); } catch {}
  $('leaders-empty').hidden = rows.length > 0;
  $('leaders').innerHTML = rows.map((r, i) => `<div class="item"><span class="dim" style="width:22px">${i + 1}</span>${avatarHtml(r.avatar)}<span class="grow">${esc(r.name)}</span><b>${r.rating}</b></div>`).join('');
}

// ---------- game screen ----------
const board = new Board($('board'), $('pad'), {
  onPlace: (i, d) => S.mode === 'race' ? send({ t: 'place', cell: i, digit: d }) : soloPlaced(),
  onChange: () => { if (S.mode === 'solo') saveSolo(); }
});
function enterGame(mode) {
  S.mode = mode;
  document.body.classList.add('ingame');
  document.body.classList.toggle('solo', mode === 'solo');
  for (const t of ['play', 'friends', 'profile']) $('s-' + t).hidden = true;
  $('s-game').hidden = false;
  $('t-undo').hidden = mode !== 'solo';
  $('t-quit').textContent = mode === 'solo' ? 'Leave' : 'Give up';
  $('status-line').textContent = '';
  overlay('');
}
function leaveGame() {
  if (S.mode === 'race') send({ t: 'leave' });
  S.mode = 'menu'; S.view = null; S.keepGoing = null;
  document.body.classList.remove('ingame', 'solo');
  $('s-game').hidden = true; closeSheet();
  showTab('play');
  if (S.me && !S.me.guest) reconnectSoftRefresh();
}
// Fresh ratings for the menu after a rated game.
async function reconnectSoftRefresh() { try { S.me = { ...S.me, ...(await api('/api/me')) }; renderPlay(); } catch {} }
function overlay(html, cls = '') { $('overlay').innerHTML = html; $('overlay').className = html ? 'show ' + cls : ''; }

$('t-erase').onclick = () => board.erase();
$('t-undo').onclick = () => board.undo();
$('t-notes').onclick = () => { board.toggleNotes(); $('t-notes').classList.toggle('on', board.noteMode); };
$('t-quit').onclick = () => {
  if (S.mode === 'solo') return leaveGame();
  const v = S.view;
  if (!v) return leaveGame();
  if (v.status === 'live' && v.canAbort) { if (confirm('Abort this game? No rating change.')) send({ t: 'abort' }); }
  else if (v.status === 'live' && !v.you.done) { if (confirm('Give up? You lose this game.')) send({ t: 'resign' }); }
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
  el.querySelector('.rt').textContent = ratingText(p.rating);
  el.querySelector('.prog i').style.width = (100 * p.filled / total) + '%';
  let mis = '';
  for (let k = 0; k < mistakesAllowed; k++) mis += k < p.mistakes ? '<span class="x">✕</span>' : '○';
  const tail = p.done === 'solved' ? clock(p.time) : p.done === 'out' ? 'Out' : p.done === 'gaveup' ? 'Gave up' : p.done === 'disconnect' ? 'Left' : `${p.filled}/${total}`;
  el.querySelector('.side').innerHTML = `${tail} <span class="mis">${mis}</span>`;
}

function onGame(v) {
  S.offset = v.serverNow - Date.now();
  const fresh = !S.view || S.view.id !== v.id;
  if (fresh) {
    S.queued = null; S.room = null; S.keepGoing = null; closeSheet();
    enterGame('race');
    board.load(v.puzzle, v.board);
  } else board.sync(v.board);
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
    if (playing && S.keepGoing === v.id) { closeSheet(); return; }
    showResult(v, playing);
  }
}
function showAborted(v) {
  const why = { 'no-show': 'Your opponent never showed up.', 'left-early': 'A player left before starting.', aborted: v.result.by === v.you.index ? 'You aborted the game.' : `${v.opp.name} aborted the game.` }[v.result.reason] || 'Game aborted.';
  showSheet(`<h1>Game aborted</h1><p class="dim">${why} No rating change.</p>${resultButtons(v)}`);
  wireResultButtons(v);
}
function reasonLine(v) {
  const youWon = v.result.you === 'win', opp = esc(v.opp.name);
  switch (v.result.reason) {
    case 'solved': return youWon ? 'You solved it first.' : `${opp} solved it first.`;
    case 'mistakes': return youWon ? `${opp} made ${v.mistakesAllowed} mistake${v.mistakesAllowed > 1 ? 's' : ''}.` : `You made ${v.mistakesAllowed} mistake${v.mistakesAllowed > 1 ? 's' : ''}.`;
    case 'resign': return youWon ? `${opp} gave up.` : 'You gave up.';
    case 'disconnect': return youWon ? `${opp} left the game.` : 'You were gone too long.';
    case 'timeout': return 'Time cap reached. Most cells filled wins.';
  }
  return '';
}
function showResult(v, canPlayOn) {
  const title = v.result.you === 'win' ? 'You won' : v.result.you === 'loss' ? 'You lost' : 'Draw';
  const rc = v.ratingChange;
  const rating = rc ? `<p class="${rc.delta >= 0 ? 'win' : 'loss'}" style="font-weight:700">Rating ${rc.after}${rc.provisional ? '?' : ''} (${rc.delta >= 0 ? '+' : ''}${rc.delta})</p>` : '';
  const t = p => (p.time != null ? clock(p.time) : p.done === 'out' ? 'Out' : p.done === 'gaveup' ? 'Gave up' : p.done === 'disconnect' ? 'Left' : `${p.filled}/${v.toFill}`);
  const vs = `<div class="vs"><div>${avatarHtml(v.you.avatar)}<div class="t">${t(v.you)}</div><span class="dim">You</span></div><span class="dim">vs</span>
    <div>${avatarHtml(v.opp.avatar)}<div class="t">${t(v.opp)}</div><span class="dim">${esc(v.opp.name)}</span></div></div>`;
  const playOn = canPlayOn ? `<p class="dim">Your board is still open. Keep going to finish it for your own time. It does not change the result.</p>
    <div class="row"><button id="r-stop">Stop</button><button id="r-go" class="main">Keep going</button></div>` : '';
  showSheet(`<h1 class="${v.result.you}">${title}</h1><p>${reasonLine(v)}</p>${rating}${vs}${playOn}${canPlayOn ? '' : resultButtons(v)}`);
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
  overlay('Making a puzzle…');
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
  showSheet(`<h1>Solved</h1><p class="big">${clock(time)}</p><p class="dim">${record ? 'New best for ' + S.solo.difficulty + '!' : 'Best ' + S.solo.difficulty + ': ' + clock(best[S.solo.difficulty])}</p>
    <div class="row"><button id="s-home">Home</button><button id="s-next" class="main">Next puzzle</button></div>`);
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
      overlay(String(Math.ceil((v.startAt - now) / 1000)), 'count');
      $('clock').textContent = '0:00';
      return;
    }
    if ($('overlay').classList.contains('count')) { overlay(''); board.locked = !!v.you.done; board.render(); }
    $('clock').textContent = clock(v.you.time ?? ((v.status === 'live' || v.status === 'decided') && !v.you.done ? now - v.startAt : (v.result?.at ?? now) - v.startAt));
  } else if (S.mode === 'solo' && S.solo) $('clock').textContent = clock(S.solo.done ?? Date.now() - S.soloStart);
  if (S.queued && $('q-time')) $('q-time').textContent = clock(serverNow() - S.queued.since);
}, 200);
setInterval(() => { if (S.ws?.readyState === 1) S.ws.send('{"t":"ping"}'); }, 20000);

// ---------- boot ----------
renderSegs(); applyTheme(); renderLookPickers(); renderPlay();
addEventListener('hashchange', () => {
  const m = /^#r=([A-Za-z0-9]{6})$/.exec(location.hash);
  if (m && S.ws?.readyState === 1) { send({ t: 'room.join', code: m[1] }); history.replaceState(null, '', location.pathname); }
});
connect();
