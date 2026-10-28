// 首页：挂轴卷起后墨虾从荷花图里游出，在水中随处游动；点击时尾扇连弹向后逃开，再伸直身子游到远处躲着；
// 挂轴放下时游回画里消失。鼠标划过水面留下涟漪尾迹。
// 场景坐标是整页（#pond）坐标；画布固定在视口上，按滚动位置平移着画。
import { Water, makeShrimp, paddle, glide, flex, drawShrimp, fitCanvas, reducedMotion, clamp, turnTo } from './water.js';

const root = document.getElementById('pond');
const under = document.getElementById('pondUnder');
const top = document.getElementById('pondTop');
const lotus = document.getElementById('lotus');
const works = document.getElementById('works');
const scrollBtn = document.getElementById('scrollBtn');
const capOpen = document.getElementById('capOpen');
const capRolled = document.getElementById('capRolled');

const water = new Water(document.getElementById('pondWater'));
const pond = { shrimp: [], last: 0, time: 0, wasRolled: null, ptr: null, live: false };
let rolled = false;

const WANDER = { hover: [0.22, 1.2, 2.2], back: [0.34, 60, 40, 90, 0.6, 0.8], fwd: [45, 60, 90, 0.5, 1.2] };

// 挂轴：点击卷起/放下。放下时若有墨虾在外，先让虾游回画里，挂轴稍后再放下
scrollBtn.addEventListener('click', () => {
  const out = pond.live && pond.shrimp.some((s) => s.mode !== 'hidden' && s.mode !== 'waiting');
  rolled = !rolled;
  const wait = !rolled && out ? 0.9 : 0;
  works.classList.toggle('rolled', rolled);
  works.style.setProperty('--roll-delay', wait + 's');
  works.style.setProperty('--curl', rolled ? 'curlUp' : 'curlDown');
  scrollBtn.setAttribute('aria-pressed', String(rolled));
  scrollBtn.setAttribute('aria-label', rolled ? '放下《爱莲说》挂轴' : '卷起《爱莲说》挂轴，看后面的荷花图');
  // 说明文字交叉淡入淡出：旧的随动画开始淡出，新的等卷完再出现
  capOpen.style.opacity = rolled ? '0' : '1';
  capOpen.style.transitionDelay = rolled ? '0s' : (2.4 + wait) + 's';
  capOpen.setAttribute('aria-hidden', String(rolled));
  capRolled.style.opacity = rolled ? '1' : '0';
  capRolled.style.transitionDelay = rolled ? '2.4s' : '0s';
  capRolled.setAttribute('aria-hidden', String(!rolled));
});

// 墨虾大小、墨色各不相同：越大越浓，像近处的虾；窄屏上整体小一些
function newShrimp(W) {
  const near = Math.random(), k = clamp(W / 1100, 0.55, 1);
  const s = makeShrimp((55 + 95 * Math.pow(near, 1.2)) * k, 0.5 + 0.5 * near);
  s.scale = 0.35;
  return s;
}

function sceneRect() {
  const rr = root.getBoundingClientRect();
  return { rr, W: rr.width, H: rr.height };
}

