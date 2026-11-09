// Small SVG line charts that follow the theme colors. No library.
//   series: [{ points: [[x, y], ...], color, label, marks?: [[x, y], ...] }]
export function lineChart(series, { xFmt = String, yFmt = String, height = 160, step = false, yZero = false } = {}) {
  const all = series.flatMap(s => s.points);
  if (all.length < 2) return '<p class="dim">Not enough data yet.</p>';
  const W = 320, H = height, L = 40, R = 8, T = 10, B = 22;
  let [x0, x1] = [Math.min(...all.map(p => p[0])), Math.max(...all.map(p => p[0]))];
  let [y0, y1] = [Math.min(...all.map(p => p[1])), Math.max(...all.map(p => p[1]))];
  if (yZero) y0 = 0;
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.08; y1 += pad; if (!yZero) y0 -= pad;
  const X = x => L + (x - x0) / (x1 - x0) * (W - L - R), Y = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const path = pts => pts.map((p, i) => {
    if (!step || i === 0) return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1);
    return 'H' + X(p[0]).toFixed(1) + 'V' + Y(p[1]).toFixed(1);
  }).join('');
  const ticks = [y0 + (y1 - y0) * 0.15, (y0 + y1) / 2, y1 - (y1 - y0) * 0.15];
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">`;
  for (const v of ticks) svg += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${yFmt(v)}</text>`;
  svg += `<text x="${L}" y="${H - 6}">${xFmt(x0)}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${xFmt(x1)}</text>`;
  for (const s of series) {
    if (!s.points.length) continue;
    svg += `<path d="${path(s.points)}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    for (const m of s.marks || []) svg += `<circle cx="${X(m[0])}" cy="${Y(m[1])}" r="3.2" fill="var(--bad)"/>`;
  }
  svg += '</svg>';
  const legend = series.filter(s => s.label).map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('');
  return svg + (legend ? `<div class="legend">${legend}</div>` : '');
}
