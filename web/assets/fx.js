/* Ambient snow + gold confetti burst on a fixed canvas (#fx). */
(function () {
  const cv = document.getElementById("fx");
  if (!cv) return;
  const ctx = cv.getContext("2d");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const density = Number(cv.dataset.density || 1);
  let W = 0, H = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener("resize", resize);

  const flakes = Array.from({ length: Math.round(Math.min(90, innerWidth / 9) * density) }, () => ({
    x: Math.random() * innerWidth, y: Math.random() * innerHeight,
    r: Math.random() * 1.8 + .5, s: Math.random() * .4 + .15,
    p: Math.random() * Math.PI * 2, gold: Math.random() < .35, a: Math.random() * .5 + .25
  }));
  const sparks = [];
  const COLORS = ["#f6e3ad", "#d6b26a", "#b8913f", "#f3e8d0", "#a82239"];

  function burst(x, y, n = 170) {
    if (reduce) return;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = Math.random() * 7 + 2;
      sparks.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4, life: 1,
        decay: Math.random() * .012 + .008, size: Math.random() * 4 + 2,
        rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
        c: COLORS[Math.floor(Math.random() * COLORS.length)], rect: Math.random() < .55
      });
    }
  }

  let t = 0, running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  function frame() {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    t += .01;
    if (!reduce) {
      for (const f of flakes) {
        f.y += f.s; f.x += Math.sin(t + f.p) * .25;
        if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
        ctx.globalAlpha = f.a * (.75 + .25 * Math.sin(t * 2 + f.p));
        ctx.fillStyle = f.gold ? "#f0d896" : "#fbf6ea";
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vy += .14; s.vx *= .985; s.vy *= .985;
      s.x += s.vx; s.y += s.vy; s.rot += s.vr; s.life -= s.decay;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      if (s.rect) {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.fillRect(-s.size / 2, -s.size / 4, s.size, s.size / 2);
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size / 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.XDfx = { burst };
})();