function tick(now) {
  const dt = pond.last ? Math.min(0.05, (now - pond.last) / 1000) : 0;
  pond.last = now;
  pond.time = now / 1000;
  const t = pond.time;
  const { rr, W, H } = sceneRect();
  const vw = top.clientWidth, vh = top.clientHeight, ox = -rr.left, oy = -rr.top, dpr = window.devicePixelRatio || 1;
  // 两层虾：水下一层画全身；荷花图画框内另在最上层画一遍，出画、回画时虾才能盖在画上
  const ctxTop = fitCanvas(top, vw, vh, dpr, ox, oy), ctxLow = fitCanvas(under, vw, vh, dpr, ox, oy);
  water.prune(t);
  // 视口很大时降低水面分辨率，像素总数控制在约 260 万
  water.render(vw, vh, t, { scale: Math.min(1, Math.sqrt(2.6e6 / (vw * vh))), ox, oy });
  const ir = lotus.getBoundingClientRect(), fe = lotus.parentElement.getBoundingClientRect();
  const box = { x: ir.left - rr.left, y: ir.top - rr.top, w: ir.width, h: ir.height };
  const fr = { x: fe.left - rr.left, y: fe.top - rr.top, w: fe.width, h: fe.height };
  if (!pond.shrimp.length) pond.shrimp = Array.from({ length: 8 }, () => newShrimp(W));
  if (rolled !== pond.wasRolled) {
    if (rolled) {
      // 等挂轴卷完再出画；开始画水时挂轴已是卷起状态就立即出画
      const wait = pond.wasRolled === null ? 0.3 : 2.5;
      pond.shrimp.forEach((s, i) => {
        if (s.mode === 'return' || s.mode === 'vanish') { s.mode = 'wander'; s.alpha = 1; s.scale = 1; s.wanderAng = s.ang; return; }
        if (s.mode === 'hidden') { s.mode = 'waiting'; s.delay = wait + i * 0.2 + Math.random() * 0.4; }
      });
    } else if (pond.wasRolled) {
      pond.shrimp.forEach((s) => {
        if (s.mode === 'waiting' || s.mode === 'hidden') { s.mode = 'hidden'; return; }
        s.mode = 'return';
        s.tx = box.x + box.w * (0.2 + 0.6 * Math.random());
        s.ty = box.y + box.h * (0.3 + 0.5 * Math.random());
      });
    }
    pond.wasRolled = rolled;
  }
  for (const s of pond.shrimp) stepShrimp(s, dt, box, fr, W, H);
  for (const s of pond.shrimp) {
    if (s.alpha <= 0.01) continue;
    // 长须拖得远，视口外 4 个身长以内仍要画
    const m = 4 * s.L;
    if (s.x < ox - m || s.x > ox + vw + m || s.y < oy - m || s.y > oy + vh + m) continue;
    // 隔着起伏的水面看，虾随涟漪轻轻晃动（只影响画的位置）
    const g = water.grad(s.x, s.y, t);
    s.rx = -g[0] * 18;
    s.ry = -g[1] * 18;
    drawShrimp(ctxLow, s, t);
    if (s.framed) {
      ctxTop.save();
      ctxTop.beginPath();
      ctxTop.rect(fr.x, fr.y, fr.w, fr.h);
      ctxTop.clip();
      drawShrimp(ctxTop, s, t);
      ctxTop.restore();
    }
  }
}

