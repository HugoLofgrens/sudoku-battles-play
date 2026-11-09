// Visual effects: cell pop, shake, finished-house sweep, confetti. CSS does the animation.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

export function animate(el, cls) {
  if (reduce || !el) return;
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
}
// A ripple across a finished row, column or box, from the placed cell outward.
export function sweep(cells, from) {
  if (reduce) return;
  const fr = Math.floor(from / 9), fc = from % 9;
  for (const i of cells) {
    const d = Math.abs(Math.floor(i / 9) - fr) + Math.abs(i % 9 - fc);
    setTimeout(() => animate(document.querySelector(`#board .c:nth-child(${i + 1})`), 'swept'), d * 35);
  }
}

export function confetti(colors) {
  if (reduce) return;
  const c = document.createElement('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
  c.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:30';
  c.width = innerWidth * dpr; c.height = innerHeight * dpr;
  document.body.append(c);
  const g = c.getContext('2d'), W = c.width, H = c.height;
  const bits = Array.from({ length: 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3, y: H * 0.35, vx: (Math.random() - 0.5) * 18 * dpr, vy: (-Math.random() * 16 - 6) * dpr,
    s: (4 + Math.random() * 6) * dpr, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, col: colors[Math.floor(Math.random() * colors.length)]
  }));
  const t0 = performance.now();
  (function frame(t) {
    g.clearRect(0, 0, W, H);
    for (const b of bits) {
      b.vy += 0.45 * dpr; b.vx *= 0.99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      g.save(); g.translate(b.x, b.y); g.rotate(b.r); g.fillStyle = b.col; g.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); g.restore();
    }
    if (t - t0 < 2600) requestAnimationFrame(frame); else c.remove();
  })(t0);
}
