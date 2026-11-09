// Free customization: the server validates against these lists, the client draws them.
export const AVATAR_SYMBOLS = ['★', '♞', '◆', '●', '▲', '♥', '☀', '☾', '⚡', '♪', '✿', '☘'];
export const AVATAR_COLORS = ['#f2b632', '#7cc4ff', '#ff6b6b', '#6bd68a', '#c38bff', '#ff9f43', '#4dd0c8', '#f78fb3'];
export const THEMES = {
  night:  { name: 'Night',  bg: '#14161b', cell: '#22262f', line: '#3a404d', thick: '#a2aaba', given: '#eef0f5', user: '#7cc4ff', note: '#8b93a3', hi: '#f2b632', hiInk: '#17130a', peer: '#2a2f3a', dead: '#15171c', panel: '#1b1e25' },
  paper:  { name: 'Paper',  bg: '#f4f1ea', cell: '#ffffff', line: '#d6d0c4', thick: '#3b3a36', given: '#1d1c1a', user: '#1f5fbf', note: '#8a857a', hi: '#ffd166', hiInk: '#1d1c1a', peer: '#ece7dc', dead: '#e3ded3', panel: '#ffffff' },
  ocean:  { name: 'Ocean',  bg: '#0d1b2a', cell: '#16283b', line: '#2b4560', thick: '#8fb3d9', given: '#e6f0fa', user: '#5ee1c9', note: '#7f98b3', hi: '#5ee1c9', hiInk: '#06201b', peer: '#1d3550', dead: '#0f1e2e', panel: '#12233a' },
  forest: { name: 'Forest', bg: '#131a14', cell: '#1e2a20', line: '#34473a', thick: '#9cbfa3', given: '#eef5ef', user: '#b6e37a', note: '#8aa290', hi: '#e8c25a', hiInk: '#1a1405', peer: '#26362a', dead: '#141c16', panel: '#18221a' }
};
export const DEFAULT_LOOK = { avatar: { s: 0, c: 0 }, theme: 'night' };

export function cleanAvatar(a) {
  const s = Number.isInteger(a?.s) && a.s >= 0 && a.s < AVATAR_SYMBOLS.length ? a.s : 0;
  const c = Number.isInteger(a?.c) && a.c >= 0 && a.c < AVATAR_COLORS.length ? a.c : 0;
  return { s, c };
}
export const cleanTheme = t => (Object.prototype.hasOwnProperty.call(THEMES, t) ? t : 'night');
