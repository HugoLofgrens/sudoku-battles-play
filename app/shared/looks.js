// Free customization: the server validates against these lists, the client draws them.
export const AVATAR_SYMBOLS = ['★', '♞', '◆', '●', '▲', '♥', '☀', '☾', '⚡', '♪', '✿', '☘'];
export const AVATAR_COLORS = ['#7cc4ff', '#f2b632', '#ff6b6b', '#6bd68a', '#c38bff', '#ff9f43', '#4dd0c8', '#f78fb3'];
// hi = matching numbers and buttons (blue), sel = the pressed cell (dark blue),
// peer = the gray of the row, column and box next to the pressed cell (fades with distance).
export const THEMES = {
  night: { name: 'Night', bg: '#121418', cell: '#1e2128', line: '#323741', thick: '#8b919d', given: '#eceef2', user: '#8ab4ff', note: '#8a909b', hi: '#3b82f6', hiInk: '#ffffff', sel: '#1e40af', peer: '#4a505b', dead: '#16181d', panel: '#191c22', opp: '#a3aab6' },
  paper: { name: 'Paper', bg: '#f3f4f6', cell: '#ffffff', line: '#d5d9e0', thick: '#3b3f47', given: '#16181d', user: '#1d4ed8', note: '#7b818c', hi: '#3b82f6', hiInk: '#ffffff', sel: '#1e40af', peer: '#c9ced7', dead: '#e7e9ed', panel: '#ffffff', opp: '#7b818c' },
  slate: { name: 'Slate', bg: '#1b1f26', cell: '#272c35', line: '#3c4350', thick: '#9aa3b2', given: '#f1f3f6', user: '#93c5fd', note: '#949cab', hi: '#2563eb', hiInk: '#ffffff', sel: '#1e3a8a', peer: '#4b5260', dead: '#1f232b', panel: '#232831', opp: '#b4bcc8' },
  ocean: { name: 'Ocean', bg: '#0b1626', cell: '#14233a', line: '#253a57', thick: '#88a6cc', given: '#e8f0fb', user: '#7cc4ff', note: '#7d95b3', hi: '#3b82f6', hiInk: '#ffffff', sel: '#1e40af', peer: '#2b405f', dead: '#0e1a2c', panel: '#112036', opp: '#9db3cf' }
};
export const DEFAULT_LOOK = { avatar: { s: 0, c: 0 }, theme: 'night' };

export function cleanAvatar(a) {
  const s = Number.isInteger(a?.s) && a.s >= 0 && a.s < AVATAR_SYMBOLS.length ? a.s : 0;
  const c = Number.isInteger(a?.c) && a.c >= 0 && a.c < AVATAR_COLORS.length ? a.c : 0;
  return { s, c };
}
export const cleanTheme = t => (Object.prototype.hasOwnProperty.call(THEMES, t) ? t : 'night');
