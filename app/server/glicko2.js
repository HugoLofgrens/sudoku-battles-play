// Glicko-2 (Glickman, "Example of the Glicko-2 system", 2013), the family chess.com and Lichess
// use, on its standard 1500 scale. Each finished game is rated on its own, right away.
// Inactivity widens RD one step per idle week. What players see (500 .. 10,000) and the
// margin-of-victory gain live in rating.js; this file is only the math.
export const CENTER = 1500;
export const START = { rating: CENTER, rd: 350, vol: 0.06 };
export const TAU = 0.5;
export const RD_MIN = 45;
export const RD_MAX = 350;
export const PROVISIONAL_RD = 110;            // "placement" above this
export const IDLE_PERIOD_MS = 7 * 24 * 3600e3;
export const SCALE = 173.7178;
const EPS = 1e-6;

const g = phi => 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
const E = (mu, muj, phij) => 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const toMu = r => (r - CENTER) / SCALE;

// RD grows while a player is away: phi^2 + periods * sigma^2.
export function idle(p, ms) {
  const periods = Math.max(0, Math.floor(ms / IDLE_PERIOD_MS));
  if (!periods) return { ...p };
  const phi = p.rd / SCALE;
  const rd = Math.sqrt(phi * phi + periods * p.vol * p.vol) * SCALE;
  return { ...p, rd: clamp(rd, RD_MIN, RD_MAX) };
}

// p = {rating, rd, vol}; games = [{rating, rd, score}] with score 1, 0.5 or 0.
// gain multiplies the rating change only; RD and volatility follow plain Glicko-2.
export function rate(p, games, { tau = TAU, clampRd = true, gain = 1 } = {}) {
  const mu = toMu(p.rating), phi = p.rd / SCALE, sigma = p.vol;
  if (!games.length) return { ...p };
  let vInv = 0, sum = 0;
  for (const o of games) {
    const muj = toMu(o.rating), phij = o.rd / SCALE, e = E(mu, muj, phij), gj = g(phij);
    vInv += gj * gj * e * (1 - e);
    sum += gj * (o.score - e);
  }
  const v = 1 / vInv, delta = v * sum;

  // New volatility: Illinois method on f(x), step 5.4 of the paper.
  const a = Math.log(sigma * sigma), phi2 = phi * phi, d2 = delta * delta;
  const f = x => {
    const ex = Math.exp(x), t = phi2 + v + ex;
    return ex * (d2 - phi2 - v - ex) / (2 * t * t) - (x - a) / (tau * tau);
  };
  let A = a, B;
  if (d2 > phi2 + v) B = Math.log(d2 - phi2 - v);
  else { let k = 1; while (f(a - k * tau) < 0) k++; B = a - k * tau; }
  let fA = f(A), fB = f(B);
  for (let i = 0; Math.abs(B - A) > EPS && i < 200; i++) {
    const C = A + (A - B) * fA / (fB - fA), fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const vol = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi2 + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + gain * phiNew * phiNew * sum;
  const rd = phiNew * SCALE;
  return { rating: muNew * SCALE + CENTER, rd: clampRd ? clamp(rd, RD_MIN, RD_MAX) : rd, vol };
}

// One game between a and b. scoreA: 1 a won, 0 b won, 0.5 draw. Both use pre-game values and
// the same gain, so a big win moves both players by the same factor.
export function rateGame(a, b, scoreA, gain = 1) {
  return [
    rate(a, [{ rating: b.rating, rd: b.rd, score: scoreA }], { gain }),
    rate(b, [{ rating: a.rating, rd: a.rd, score: 1 - scoreA }], { gain })
  ];
}

// Chance a beats b, for display.
export function expected(a, b) {
  const phi = Math.sqrt(a.rd * a.rd + b.rd * b.rd) / SCALE;
  return E(toMu(a.rating), toMu(b.rating), phi);
}
