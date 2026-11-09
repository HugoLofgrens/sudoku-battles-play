// Device settings: sound, vibration, pad counts and board look. Saved on this device.
const KEY = 'sb-settings';
export const ACCENTS = {
  blue:   { name: 'Blue',   hi: '#3b82f6', sel: '#1e40af' },
  indigo: { name: 'Indigo', hi: '#6366f1', sel: '#3730a3' },
  teal:   { name: 'Teal',   hi: '#14b8a6', sel: '#0f766e' },
  violet: { name: 'Violet', hi: '#8b5cf6', sel: '#5b21b6' },
  rose:   { name: 'Rose',   hi: '#f43f5e', sel: '#9f1239' }
};
export const CELL_STYLES = { classic: 'Classic', rounded: 'Tiles', minimal: 'Minimal' };
export const FONTS = {
  system:  { name: 'Clean',   css: 'system-ui, -apple-system, "Segoe UI", sans-serif' },
  rounded: { name: 'Rounded', css: 'ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif' },
  mono:    { name: 'Mono',    css: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
  serif:   { name: 'Serif',   css: 'ui-serif, Georgia, "Times New Roman", serif' }
};
const DEFAULTS = { sound: true, vibrate: true, padCounts: true, cellStyle: 'classic', font: 'system', accent: 'blue' };

function load() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
  const out = { ...DEFAULTS, ...s };
  for (const k of ['sound', 'vibrate', 'padCounts']) if (typeof out[k] !== 'boolean') out[k] = DEFAULTS[k];
  if (!CELL_STYLES[out.cellStyle]) out.cellStyle = DEFAULTS.cellStyle;
  if (!FONTS[out.font]) out.font = DEFAULTS.font;
  if (!ACCENTS[out.accent]) out.accent = DEFAULTS.accent;
  return out;
}
export const settings = load();
export function setSetting(k, v) {
  settings[k] = v;
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch {}
  applySettings();
}
// Board look on top of the theme (call after the theme is applied).
export function applySettings() {
  const r = document.documentElement.style, a = ACCENTS[settings.accent];
  r.setProperty('--hi', a.hi); r.setProperty('--sel', a.sel); r.setProperty('--hi-ink', '#fff');
  r.setProperty('--font', FONTS[settings.font].css);
  document.body.classList.remove(...Object.keys(CELL_STYLES).map(k => 'cells-' + k));
  document.body.classList.add('cells-' + settings.cellStyle);
  document.body.classList.toggle('no-counts', !settings.padCounts);
}
