// Sound effects made with Web Audio (no files to load) and haptics: Capacitor's Haptics plugin
// in the apps, navigator.vibrate in Android browsers. Both obey the settings.
import { settings } from '/client/settings.js';

let ctx = null;
// Browsers only allow audio after a user gesture.
addEventListener('pointerdown', () => { try { ctx ??= new (window.AudioContext || window.webkitAudioContext)(); if (ctx.state === 'suspended') ctx.resume(); } catch {} }, { capture: true });

function tone(freq, start, dur, { type = 'sine', vol = 0.12, to = null } = {}) {
  const t = ctx.currentTime + start, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
const SOUNDS = {
  place: () => tone(880, 0, 0.07, { vol: 0.08 }),
  note: () => tone(1320, 0, 0.03, { vol: 0.04 }),
  wrong: () => tone(220, 0, 0.22, { type: 'square', vol: 0.06, to: 110 }),
  house: () => { tone(988, 0, 0.09, { vol: 0.07 }); tone(1319, 0.07, 0.12, { vol: 0.07 }); },
  tick: () => tone(660, 0, 0.09, { vol: 0.1 }),
  go: () => tone(1320, 0, 0.25, { vol: 0.12 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.3, { vol: 0.1, type: 'triangle' })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, i * 0.12, 0.3, { vol: 0.08, type: 'triangle' }))
};
export function sfx(name) {
  if (!settings.sound || !ctx || !SOUNDS[name]) return;
  try { SOUNDS[name](); } catch {}
}

const PATTERNS = { place: 8, wrong: [40, 50, 40], house: [12, 40, 12], win: [20, 40, 20, 40, 80], go: 30, tick: 10 };
const STYLE = { place: 'LIGHT', tick: 'LIGHT', house: 'MEDIUM', go: 'MEDIUM', wrong: 'HEAVY', win: 'HEAVY' };
export function buzz(name) {
  if (!settings.vibrate || !PATTERNS[name]) return;
  const H = window.Capacitor?.Plugins?.Haptics;
  try {
    if (H) { name === 'wrong' ? H.notification({ type: 'ERROR' }) : name === 'win' ? H.notification({ type: 'SUCCESS' }) : H.impact({ style: STYLE[name] }); }
    // Browsers refuse (and log) vibration before the first tap.
    else if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.(PATTERNS[name]);
  } catch {}
}
export const feel = name => { sfx(name); buzz(name); };
