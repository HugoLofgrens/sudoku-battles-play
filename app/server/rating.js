// How a ranked result turns into rating, and how ratings are shown. Kept apart from the
// Glicko-2 math (glicko2.js) and from the race rules (match.js).
import { CENTER, SCALE, PROVISIONAL_RD } from './glicko2.js';

// ---- the shown rating ----
// Glicko-2 measures skill relative to everyone else, so its average never moves. To let everyone
// start at 500 and let only the very best climb toward 10,000, players see a curve of it:
//   shown = 500 * e^(GROWTH * mu),  mu = (rating - 1500) / 173.7
// Start: 500. Better than average climbs ever faster; worse sinks toward 0 but never below.
// Points move in proportion to your level (a win at 5,000 is worth ~10x one at 500).
// GROWTH sets the top: 10,000 needs mu = ln(20)/GROWTH = 6.7, about 1,150 classic rating points
// above average, which only an outlier reaches. Retune once real players exist.
export const SHOWN_START = 500, SHOWN_MAX = 10000, GROWTH = 0.45;
export function shown(rating) {
  const v = SHOWN_START * Math.exp(GROWTH * (rating - CENTER) / SCALE);
  return Math.min(SHOWN_MAX, Math.max(1, Math.round(v)));
}
export const provisional = rd => rd > PROVISIONAL_RD;

export const MAX_GAIN = 2;          // a total blowout moves ratings twice as far as a photo finish

// Margin of victory, 0..1, from the moment the result was decided.
//   solved:     the share of the puzzle the loser still had left. That is the time gap too:
//               a loser at fraction f would need about 1/f of the winner's time.
//   mistakes, resign, disconnect: 1. Quitting or striking out is never cheaper than losing.
//   timeout:    the difference in progress.
//   draw:       0.
export function margin(result, filled, toFill) {
  if (!result || result.winner === null || result.winner === undefined) return 0;
  const w = result.winner, l = 1 - w;
  switch (result.reason) {
    case 'solved': return clamp01(1 - filled[l] / toFill);
    case 'timeout': return clamp01((filled[w] - filled[l]) / toFill);
    default: return 1;
  }
}

// Gain factor from the margin, damped when the favourite wins, so beating up much weaker
// players does not farm points (the autocorrelation fix used in margin-of-victory Elo models).
export function gainFor(d, winnerRating, loserRating) {
  const favouriteBy = Math.max(0, winnerRating - loserRating);
  const damp = 2.2 / (2.2 + 0.001 * favouriteBy);
  return 1 + (MAX_GAIN - 1) * clamp01(d) * damp;
}

const clamp01 = x => Math.min(1, Math.max(0, x));
