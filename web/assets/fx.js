/* Ambient particles on a fixed canvas (#fx), different for each occasion:
   snow (Christmas), confetti (birthday), petals (wedding), sparkle (just because).
   Plus a burst when the box opens and Ježíšek's comet for the Christmas delivery. */
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

  const PALETTES = {
    snow:     { ambient: ["#fbf6ea", "#f0d896"], burst: ["#f6e3ad", "#d6b26a", "#b8913f", "#f3e8d0", "#a82239"] },
    confetti: { ambient: ["#ff7aa8", "#ffd166", "#5ad1c7", "#9b8cff", "#ffffff"], burst: ["#ff5d8f", "#ffd166", "#06d6a0", "#7b6cff", "#ffffff", "#ff9f43"] },
    petals:   { ambient: ["#f6d5da", "#fbeef0", "#e8b9c2", "#fff8ef"], burst: ["#f8ead2", "#e3c9a0", "#f6d5da", "#ffffff", "#c98f9c"] },
    sparkle:  { ambient: ["#f8e2ad", "#ffffff", "#e2b866"], burst: ["#f8e2ad", "#e2b866", "#ffffff", "#b8563f", "#5fb3b3"] }
  };
  let mode = "snow";
  let flakes = [];
  function seed() {
    const pal = PALETTES[mode].ambient;
    const base = mode === "snow" ? 90 : mode === "sparkle" ? 60 : 46;
    flakes = Array.from({ length: Math.round(Math.min(base, innerWidth / (mode === "snow" ? 9 : 14)) * density) }, () => ({
      x: Math.random() * innerWidth, y: Math.random() * innerHeight,
      r: mode === "snow" ? Math.random() * 1.8 + .5 : Math.random() * 3 + 2.5,
      s: mode === "snow" ? Math.random() * .4 + .15 : mode === "sparkle" ? 0 : Math.random() * .5 + .25,
      p: Math.random() * Math.PI * 2, rot: Math.random() * 6, vr: (Math.random() - .5) * .04,
      c: pal[Math.floor(Math.random() * pal.length)], a: Math.random() * .5 + (mode === "snow" ? .25 : .35),
      gold: Math.random() < .35
    }));
  }
  seed();
  function setMode(m) {
    if (!PALETTES[m] || m === mode) return;
    mode = m; seed();
  }

  const sparks = [];
  function burst(x, y, n = 170) {
    if (reduce) return;
    const pal = PALETTES[mode].burst;
    for (let i = 0; i < n; i++) {
      const ang = Math.random() * Math.PI * 2, sp = Math.random() * 7 + 2;
      sparks.push({
        x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4, life: 1,
        decay: Math.random() * .012 + .008, size: Math.random() * 4 + 2,
        rot: Math.random() * 6, vr: (Math.random() - .5) * .3,
        c: pal[Math.floor(Math.random() * pal.length)], shape: mode === "petals" ? "petal" : Math.random() < .55 ? "rect" : "dot"
      });
    }
  }

  /* Ježíšek's comet: a warm light with a glittering trail along a curve, then a little burst. */
  const comets = [];
  function comet(x0, y0, x1, y1, ms = 1600) {
    return new Promise(done => {
      if (reduce) { done(); return; }
      comets.push({ x0, y0, x1, y1, cx: (x0 + x1) / 2 + (x1 - x0) * .1, cy: Math.min(y0, y1) - H * .18, t0: performance.now(), ms, done, trail: [] });
    });
  }
  const bez = (a, b, c, t) => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c;

  function drawStar(x, y, r, rot) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const rr = i % 2 ? r * .28 : r;
      const a = i * Math.PI / 4;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath(); ctx.fill(); ctx.restore();
  }

  let t = 0, running = true;
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) requestAnimationFrame(frame);
  });

  function ambient() {
    for (const f of flakes) {
      if (mode === "snow") {
        f.y += f.s; f.x += Math.sin(t + f.p) * .25;
        if (f.y > H + 4) { f.y = -4; f.x = Math.random() * W; }
        ctx.globalAlpha = f.a * (.75 + .25 * Math.sin(t * 2 + f.p));
        ctx.fillStyle = f.gold ? "#f0d896" : "#fbf6ea";
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
      } else if (mode === "confetti") {
        f.y += f.s; f.x += Math.sin(t * 1.4 + f.p) * .5; f.rot += f.vr * 3;
        if (f.y > H + 8) { f.y = -8; f.x = Math.random() * W; }
        ctx.globalAlpha = f.a * .8;
        ctx.fillStyle = f.c;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot);
        ctx.scale(1, Math.cos(t * 3 + f.p));      // flutter
        ctx.fillRect(-f.r * .9, -f.r * .4, f.r * 1.8, f.r * .8);
        ctx.restore();
      } else if (mode === "petals") {
        f.y += f.s * .8; f.x += Math.sin(t + f.p) * .7; f.rot += f.vr;
        if (f.y > H + 10) { f.y = -10; f.x = Math.random() * W; }
        ctx.globalAlpha = f.a * .85;
        ctx.fillStyle = f.c;
        ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot + Math.sin(t + f.p) * .6);
        ctx.beginPath(); ctx.ellipse(0, 0, f.r * 1.2, f.r * .65, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {                                  // sparkle: still, twinkling stars
        const tw = Math.max(0, Math.sin(t * 1.6 + f.p));
        ctx.globalAlpha = f.a * tw;
        ctx.fillStyle = f.c;
        drawStar(f.x, f.y, f.r * (.6 + tw * .6), f.rot);
        if (tw < .02) { f.x = Math.random() * W; f.y = Math.random() * H; }
      }
    }
  }

  function frame(now) {
    if (!running) return;
    ctx.clearRect(0, 0, W, H);
    t += .01;
    if (!reduce) ambient();

    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      const k = Math.min(1, (now - c.t0) / c.ms);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // ease in-out
      const x = bez(c.x0, c.cx, c.x1, e), y = bez(c.y0, c.cy, c.y1, e);
      // only while flying: after landing the trail fades out and the comet is dropped
      if (k < 1) c.trail.push({ x, y, life: 1, j: Math.random() });
      for (let n = 0; n < (k < 1 ? 2 : 0); n++) {
        sparks.push({ x: x + (Math.random() - .5) * 8, y: y + (Math.random() - .5) * 8, vx: (Math.random() - .5) * 1.2, vy: Math.random() * 1.2,
          life: 1, decay: .02 + Math.random() * .02, size: Math.random() * 2.4 + 1, rot: 0, vr: 0, c: Math.random() < .5 ? "#fff6d6" : "#f0c86a", shape: "dot" });
      }
      for (let j = c.trail.length - 1; j >= 0; j--) {
        const p = c.trail[j];
        p.life -= .035;
        if (p.life <= 0) { c.trail.splice(j, 1); continue; }
        ctx.globalAlpha = p.life * .55;
        ctx.fillStyle = "#f6dc96";
        ctx.beginPath(); ctx.arc(p.x, p.y, 1.2 + p.life * 4, 0, Math.PI * 2); ctx.fill();
      }
      if (k < 1) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, 26);
        g.addColorStop(0, "rgba(255,252,235,1)"); g.addColorStop(.25, "rgba(255,226,150,.85)"); g.addColorStop(1, "rgba(255,200,90,0)");
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 26, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#fffdf2"; drawStar(x, y, 11, t * 4);
      } else if (!c.ended) {
        c.ended = true;
        const keep = mode; mode = "snow"; burst(c.x1, c.y1, 60); mode = keep;
        c.done();
      }
      if (c.ended && !c.trail.length) comets.splice(i, 1);
    }

    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.vy += s.shape === "petal" ? .05 : .14; s.vx *= .985; s.vy *= .985;
      s.x += s.vx; s.y += s.vy; s.rot += s.vr; s.life -= s.decay;
      if (s.life <= 0) { sparks.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = s.c;
      if (s.shape === "rect") {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.fillRect(-s.size / 2, -s.size / 4, s.size, s.size / 2);
        ctx.restore();
      } else if (s.shape === "petal") {
        ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rot);
        ctx.beginPath(); ctx.ellipse(0, 0, s.size, s.size * .55, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else {
        ctx.beginPath(); ctx.arc(s.x, s.y, s.size / 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.XDfx = { burst, comet, setMode };
})();