function stepShrimp(s, dt, box, fr, W, H) {
  s.t += dt;
  s.clock += dt;
  if (s.mode === 'hidden') { s.alpha = 0; s.framed = false; return; }
  if (s.mode === 'waiting') {
    s.delay -= dt;
    if (s.delay > 0) return;
    s.mode = 'emerge';
    s.t = 0;
    s.framed = true;
    s.x = box.x + box.w * (0.15 + 0.7 * Math.random());
    s.y = box.y + box.h * (0.15 + 0.7 * Math.random());
    s.ang = s.prevAng = Math.atan2(s.y - (box.y + box.h / 2), s.x - (box.x + box.w / 2)) + (Math.random() - 0.5) * 0.8;
    s.vx = Math.cos(s.ang) * 40;
    s.vy = Math.sin(s.ang) * 40;
  }
  // 每个状态给出：阻力、目标弯曲度、小脚划动频率、小脚划动幅度
  let drag = 1.4, bendTo = s.habit, swim = 6, limb = 1;
  if (s.mode === 'emerge') {
    // 由淡变浓、由小变大，像从画面里浮出来，同时朝画外游
    const k = Math.min(1, s.t / 1.2);
    s.alpha = k;
    s.scale = 0.35 + 0.65 * k;
    s.vx += Math.cos(s.ang) * 150 * dt;
    s.vy += Math.sin(s.ang) * 150 * dt;
    drag = 0.9;
    swim = 8;
    if (k >= 1) { s.mode = 'wander'; s.wanderAng = s.ang; s.thrustIn = 0.4; }
  } else if (s.mode === 'wander') {
    // 随意游动，靠近页面边缘就掉头
    s.wanderAng += (Math.random() - 0.5) * 3 * dt;
    let want = s.wanderAng;
    const m = 90;
    if (s.x < m || s.x > W - m || s.y < m || s.y > H - m) {
      want = Math.atan2(H / 2 - s.y, W / 2 - s.x);
      s.wanderAng += turnTo(s.wanderAng, want) * 2 * dt;
    }
    s.ang += clamp(turnTo(s.ang, want), -1.6 * dt, 1.6 * dt);
    ({ bendTo, swim } = paddle(s, dt, WANDER));
  } else if (s.mode === 'flee') {
    // 头先转向惊扰处，尾扇猛收、身体弓紧，整只虾向后弹出；连弹几下，一下比一下弱，小脚收拢
    drag = 3.2;
    bendTo = 0.45;
    swim = 0;
    limb = 0;
    if (s.aim > 0) { s.aim -= dt; s.ang += clamp(turnTo(s.ang, s.threatAng), -20 * dt, 20 * dt); }
    s.flipIn -= dt;
    if (s.flips > 0 && s.flipIn <= 0) {
      s.vx -= Math.cos(s.ang) * s.power;
      s.vy -= Math.sin(s.ang) * s.power;
      s.bend = 1;
      s.bendV = 0;
      water.add(s.x - Math.cos(s.ang) * s.L * 0.5, s.y - Math.sin(s.ang) * s.L * 0.5, Math.min(0.7, s.power / 1300), pond.time);
      s.power *= 0.6;
      s.flips -= 1;
      s.flipIn = 0.17 + Math.random() * 0.06;
    }
    if (s.flips === 0 && s.flipIn < -0.25) { s.mode = 'hide'; s.t = 0; pickHaven(s, W, H, fr); }
  } else if (s.mode === 'hide') {
    // 转身伸直，游泳足快划，游到远离惊扰处的地方
    const dx = s.hx - s.x, dy = s.hy - s.y, dist = Math.hypot(dx, dy), off = turnTo(s.ang, Math.atan2(dy, dx));
    s.ang += clamp(off, -5 * dt, 5 * dt);
    const sp = (110 + 140 * Math.min(1, dist / 250)) * s.L / 90 * Math.max(0, Math.cos(off));
    s.vx += (Math.cos(s.ang) * sp - s.vx) * Math.min(1, 2.5 * dt);
    s.vy += (Math.sin(s.ang) * sp - s.vy) * Math.min(1, 2.5 * dt);
    drag = 0;
    bendTo = 0.02;
    swim = 10;
    if (dist < 30 || s.t > 7) { s.mode = 'rest'; s.t = 0; s.restFor = 1.2 + Math.random() * 1.5; }
  } else if (s.mode === 'rest') {
    // 到了安全处停下，身子慢慢放松回平时的弯度
    drag = 2.4;
    swim = 3;
    if (s.t > s.restFor) { s.mode = 'wander'; s.wanderAng = s.ang; s.thrustIn = 0.3 + Math.random() * 0.6; }
  } else if (s.mode === 'return') {
    // 主动游回画里：头朝目标，伸直身子，越远游得越快
    const dist = Math.hypot(s.tx - s.x, s.ty - s.y);
    s.framed = true;
    s.ang += clamp(turnTo(s.ang, Math.atan2(s.ty - s.y, s.tx - s.x)), -8 * dt, 8 * dt);
    const sp = clamp(dist / 0.7, 420, 1500);
    s.vx += (Math.cos(s.ang) * sp - s.vx) * Math.min(1, 6 * dt);
    s.vy += (Math.sin(s.ang) * sp - s.vy) * Math.min(1, 6 * dt);
    s.kick = 1;
    drag = 0;
    bendTo = 0.05;
    swim = 10;
    if (dist < 40) { s.mode = 'vanish'; s.t = 0; }
  } else if (s.mode === 'vanish') {
    const k = Math.min(1, s.t / 0.45);
    s.alpha = 1 - k;
    s.scale = 1 - 0.6 * k;
    drag = 4;
    bendTo = 0.05;
    swim = 10;
    if (k >= 1) s.mode = 'hidden';
  }
  glide(s, dt, drag);
  if (s.mode === 'flee' || s.mode === 'wander' || s.mode === 'hide' || s.mode === 'rest') {
    if (s.x < 10 || s.x > W - 10) { s.x = clamp(s.x, 10, W - 10); s.vx *= -0.3; }
    if (s.y < 10 || s.y > H - 10) { s.y = clamp(s.y, 10, H - 10); s.vy *= -0.3; }
    // 出画后虾身离开画框，就只在水下那层画；之后再游到画下面会被画挡住
    if (s.framed) {
      const ox = Math.max(fr.x - s.x, 0, s.x - fr.x - fr.w), oy = Math.max(fr.y - s.y, 0, s.y - fr.y - fr.h);
      if (Math.hypot(ox, oy) > s.L * 0.8) s.framed = false;
    }
  }
  // 惊逃时身体最硬最快，歇下时最软
  flex(s, dt, { bendTo, swim, limb, K: s.mode === 'flee' ? 160 : s.mode === 'rest' ? 16 : 40, sway: s.mode === 'wander' || s.mode === 'rest' });
}

