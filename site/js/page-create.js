// 生成页：选繁简、纸样，调用接口生成小楷作品，装成挂轴展示并可下载。
// 书写中纸面化作一池水，墨滴落下荡开涟漪、墨在水里洇开，墨虾从纸边游过；写完水面平息、墨虾游走，作品显现
import { loadPoems } from './poems.js';
import { fetchQuota, render, ApiError } from './api.js';
import { Water, makeShrimp, paddle, glide, flex, drawShrimp, fitCanvas, reducedMotion, clamp, turnTo } from './water.js';

const $ = (id) => document.getElementById(id);
const btn = $('generate'), status = $('status'), blank = $('blank'), hint = $('hint'), blob = $('blob');
const artwork = $('artwork'), artImg = $('artImg'), actions = $('actions'), download = $('download');
const inkLayer = $('inkLayer');
const radios = document.querySelectorAll('input[type=radio]');

// 书写动画至少放这么久，接口秒出时也能看到墨滴入水
const MIN_WRITE_MS = 3000;
const HINTS = { ready: '点生成，作品挂在这里', loading: '正在书写', limit: '额度已用完' };

const ui = { stage: 'ready', edition: 'trad', style: 'clean', limited: false, remaining: null, error: '', url: null, format: 'jpg' };
let poem = null;

function show() {
  const { stage, edition, style } = ui, zhalan = style === 'zhalan', done = stage === 'done';
  const editionLabel = edition === 'trad' ? '繁体' : '简体', styleLabel = zhalan ? '乌丝栏' : '素笺';
  $('caption').textContent = `${poem.a_simp}　${poem.t_simp}　${editionLabel} · ${styleLabel}`;
  artwork.hidden = !done;
  actions.hidden = !done;
  blank.hidden = done;
  blank.classList.toggle('ruled', zhalan);
  hint.textContent = HINTS[stage] || '';
  hint.classList.toggle('warn', stage === 'limit');
  // 减少动态效果时，书写中用墨晕代替水面动画
  blob.hidden = !(stage === 'loading' && reducedMotion());
  btn.disabled = stage === 'loading' || ui.limited;
  for (const r of radios) r.disabled = stage === 'loading';
  btn.textContent = stage === 'loading' ? '书写中' : done ? '重写' : '生成';
  status.classList.toggle('warn', !!ui.error || ui.limited);
  status.textContent = ui.error || (ui.limited ? '额度已用完，稍后再来' : ui.remaining === null ? '' : `还可生成 ${ui.remaining} 幅`);
  pondStage(stage);
}

function setQuota(remaining, allowed = remaining === null || remaining > 0) {
  ui.remaining = remaining;
  ui.limited = !allowed;
}

// 改参数后旧作品不再对应，回到待生成
function onPick(e) {
  ui[e.target.name] = e.target.value;
  ui.stage = ui.limited ? 'limit' : 'ready';
  ui.error = '';
  show();
}

async function generate() {
  ui.stage = 'loading';
  ui.error = '';
  show();
  const started = performance.now();
  let next = 'ready';
  try {
    const [res] = await Promise.all([render(poem, ui.edition, ui.style), new Promise((ok) => setTimeout(ok, MIN_WRITE_MS))]);
    if (ui.url) URL.revokeObjectURL(ui.url);
    ui.url = URL.createObjectURL(res.blob);
    ui.format = res.format;
    if (res.remaining !== null) setQuota(res.remaining);
    artImg.src = ui.url;
    artImg.alt = `生成的小楷作品：${poem.a_simp}《${poem.t_simp}》`;
    download.href = ui.url;
    download.download = `${poem.t_simp.replace(/[\\/:*?"<>|]/g, '')}_星树书房.${ui.format}`;
    next = 'done';
  } catch (err) {
    // 接口失败也等动画放完再回到待生成，免得一闪而过
    const left = MIN_WRITE_MS - (performance.now() - started);
    if (left > 0) await new Promise((ok) => setTimeout(ok, left));
    if (err instanceof ApiError && err.status === 429) {
      setQuota(0, false);
      next = 'limit';
    } else {
      ui.error = err instanceof ApiError ? err.message : '书写服务暂时连不上，稍后再试';
    }
  }
  ui.stage = next;
  show();
}

