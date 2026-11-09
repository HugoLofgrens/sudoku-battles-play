// Rank badges by rating. Everyone starts at 500 (Silver); the rating is capped at 10,000.
export const TIERS = [
  { name: 'Bronze',      min: 0,    color: '#b4794a' },
  { name: 'Silver',      min: 400,  color: '#a9b4c2' },
  { name: 'Gold',        min: 700,  color: '#e2b84a' },
  { name: 'Platinum',    min: 1000, color: '#5cc8c0' },
  { name: 'Diamond',     min: 1400, color: '#6aa8ff' },
  { name: 'Master',      min: 1900, color: '#b07cff' },
  { name: 'Grandmaster', min: 2500, color: '#ff6b81' }
];
export const PLACEMENT = { name: 'Placement', min: 0, color: '#8a909b' };
export function tierOf(rating, provisional = false) {
  if (provisional) return PLACEMENT;
  let t = TIERS[0];
  for (const x of TIERS) if (rating >= x.min) t = x;
  return t;
}