// 安全处：随机取一些点，挑离惊扰处远、离自己不太远、游过去又不用钻到荷花图下面的
function pickHaven(s, W, H, fr) {
  const underArt = (x, y) => x > fr.x - 60 && x < fr.x + fr.w + 60 && y > fr.y - 60 && y < fr.y + fr.h + 60;
  // 已经被弹到画下面的，只要目标在画外就行，游出来就看得见
  const startIn = underArt(s.x, s.y);
  let best = null, bestScore = -Infinity;
  for (let i = 0; i < 20; i++) {
    const x = 110 + Math.random() * Math.max(1, W - 220), y = 110 + Math.random() * Math.max(1, H - 220);
    let blocked = underArt(x, y);
    for (let k = 1; k < 10 && !blocked && !startIn; k++) blocked = underArt(s.x + (x - s.x) * k / 10, s.y + (y - s.y) * k / 10);
    if (blocked) continue;
    const score = Math.min(650, Math.hypot(x - s.threatX, y - s.threatY)) - 0.25 * Math.hypot(x - s.x, y - s.y) + 60 * Math.random();
    if (score > bestScore) { bestScore = score; best = [x, y]; }
  }
  if (!best) {
    const a = Math.atan2(s.y - s.threatY, s.x - s.threatX);
    best = [clamp(s.x + Math.cos(a) * 300, 60, W - 60), clamp(s.y + Math.sin(a) * 300, 60, H - 60)];
  }
  s.hx = best[0];
  s.hy = best[1];
}

// 点击水面：激起一圈大涟漪，附近的虾受惊弹逃
function startle(e) {
  if (!pond.live) return;
  const { rr } = sceneRect(), cx = e.clientX - rr.left, cy = e.clientY - rr.top;
  water.add(cx, cy, 1, pond.time);
  for (const s of pond.shrimp) {
    if (s.mode !== 'wander' && s.mode !== 'flee' && s.mode !== 'emerge' && s.mode !== 'hide' && s.mode !== 'rest') continue;
    const d = Math.hypot(s.x - cx, s.y - cy);
    if (d > 260) continue;
    s.mode = 'flee';
    s.alpha = 1;
    s.scale = 1;
    s.threatX = cx;
    s.threatY = cy;
    s.threatAng = Math.atan2(cy - s.y, cx - s.x);
    s.aim = 0.08;
    s.flips = d < 140 ? 3 : 2;
    s.power = 300 + 650 * (1 - d / 260);
    s.flipIn = 0.06 + Math.random() * 0.05;
  }
}

// 鼠标划过水面：沿轨迹每隔一段投一个小波源，连起来就是尾迹；附近的虾被水推开一点
function stir(e) {
  if (!pond.live) return;
  const { rr } = sceneRect(), x = e.clientX - rr.left, y = e.clientY - rr.top, t = pond.time, m = pond.ptr;
  if (!m || t - m.t > 0.3) {
    water.add(x, y, 0.25, t);
    pond.ptr = { x, y, t };
    return;
  }
  const d = Math.hypot(x - m.x, y - m.y);
  if (d < 18 || t - m.t < 0.05) return;
  const k = Math.min(0.6, 0.12 + d / Math.max(t - m.t, 0.016) / 2500);
  water.add(x, y, k, t);
  for (const s of pond.shrimp) {
    if (s.mode !== 'wander' && s.mode !== 'rest') continue;
    const dx = s.x - x, dy = s.y - y, ds = Math.hypot(dx, dy);
    if (ds > 110 || ds < 1) continue;
    const push = 60 * k * (1 - ds / 110);
    s.vx += dx / ds * push;
    s.vy += dy / ds * push;
  }
  pond.ptr = { x, y, t };
}

root.addEventListener('click', startle);
root.addEventListener('pointermove', stir);

// 系统要求减少动态效果时不画水面和墨虾；设置中途切换也跟着停、启
let raf = 0;
const loop = (now) => { tick(now); raf = requestAnimationFrame(loop); };
function setLive() {
  pond.live = !reducedMotion();
  cancelAnimationFrame(raf);
  if (pond.live) {
    pond.last = 0;
    raf = requestAnimationFrame(loop);
  } else {
    for (const c of [under, top]) {
      const g = c.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
    }
    water.clear();
    pond.shrimp.forEach((s) => { s.mode = 'hidden'; });
    pond.wasRolled = null;
  }
}
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', setLive);
setLive();