// ———— 书写中的水池 ————

const water = new Water($('waterLayer'));
const WANDER = { hover: [0.16, 0.8, 1.4], back: [0.24, 50, 30, 60, 0.5, 0.6], fwd: [60, 60, 60, 0.5, 1.0] };
const pond = { shrimp: [], blots: [], drops: [], last: 0, time: 0, phase: 'idle', stage: null, t0: 0, w0: 0, nextDrop: 0, first: true, blank: true };

function pondStage(stage) {
  if (stage === pond.stage) return;
  if (stage === 'loading' && !reducedMotion()) startPond(pond.time);
  else if (pond.phase === 'write') settlePond(pond.time);
  pond.stage = stage;
}

function tick(now) {
  const dt = pond.last ? Math.min(0.05, (now - pond.last) / 1000) : 0;
  pond.last = now;
  pond.time = now / 1000;
  const t = pond.time, W = inkLayer.clientWidth, H = inkLayer.clientHeight, dpr = window.devicePixelRatio || 1;
  if (pond.phase === 'idle' || !W || !H || reducedMotion()) {
    if (!pond.blank) { fitCanvas(inkLayer, W, H, dpr); water.clear(); pond.blank = true; }
    return;
  }
  const ctx = fitCanvas(inkLayer, W, H, dpr);
  pond.blank = false;
  // 写完后约 1.6 秒内水波渐小、墨渐淡
  let fade = 1;
  if (pond.phase === 'settle') {
    const k = Math.min(1, (t - pond.t0) / 1.6);
    fade = 1 - k * k * (3 - 2 * k);
    if (k >= 1) { pond.phase = 'idle'; fitCanvas(inkLayer, W, H, dpr); water.clear(); pond.blank = true; return; }
  }
  // 水面从静到动：第一滴墨落下后，微波慢慢起来
  water.amb = (0.3 + 0.7 * Math.min(1, (t - pond.w0) / 2.5)) * fade;
  water.rip = fade;
  water.prune(t);
  if (pond.phase === 'write' && t >= pond.nextDrop) {
    dropInk(W, H, t);
    pond.nextDrop = t + 1.8 + Math.random() * 1.2;
  }
  // 墨滴落到水面：激起涟漪，墨在落点洇开
  for (const d of pond.drops) {
    if (t - d.t0 < 0.45) continue;
    d.hit = true;
    water.add(d.x, d.y, d.k, t);
    bloom(t, d.x, d.y, d.k);
  }
  pond.drops = pond.drops.filter((d) => !d.hit);
  water.render(W, H, t, { scale: Math.min(2, dpr), fade: Math.min(1, (t - pond.w0) / 0.4) * fade });
  for (const s of pond.shrimp) stepShrimp(s, dt, W, H);
  for (const s of pond.shrimp) {
    if (s.mode !== 'swim' && s.mode !== 'dart') continue;
    const g = water.grad(s.x, s.y, t);
    s.rx = -g[0] * 18;
    s.ry = -g[1] * 18;
    s.alpha = fade;
    drawShrimp(ctx, s, t);
  }
  drawInk(ctx, dt, t, fade);
}

function startPond(t) {
  pond.phase = 'write';
  pond.t0 = pond.w0 = t;
  water.src = [];
  pond.blots = [];
  pond.drops = [];
  pond.nextDrop = t + 0.1;
  pond.first = true;
  if (!pond.shrimp.length) {
    pond.shrimp = Array.from({ length: 2 }, () => {
      const near = Math.random(), s = makeShrimp(52 + 28 * Math.pow(near, 1.2), 0.6 + 0.4 * near);
      s.alpha = 1;
      return s;
    });
  }
  pond.shrimp.forEach((s, i) => { s.mode = 'waiting'; s.delay = 0.7 + i * 0.9 + Math.random() * 0.4; });
}

