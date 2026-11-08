// The party after a solve: a pointing finger for the trickiest step during
// the replay, then confetti, fireworks and a flying banner. Everything is
// drawn in overlays that ignore the pointer.

const HUES = ['scarlet', 'yellow', 'purple', 'blue', 'green', 'orange'];

function palette() {
  const css = getComputedStyle(document.documentElement);
  return HUES.map((h) => css.getPropertyValue(`--c-${h}`).trim()).filter(Boolean);
}

// A big finger bouncing above `el`, with a label. Returns a function that
// removes it.
export function showFinger(el, label) {
  const r = el.getBoundingClientRect();
  const f = document.createElement('div');
  f.className = 'finger';
  f.innerHTML = `<span class="finger-label">${label}</span><span class="finger-hand" aria-hidden="true">👇</span>`;
  f.style.left = `${r.left + r.width / 2}px`;
  f.style.top = `${r.top - 6}px`;
  document.body.append(f);
  return () => {
    f.classList.add('is-leaving');
    setTimeout(() => f.remove(), 300);
  };
}

function banner(text) {
  const b = document.createElement('div');
  b.className = 'banner';
  b.innerHTML = `<span>${text}</span>`;
  document.body.append(b);
  setTimeout(() => b.remove(), 4200);
}

// Fireworks burst for the first second; confetti keeps falling until
// stop() is called, then fades out.
function fireworks() {
  const canvas = document.createElement('canvas');
  canvas.className = 'party';
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const size = () => {
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  const colors = palette();
  const pick = () => colors[Math.floor(Math.random() * colors.length)];
  const W = () => innerWidth;
  const H = () => innerHeight;

  const confetti = Array.from({ length: 220 }, () => ({
    x: Math.random() * W(), y: -20 - Math.random() * H() * 0.8,
    vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
    w: 7 + Math.random() * 7, h: 4 + Math.random() * 5,
    a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, c: pick(),
  }));
  const sparks = [];
  const burst = () => {
    const x = W() * (0.15 + Math.random() * 0.7);
    const y = H() * (0.12 + Math.random() * 0.4);
    const c = pick();
    const n = 70;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2;
      const sp = 2.5 + Math.random() * 3.5;
      sparks.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 1, c: Math.random() < 0.2 ? '#fff' : c });
    }
  };

  const start = performance.now();
  let lastBurst = -1000;
  let stoppedAt = null;
  const frame = (now) => {
      const t = now - start;
      if (t - lastBurst > 250 && t < 1000) { burst(); lastBurst = t; }
      ctx.clearRect(0, 0, W(), H());
      const fade = stoppedAt === null ? 1 : Math.max(0, 1 - (now - stoppedAt) / 600);
      ctx.globalAlpha = fade;
      for (const p of confetti) {
        p.x += p.vx + Math.sin((t + p.y) / 300);
        p.y += p.vy;
        p.a += p.va;
        if (p.y > H() + 20) { p.y = -20; p.x = Math.random() * W(); }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.a);
        ctx.fillStyle = p.c;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.a * 2)) + 1);
        ctx.restore();
      }
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.x += s.vx; s.y += s.vy;
        s.vx *= 0.97; s.vy = s.vy * 0.97 + 0.06;
        s.life -= 0.02;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = fade * s.life;
        ctx.fillStyle = s.c;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (fade > 0) requestAnimationFrame(frame);
      else { canvas.remove(); removeEventListener('resize', size); }
  };
  addEventListener('resize', size);
  requestAnimationFrame(frame);
  return { stop: () => { if (stoppedAt === null) stoppedAt = performance.now(); } };
}

// Returns {stop}, which fades the confetti away.
export function party() {
  banner('Good Job!!!');
  return fireworks();
}

export const CELEBRATE_CSS = `
.finger { position: fixed; z-index: 60; transform: translate(-50%, -100%); pointer-events: none;
  display: flex; flex-direction: column; align-items: center; animation: finger-in .35s ease-out both; }
.finger.is-leaving { animation: finger-out .3s ease-in both; }
.finger-hand { font-size: 64px; line-height: 1; animation: finger-bob .6s ease-in-out infinite alternate;
  filter: drop-shadow(0 4px 6px rgba(0,0,0,.3)); }
.finger-label { font: 800 18px var(--font-display); color: #fff; background: var(--c-purple); padding: 6px 14px;
  border-radius: 999px; white-space: nowrap; box-shadow: 0 4px 14px rgba(0,0,0,.25); margin-bottom: 4px; }
@keyframes finger-in { from { opacity: 0; transform: translate(-50%, -160%) scale(.6); } }
@keyframes finger-out { to { opacity: 0; transform: translate(-50%, -140%) scale(.8); } }
@keyframes finger-bob { to { transform: translateY(12px); } }
.party { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 70; pointer-events: none; }
.banner { position: fixed; left: 0; right: 0; top: 34vh; z-index: 80; pointer-events: none; display: flex; justify-content: center;
  animation: banner-fly 4.2s cubic-bezier(.2,.8,.3,1) both; }
.banner span { font: 800 clamp(56px, 10vw, 128px) / 1 var(--font-display); padding: 18px 44px; border-radius: 28px;
  color: #fff; background: linear-gradient(100deg, var(--c-scarlet), var(--c-orange) 35%, var(--c-yellow) 50%, var(--c-purple) 85%);
  box-shadow: 0 18px 50px rgba(0,0,0,.35); text-shadow: 0 3px 0 rgba(0,0,0,.25); transform: rotate(-4deg); white-space: nowrap; }
@keyframes banner-fly {
  0% { transform: translateX(110vw) scale(.8); }
  22% { transform: translateX(0) scale(1.06); }
  30%, 72% { transform: translateX(0) scale(1); }
  100% { transform: translateX(-120vw) scale(.8); }
}
`;