// 写完：不再落墨，墨虾伸直身子朝最近的纸边游走
function settlePond(t) {
  const W = inkLayer.clientWidth, H = inkLayer.clientHeight;
  pond.phase = 'settle';
  pond.t0 = t;
  pond.drops = [];
  for (const s of pond.shrimp) {
    if (s.mode !== 'swim') { s.mode = 'hidden'; continue; }
    s.mode = 'dart';
    const ex = [[-s.L * 2, s.y, s.x], [W + s.L * 2, s.y, W - s.x], [s.x, -s.L * 2, s.y], [s.x, H + s.L * 2, H - s.y]].sort((a, b) => a[2] - b[2])[0];
    s.tx = ex[0];
    s.ty = ex[1];
  }
}

// 一滴墨从上方落下；第一滴落在纸面上部、最重，之后随机落在别处、轻一些，避开中间的提示字
function dropInk(W, H, t) {
  let x = W * 0.5, y = H * 0.27, k = 1;
  if (!pond.first) {
    k = 0.45 + 0.2 * Math.random();
    for (let i = 0; i < 12; i++) {
      x = W * (0.18 + 0.64 * Math.random());
      y = H * (0.14 + 0.72 * Math.random());
      if (Math.abs(x - W / 2) > 60 || Math.abs(y - H / 2) > 110) break;
    }
  }
  pond.first = false;
  pond.drops.push({ x, y, k, t0: t, hit: false });
}

// 墨入水：一团浓墨心，四周几缕淡墨被冲开、越洇越大、慢慢变淡
function bloom(t, x, y, k) {
  const n = Math.round(6 + 8 * k);
  pond.blots.push({ x, y, vx: 0, vy: 0, r0: 3 + 3 * k, grow: 12 + 14 * k, a: 0.5, t0: t, tau: 6 });
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = (12 + 50 * Math.random()) * (0.5 + k);
    pond.blots.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r0: 2 + 4 * Math.random(),
      grow: (10 + 24 * Math.random()) * (0.6 + 0.6 * k), a: 0.14 + 0.16 * Math.random(), t0: t, tau: 4 + 4 * Math.random() });
  }
  if (pond.blots.length > 160) pond.blots.splice(0, pond.blots.length - 160);
}

function drawInk(ctx, dt, t, fade) {
  const ink = (a) => 'rgba(28,26,23,' + clamp(a, 0, 1).toFixed(3) + ')';
  pond.blots = pond.blots.filter((b) => t - b.t0 < b.tau * 4);
  for (const b of pond.blots) {
    const age = t - b.t0, f = Math.exp(-1.1 * dt);
    b.vx *= f;
    b.vy *= f;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const r = b.r0 + b.grow * (1 - Math.exp(-age / 1.4)), a = b.a * Math.min(1, age / 0.15) * Math.exp(-age / b.tau) * fade;
    if (a < 0.004) continue;
    const g = water.grad(b.x, b.y, t), x = b.x - g[0] * 18, y = b.y - g[1] * 18;
    const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, ink(a));
    gr.addColorStop(0.55, ink(a * 0.6));
    gr.addColorStop(1, ink(0));
    ctx.fillStyle = gr;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 下落中的墨滴：俯看是一粒越来越大的浓墨，影子从斜下方收拢到落点
  for (const d of pond.drops) {
    const k = Math.max(0, (t - d.t0) / 0.45), rd = (2 + 3.5 * k) * (0.7 + 0.3 * d.k), lift = 1 - k;
    ctx.fillStyle = ink(0.12 * k * fade);
    ctx.beginPath();
    ctx.ellipse(d.x + lift * 16, d.y + lift * 8, rd * 1.3, rd, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink(Math.min(1, k * 4) * 0.92 * fade);
    ctx.beginPath();
    ctx.ellipse(d.x, d.y - lift * 26, rd, rd * 1.25, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function stepShrimp(s, dt, W, H) {
  s.t += dt;
  s.clock += dt;
  if (s.mode === 'hidden') return;
  if (s.mode === 'waiting') {
    s.delay -= dt;
    if (s.delay > 0) return;
    // 从任意一边纸缘游进来，朝对边某处去
    const side = Math.floor(Math.random() * 4), u = 0.2 + 0.6 * Math.random(), v = 0.2 + 0.6 * Math.random(), m = s.L * 0.3;
    const ends = [[-m, H * u, W + s.L * 2, H * v], [W + m, H * u, -s.L * 2, H * v], [W * u, -m, W * v, H + s.L * 2], [W * u, H + m, W * v, -s.L * 2]][side];
    [s.x, s.y, s.tx, s.ty] = ends;
    s.ang = s.prevAng = s.wanderAng = Math.atan2(s.ty - s.y, s.tx - s.x) + (Math.random() - 0.5) * 0.5;
    s.vx = Math.cos(s.ang) * 130;
    s.vy = Math.sin(s.ang) * 130;
    s.kick = 1;
    s.thrustIn = 0.5;
    s.mode = 'swim';
    s.t = 0;
  }
  let drag = 1.4, bendTo = s.habit, swim = 6;
  if (s.mode === 'swim') {
    // 与首页游荡同一套划水，大方向朝对边
    s.wanderAng += (Math.random() - 0.5) * 3 * dt;
    s.wanderAng += turnTo(s.wanderAng, Math.atan2(s.ty - s.y, s.tx - s.x)) * 0.7 * dt;
    s.ang += clamp(turnTo(s.ang, s.wanderAng), -1.6 * dt, 1.6 * dt);
    ({ bendTo, swim } = paddle(s, dt, WANDER));
  } else if (s.mode === 'dart') {
    // 伸直身子，游泳足快划，朝最近的纸边游出去
    const off = turnTo(s.ang, Math.atan2(s.ty - s.y, s.tx - s.x));
    s.ang += clamp(off, -5 * dt, 5 * dt);
    const sp = 340 * s.L / 60 * Math.max(0.2, Math.cos(off));
    s.vx += (Math.cos(s.ang) * sp - s.vx) * Math.min(1, 3 * dt);
    s.vy += (Math.sin(s.ang) * sp - s.vy) * Math.min(1, 3 * dt);
    drag = 0;
    bendTo = 0.02;
    swim = 10;
  }
  glide(s, dt, drag);
  // 游出纸面就藏起来；还在书写就过一会儿再从别处游进来
  const out = Math.max(-s.x, s.x - W, -s.y, s.y - H);
  if (s.t > 1 && out > s.L * 1.2) {
    s.mode = pond.phase === 'write' ? 'waiting' : 'hidden';
    s.delay = 0.8 + Math.random() * 1.2;
    return;
  }
  flex(s, dt, { bendTo, swim, K: s.mode === 'dart' ? 60 : 40, sway: s.mode === 'swim' });
}

const loop = (now) => { tick(now); requestAnimationFrame(loop); };

// ———— 启动 ————

const id = new URLSearchParams(location.search).get('id');
loadPoems().then((list) => {
  poem = list.find((p) => p.id === id);
  // 没有指定诗或诗库里没有这首，回选诗页
  if (!poem) { location.replace('poems.html'); return; }
  document.title = `星树书房 · ${poem.t_simp}`;
  $('title').textContent = poem.t_simp;
  $('meta').textContent = `${poem.a_simp} · ${poem.cat} · ${poem.count} 字`;
  $('back').href = 'poems.html?id=' + encodeURIComponent(poem.id);
  for (const r of radios) {
    r.checked = r.value === ui[r.name];
    r.addEventListener('change', onPick);
  }
  btn.addEventListener('click', generate);
  show();
  requestAnimationFrame(loop);
  fetchQuota().then((q) => {
    setQuota(q.remaining ?? null, q.allowed);
    if (ui.limited && ui.stage === 'ready') ui.stage = 'limit';
    show();
  }).catch(() => { /* 额度查不到时不显示，生成时以接口返回为准 */ });
}).catch((e) => {
  status.textContent = e.message + '，请刷新重试。';
});
