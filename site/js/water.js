// 水面与墨虾：首页和生成页共用。
// 水面：几组常态微波加上若干圈向外扩散的涟漪，由水面坡度算明暗、由曲率算水底焦散；
// 墨虾：齐白石笔意的分节虾身，按弯曲度实时拼接，长须、长钳、步足、游泳足每帧实时画。

export const TAU = Math.PI * 2;
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const turnTo = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
export const reducedMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

// 2D 画布对齐尺寸并清空；(ox, oy) 是画布左上角在场景坐标里的位置
export function fitCanvas(c, W, H, dpr, ox = 0, oy = 0) {
  if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) {
    c.width = Math.round(W * dpr);
    c.height = Math.round(H * dpr);
  }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.translate(-ox, -oy);
  return ctx;
}

// 常态微波：方向（度）、波长（px）、聚光强度、初相；聚光强度 = 水深 × 波高 × k²，换算成波高存起来
const DEPTH = 90;
const AMB = [[12, 120, 0.4, 0], [77, 95, 0.4, 1.7], [139, 77, 0.4, 4.1], [203, 58, 0.35, 2.6], [254, 105, 0.4, 5.3], [318, 48, 0.3, 0.9], [35, 66, 0.35, 3.3], [290, 84, 0.35, 2.0]].map(([deg, lam, focus, ph]) => {
  const r = deg * Math.PI / 180, k = 2 * Math.PI / lam;
  return [Math.cos(r), Math.sin(r), k, focus / (DEPTH * k * k), 5 * Math.sqrt(k), ph];
});
const MAX_SRC = 32;

export class Water {
  constructor(canvas) {
    this.cv = canvas;
    this.src = [];
    // 微波、涟漪强弱，水面平息时减小
    this.amb = 1;
    this.rip = 1;
    this.gl = undefined;
    this.cleared = true;
  }

  // 新波源；满 32 个时挤掉此刻最弱的一个
  add(x, y, k, t) {
    if (this.src.length >= MAX_SRC) {
      let wi = 0, wv = Infinity;
      this.src.forEach((r, i) => {
        const v = r.k * Math.exp(-(t - r.t0) / (0.45 + 1.4 * r.k));
        if (v < wv) { wv = v; wi = i; }
      });
      this.src.splice(wi, 1);
    }
    this.src.push({ x, y, t0: t, k });
  }

  prune(t) {
    this.src = this.src.filter((r) => t - r.t0 < 4 * (0.45 + 1.4 * r.k));
  }

  // 水面在 (x, y) 处的坡度，公式与着色器一致
  grad(x, y, t) {
    let gx = 0, gy = 0;
    for (const [ax, ay, k, a, w, ph] of AMB) {
      const c = this.amb * a * k * Math.cos(k * (ax * x + ay * y) + ph - w * t);
      gx += c * ax;
      gy += c * ay;
    }
    for (const r of this.src) {
      const age = t - r.t0, dx = x - r.x, dy = y - r.y, d = Math.max(8, Math.hypot(dx, dy));
      const u = (d - 150 * age) / (22 + 30 * age);
      if (Math.abs(u) > 3) continue;
      const k = 2 * Math.PI / (24 + 22 * r.k);
      const a = this.rip * 1.6 * r.k * Math.exp(-u * u - age / (0.45 + 1.4 * r.k)) / Math.sqrt(1 + d / 50);
      const f1 = a * k * Math.cos(k * (d - 100 * age));
      gx += f1 * dx / d;
      gy += f1 * dy / d;
    }
    return [gx, gy];
  }

  init() {
    const gl = this.cv.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false });
    if (!gl) return null;
    const num = (v) => v.toFixed(6);
    const amb = AMB.map((a, i) => '  wave(vec2(' + num(a[0]) + ', ' + num(a[1]) + '), ' + num(a[2]) + ', ' + num(a[3]) + ' * uAmb, uPh[' + i + '], p, g, H);').join('\n');
    const fs = [
      '#ifdef GL_FRAGMENT_PRECISION_HIGH',
      'precision highp float;',
      '#else',
      'precision mediump float;',
      '#endif',
      'uniform vec2 uRes;',
      'uniform vec2 uScale;',
      'uniform vec2 uOff;',
      'uniform float uPh[' + AMB.length + '];',
      'uniform vec4 uSrc[' + MAX_SRC + '];',
      'uniform float uAmb;',
      'uniform float uRip;',
      'uniform float uFade;',
      'void wave(vec2 dir, float k, float a, float ph, vec2 p, inout vec2 g, inout vec3 H) {',
      '  float s = k * dot(dir, p) + ph;',
      '  g += a * k * cos(s) * dir;',
      '  H -= a * k * k * sin(s) * vec3(dir.x * dir.x, dir.x * dir.y, dir.y * dir.y);',
      '}',
      'void main() {',
      '  vec2 p = vec2(gl_FragCoord.x, uRes.y * uScale.y - gl_FragCoord.y) / uScale + uOff;',
      '  vec2 g = vec2(0.0);',
      '  vec3 H = vec3(0.0);',
      amb,
      '  for (int i = 0; i < ' + MAX_SRC + '; i++) {',
      '    vec4 s = uSrc[i];',
      '    if (s.w <= 0.0) continue;',
      '    vec2 d = p - s.xy;',
      '    float r = max(length(d), 8.0);',
      '    float u = (r - 150.0 * s.z) / (22.0 + 30.0 * s.z);',
      '    if (abs(u) > 3.0) continue;',
      '    float k = 6.2832 / (24.0 + 22.0 * s.w);',
      '    float a = uRip * 1.6 * s.w * exp(-u * u - s.z / (0.45 + 1.4 * s.w)) / sqrt(1.0 + r / 50.0);',
      '    float ph = k * (r - 100.0 * s.z);',
      '    float f1 = a * k * cos(ph), f2 = -a * k * k * sin(ph), q = f1 / r;',
      '    vec2 n = d / r;',
      '    g += f1 * n;',
      '    H += vec3(f2 * n.x * n.x + q * (1.0 - n.x * n.x), (f2 - q) * n.x * n.y, f2 * n.y * n.y + q * (1.0 - n.y * n.y));',
      '  }',
      '  float D = ' + num(DEPTH) + ';',
      '  float det = (1.0 - D * H.x) * (1.0 - D * H.z) - D * D * H.y * H.y;',
      '  float c = 1.0 / max(abs(det), 0.1);',
      '  float lit = clamp((c - 1.4) / 3.5, 0.0, 1.0);',
      '  float dim = clamp(1.0 - c, 0.0, 1.0);',
      '  float wa = 0.6 * lit;',
      '  float ia = 0.035 + 0.05 * dim;',
      '  gl_FragColor = vec4(vec3(1.0, 0.988, 0.95) * wa + vec3(0.11, 0.102, 0.09) * ia * (1.0 - wa), wa + ia * (1.0 - wa)) * uFade;',
      '}'
    ].join('\n');
    const vs = 'attribute vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }';
    const shader = (type, src) => {
      const o = gl.createShader(type);
      gl.shaderSource(o, src);
      gl.compileShader(o);
      return o;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      // 着色器编译失败时不画水面，墨虾照常；把原因打到控制台
      console.error('water shader:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const u = (name) => gl.getUniformLocation(prog, name);
    return { gl, srcBuf: new Float32Array(MAX_SRC * 4), ph: new Float32Array(AMB.length),
      uRes: u('uRes'), uScale: u('uScale'), uOff: u('uOff'), uPh: u('uPh'), uSrc: u('uSrc'), uAmb: u('uAmb'), uRip: u('uRip'), uFade: u('uFade') };
  }

  // W×H 是画布的 CSS 尺寸，scale 是每 CSS 像素对应的画布像素，(ox, oy) 是画布左上角在场景坐标里的位置
  render(W, H, t, { scale = 1, ox = 0, oy = 0, fade = 1 } = {}) {
    if (this.gl === undefined) this.gl = this.init();
    const w = this.gl;
    if (!w) return;
    const gl = w.gl, cw = Math.max(1, Math.round(W * scale)), ch = Math.max(1, Math.round(H * scale));
    if (this.cv.width !== cw || this.cv.height !== ch) { this.cv.width = cw; this.cv.height = ch; }
    gl.viewport(0, 0, cw, ch);
    gl.uniform2f(w.uRes, W, H);
    gl.uniform2f(w.uScale, cw / W, ch / H);
    gl.uniform2f(w.uOff, ox, oy);
    gl.uniform1f(w.uAmb, this.amb);
    gl.uniform1f(w.uRip, this.rip);
    gl.uniform1f(w.uFade, fade);
    AMB.forEach((a, i) => { w.ph[i] = (a[5] - a[4] * t) % TAU; });
    gl.uniform1fv(w.uPh, w.ph);
    w.srcBuf.fill(0);
    this.src.forEach((r, i) => { w.srcBuf.set([r.x, r.y, t - r.t0, r.k], i * 4); });
    gl.uniform4fv(w.uSrc, w.srcBuf);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.cleared = false;
  }

  clear() {
    const w = this.gl;
    if (!w || this.cleared) return;
    w.gl.clearColor(0, 0, 0, 0);
    w.gl.clear(w.gl.COLOR_BUFFER_BIT);
    this.cleared = true;
  }
}

// 一只墨虾：大小、墨色、背向、身形各不相同。弯曲度 bend：0 伸直，1 蜷紧；habit 是这只虾平时的弯度
export function makeShrimp(L, tone) {
  const arch = Math.random();
  return { x: 0, y: 0, vx: 0, vy: 0, ang: 0, prevAng: 0, turnRate: 0, L, tone,
    side: Math.random() < 0.5 ? 1 : -1,
    pose: { arch, claw: Math.random() - 0.5, ant: Math.random() },
    jit: Array.from({ length: 256 }, () => Math.random()), spr: null,
    mode: 'hidden', t: 0, clock: 0, alpha: 0, scale: 1, kick: 0, phase: Math.random() * 10,
    habit: 0.17 + 0.23 * arch, bend: 0.17 + 0.23 * arch, bendV: 0,
    padPh: Math.random() * 6, legPh: Math.random() * 6, swimHz: 5, limb: 1, yaw: 0, drift: 0,
    ph1: Math.random() * 6, ph2: Math.random() * 6, rx: 0, ry: 0, framed: false, hover: 0,
    wanderAng: 0, thrustIn: 0, flips: 0, flipIn: 0, power: 0, aim: 0, delay: 0, tx: 0, ty: 0,
    threatX: 0, threatY: 0, threatAng: 0, hx: 0, hy: 0, restFor: 0 };
}

// 一下一下划水前进，时而悬停、时而轻收尾巴后退；身体不停微微屈伸，被水带着侧漂。
// 朝向由调用方先定好；cfg 给出悬停、后退、前划三种动作的概率、力度和间隔。返回目标弯度和小脚划动频率
export function paddle(s, dt, cfg) {
  s.thrustIn -= dt;
  if (s.thrustIn <= 0) {
    const r = Math.random(), [hp, hb, hs] = cfg.hover, [bp, bb, bs, br, bt, bts] = cfg.back, [fb, fs, fr, ft, fts] = cfg.fwd;
    if (r < hp) {
      s.hover = 1;
      s.thrustIn = hb + Math.random() * hs;
    } else if (r < bp) {
      const push = (bb + Math.random() * bs) * s.L / br;
      s.vx -= Math.cos(s.ang) * push;
      s.vy -= Math.sin(s.ang) * push;
      s.bendV += 9;
      s.hover = 0;
      s.thrustIn = bt + Math.random() * bts;
    } else {
      const push = (fb + Math.random() * fs) * s.L / fr;
      s.vx += Math.cos(s.ang) * push;
      s.vy += Math.sin(s.ang) * push;
      s.kick = 1;
      s.hover = 0;
      s.thrustIn = ft + Math.random() * fts;
    }
  }
  s.drift += ((Math.random() - 0.5) * 2 - s.drift) * Math.min(1, 1.5 * dt);
  const side = s.drift * 25 * s.L / 90 * dt;
  s.vx -= Math.sin(s.ang) * side;
  s.vy += Math.cos(s.ang) * side;
  return {
    bendTo: s.habit + 0.14 * Math.sin(s.clock * 0.9 + s.ph1) + 0.07 * Math.sin(s.clock * 2.3 + s.ph2) - 0.12 * s.kick,
    swim: s.hover ? 3.5 : 5.5 + 3.5 * s.kick
  };
}

// 水的阻力与位移
export function glide(s, dt, drag) {
  const f = Math.exp(-drag * dt);
  s.vx *= f;
  s.vy *= f;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

// 身体屈伸：弹簧追目标弯度（K 越大越硬越快）；小脚划动、轻微摆头、转向速度
export function flex(s, dt, { bendTo, swim, limb = 1, K = 40, sway = false }) {
  const D = 1.6 * Math.sqrt(K), n = Math.ceil(dt / 0.01);
  for (let i = 0; i < n; i++) {
    s.bendV += ((bendTo - s.bend) * K - s.bendV * D) * (dt / n);
    s.bend = clamp(s.bend + s.bendV * (dt / n), 0, 1);
  }
  s.swimHz += (swim - s.swimHz) * Math.min(1, 4 * dt);
  s.limb += (limb - s.limb) * Math.min(1, 8 * dt);
  s.padPh += TAU * s.swimHz * dt;
  s.legPh += TAU * s.swimHz * 0.6 * dt;
  const yawTo = sway ? 0.06 * Math.sin(s.clock * 1.7 + s.ph1) : 0;
  s.yaw += (yawTo - s.yaw) * Math.min(1, 5 * dt);
  s.kick = Math.max(0, s.kick - dt * 2);
  if (dt > 0) s.turnRate += (turnTo(s.prevAng, s.ang) / dt - s.turnRate) * Math.min(1, 8 * dt);
  s.prevAng = s.ang;
}

// 虾身拆成头胸、5 个腹节、尾扇各一张小图，只画一次；每帧按弯曲度绕关节转动拼起来。
// 每张图的画法沿用：淡墨打底、背侧压浓墨、节间留白缝、再擦出飞白
function buildSprites(s) {
  const L = s.L, R = 2;
  const ink = (a) => 'rgba(28,26,23,' + Math.min(1, a) + ')';
  let n = 0;
  const jr = () => s.jit[(n++) % s.jit.length];
  const blur = (g, v) => { g.filter = 'blur(' + (L * v).toFixed(2) + 'px)'; };
  // 在局部坐标 [x0,x1]×[y0,y1] 里画一张小图，四周留出模糊的余量
  const sprite = (x0, y0, x1, y1, paint) => {
    const pad = L * 0.04, c = document.createElement('canvas');
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    c.width = Math.ceil((x1 - x0) * R);
    c.height = Math.ceil((y1 - y0) * R);
    const g = c.getContext('2d');
    g.scale(R, R);
    g.translate(-x0, -y0);
    g.lineCap = 'round';
    paint(g);
    return { c, x0, y0, sw: x1 - x0, sh: y1 - y0 };
  };
  // 飞白：在墨上随机擦出细小白丝，数量按面积
  const flyWhite = (g, x0, y0, x1, y1) => {
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-out';
    const count = Math.round(111 * (x1 - x0) * (y1 - y0) / (L * L));
    for (let i = 0; i < count; i++) {
      const x = x0 + (x1 - x0) * jr(), y = y0 + (y1 - y0) * jr(), len = L * (0.01 + 0.03 * jr()), a = jr() * 0.6 - 0.3;
      g.strokeStyle = 'rgba(0,0,0,' + (0.25 + 0.45 * jr()).toFixed(2) + ')';
      g.lineWidth = Math.max(0.5, L * 0.004);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
  };
  // 节间白缝：只擦背侧一半，相邻两节在关节处各擦一道
  const seam = (g, x, h) => {
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = Math.max(1, L * 0.013);
    g.beginPath();
    g.moveTo(x, -h * 1.1);
    g.lineTo(x, -h * 0.1);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
  };
  // 腹节：局部坐标 +x 朝尾，-y 为背侧
  const segShape = (g, l, h, k2) => {
    g.beginPath();
    g.moveTo(-l * 0.05, -h);
    g.quadraticCurveTo(l * 0.5, -h * 1.12, l * 1.05, -h * 0.85);
    g.quadraticCurveTo(l * (1.0 - 0.2 * k2), h * (0.1 - 0.5 * k2), l * (0.72 - 0.1 * k2), h * (0.62 - 0.9 * k2));
    g.quadraticCurveTo(l * 0.3, h * (0.82 - 1.0 * k2), 0, h * (0.78 - 1.0 * k2));
    g.quadraticCurveTo(-l * 0.12, -h * k2 * 0.5, -l * 0.05, -h);
  };
  const segs = [];
  for (let i = 0; i < 5; i++) segs.push({ l: L * 0.12 * (1 - i * 0.07), h: L * 0.14 * (1 - i * 0.13) });
  segs.forEach((sg, i) => {
    const { l, h } = sg;
    sg.img = sprite(-0.5 * l, -1.2 * h, 1.15 * l, 0.95 * h, (g) => {
      const base = ink(0.34 + 0.12 * jr());
      blur(g, 0.007);
      // 前端垫一片淡墨伸进前一节底下：身子弓起时，节与节之间背侧不露缝
      g.fillStyle = base;
      g.beginPath();
      g.moveTo(l * 0.3, -h * 1.02);
      g.quadraticCurveTo(-l * 0.2, -h * 1.08, -l * 0.42, -h * 0.7);
      g.lineTo(-l * 0.3, h * 0.35);
      g.lineTo(l * 0.3, h * 0.5);
      g.closePath();
      g.fill();
      segShape(g, l, h, 0);
      g.fill();
      g.strokeStyle = ink(0.3);
      g.lineWidth = L * 0.01;
      g.stroke();
      blur(g, 0.005);
      segShape(g, l * 0.98, h, 0.55 + 0.15 * jr());
      g.fillStyle = ink(0.62 + 0.25 * jr());
      g.fill();
      if (i > 0) seam(g, 0, h);
      if (i < 4) seam(g, l, segs[i + 1].h);
      flyWhite(g, -0.1 * l, -h, l, 0.6 * h);
    });
  });
  // 尾扇：三瓣，两侧浓、中间淡
  const fan = sprite(-0.03 * L, -0.15 * L, 0.19 * L, 0.15 * L, (g) => {
    blur(g, 0.008);
    for (const [a, len, al] of [[-0.6, 0.15, 0.8], [0.55, 0.14, 0.72], [0, 0.11, 0.5]]) {
      g.save();
      g.rotate(a + (jr() - 0.5) * 0.15);
      g.fillStyle = ink(al);
      g.beginPath();
      g.moveTo(0, 0);
      g.quadraticCurveTo(L * len * 0.5, -L * 0.055, L * len, -L * 0.02);
      g.quadraticCurveTo(L * len * 1.05, L * 0.03, L * len * 0.7, L * 0.04);
      g.quadraticCurveTo(L * len * 0.3, L * 0.03, 0, 0);
      g.fill();
      g.restore();
    }
    flyWhite(g, 0, -0.08 * L, 0.15 * L, 0.08 * L);
  });
  // 头胸：前尖后宽一团淡墨，背后上方压浓墨，中间一道淡痕透出纸色；再加额剑与双眼
  const head = sprite(-0.1 * L, -0.22 * L, 0.62 * L, 0.15 * L, (g) => {
    blur(g, 0.007);
    g.beginPath();
    g.moveTo(-L * 0.03, -L * 0.135);
    g.bezierCurveTo(L * 0.12, -L * 0.2, L * 0.3, -L * 0.13, L * 0.46, -L * 0.05);
    g.bezierCurveTo(L * 0.33, 0, L * 0.18, L * 0.1, L * 0.01, L * 0.125);
    g.bezierCurveTo(-L * 0.06, L * 0.06, -L * 0.07, -L * 0.07, -L * 0.03, -L * 0.135);
    g.fillStyle = ink(0.42 + 0.1 * jr());
    g.fill();
    g.strokeStyle = ink(0.3);
    g.lineWidth = L * 0.01;
    g.stroke();
    blur(g, 0.006);
    g.fillStyle = ink(0.88);
    g.beginPath();
    g.moveTo(-L * 0.03, -L * 0.13);
    g.bezierCurveTo(L * 0.12, -L * 0.19, L * 0.28, -L * 0.13, L * 0.42, -L * 0.055);
    g.bezierCurveTo(L * 0.3, -L * 0.05, L * 0.15, -L * 0.03, -L * 0.04, L * 0.0);
    g.fill();
    g.fillStyle = ink(0.95);
    g.beginPath();
    g.moveTo(L * 0.03, -L * 0.05);
    g.quadraticCurveTo(L * 0.14, -L * 0.1, L * 0.27, -L * 0.07);
    g.quadraticCurveTo(L * 0.15, -L * 0.04, L * 0.03, -L * 0.05);
    g.fill();
    g.filter = 'none';
    g.globalCompositeOperation = 'destination-out';
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.lineWidth = L * 0.02;
    g.beginPath();
    g.moveTo(L * 0.0, L * 0.03);
    g.quadraticCurveTo(L * 0.14, L * 0.02, L * 0.3, -L * 0.02);
    g.stroke();
    g.globalCompositeOperation = 'source-over';
    flyWhite(g, -0.05 * L, -0.18 * L, 0.45 * L, 0.12 * L);
    g.fillStyle = ink(0.9);
    g.beginPath();
    g.moveTo(L * 0.34, -L * 0.085);
    g.lineTo(L * 0.6, -L * 0.15);
    g.lineTo(L * 0.36, -L * 0.055);
    g.fill();
    g.strokeStyle = ink(0.97);
    g.lineWidth = Math.max(2, L * 0.03);
    g.beginPath();
    g.moveTo(L * 0.37, -L * 0.035);
    g.lineTo(L * 0.45, -L * 0.075);
    g.stroke();
    g.lineWidth = Math.max(1.6, L * 0.024);
    g.beginPath();
    g.moveTo(L * 0.38, -L * 0.005);
    g.lineTo(L * 0.46, L * 0.005);
    g.stroke();
  });
  return { segs, fan, head };
}

// 每帧画：长须、长钳、步足、游泳足是细线实时画；虾身按弯曲度把分节小图拼起来
export function drawShrimp(ctx, s, t) {
  const L = s.L;
  const ink = (a) => 'rgba(28,26,23,' + Math.min(1, a) + ')';
  const polar = (p, a, r) => [p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r];
  const line = (pts, w, a) => {
    ctx.strokeStyle = ink(a);
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
  };
  if (!s.spr) s.spr = buildSprites(s);
  const spr = s.spr, tuck = 1 - s.limb;
  const fwd = s.vx * Math.cos(s.ang) + s.vy * Math.sin(s.ang);
  const stream = Math.max(0, Math.min(1, -fwd / 320));
  ctx.save();
  ctx.translate(s.x + s.rx, s.y + s.ry);
  ctx.rotate(s.ang + s.yaw);
  ctx.scale(s.scale, s.scale * s.side);
  ctx.globalAlpha = s.alpha * s.tone;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const sw = Math.sin(t * 1.2 + s.phase) * 0.08, wob = Math.sin(t * 1.7 + s.phase) * 0.05;
  // 长须：两根拖到身后很远，一根过背、一根过腹；弹逃时被水流甩向前
  for (const k of [-1, 1]) {
    const reach = L * (2.3 + 0.6 * s.pose.ant), back = 1 - 2 * stream;
    const ex = L * 0.45 - back * reach, ey = k * L * (0.3 + 0.3 * s.pose.ant) + k * L * sw;
    ctx.strokeStyle = ink(0.7);
    ctx.lineWidth = Math.max(0.7, L * 0.008);
    ctx.beginPath();
    ctx.moveTo(L * 0.44, -L * 0.04);
    ctx.bezierCurveTo(L * (0.85 - 0.4 * stream), k * L * 0.1 - L * 0.1, L * 0.45 - back * reach * 0.35, k * L * 0.5, ex, ey);
    ctx.stroke();
  }
  // 短须：向前散开几根
  for (let k = 0; k < 4; k++) {
    line([[L * 0.44, -L * 0.03], polar([L * 0.44, -L * 0.03], -0.32 + k * 0.17 + sw * 0.6, L * (0.38 + 0.14 * (k % 2)))], Math.max(0.6, L * 0.006), 0.6);
  }
  // 长钳：三节折线，越往前越粗，末端一段浓墨钳掌加开叉钳指；身子蜷紧时收向胸前
  const claw = (base, a1, a2, a3, open, a, sc) => {
    const e1 = polar(base, a1, L * 0.36 * sc), e2 = polar(e1, a2, L * 0.32 * sc), e3 = polar(e2, a3, L * 0.34 * sc);
    line([base, e1], Math.max(1, L * 0.012), a * 0.85);
    line([e1, e2], Math.max(1.2, L * 0.016), a * 0.9);
    line([e2, e3], Math.max(2.6, L * 0.045), a);
    line([e3, polar(e3, a3 - open, L * 0.17 * sc)], Math.max(1.4, L * 0.02), a);
    line([e3, polar(e3, a3 + open * 0.7, L * 0.14 * sc)], Math.max(1.2, L * 0.017), a);
  };
  const ca = s.pose.claw, cs = Math.max(0, Math.min(1, (s.bend - 0.35) / 0.65));
  claw([L * 0.2, L * 0.06], 1.0 + ca * 0.4 - cs * 0.6, -0.5 + wob, -0.08 + ca * 0.2 - stream * 0.3, 0.35, 0.5, 0.92);
  // 步足：三笔折线，交替轮划；惊逃时收向腹下
  for (let k = 0; k < 3; k++) {
    const ph = s.legPh + k * 1.4;
    const b = [L * (0.06 + k * 0.07), L * 0.08], m = polar(b, 1.3 - k * 0.12 + 0.35 * s.limb * Math.sin(ph) + 0.6 * tuck, L * 0.14);
    line([b, m, polar(m, 2.1 - k * 0.1 + 0.3 * s.limb * Math.sin(ph + 0.9) + 0.5 * tuck, L * 0.1)], Math.max(0.8, L * 0.009), 0.65);
  }
  // 脊线：从头后向尾，弯曲度 bend 连续决定每个关节的转角，蜷紧时各节略微套叠
  const step = 0.02 + 0.6 * s.bend, shrink = 1 - 0.12 * s.bend, joints = [];
  let p = [0, 0], dir = Math.PI + 0.08;
  for (let i = 0; i < 5; i++) {
    dir += step * (0.5 + i * 0.16);
    joints.push([p, dir]);
    p = polar(p, dir, spr.segs[i].l * shrink);
  }
  // 游泳足：每节腹下一对，由尾向头依次划水，远侧一只淡些
  for (let i = 0; i < 5; i++) {
    const [q, d] = joints[i], { l, h } = spr.segs[i];
    ctx.save();
    ctx.translate(q[0], q[1]);
    ctx.rotate(d);
    for (const [off, al, wd] of [[0.6, 0.35, 0.7], [0, 0.75, 1]]) {
      const ph = s.padPh + (4 - i) * 0.9 + off, b = [l * 0.45, h * 0.6], len = h * 0.85;
      const a0 = 1.1 + 0.55 * s.limb * Math.sin(ph) - 0.6 * tuck;
      const mid = polar(b, a0 - 0.35 * s.limb * Math.cos(ph), len * 0.55), tip = polar(b, a0, len);
      ctx.strokeStyle = ink(al);
      ctx.lineWidth = Math.max(1.2, L * 0.017) * wd;
      ctx.beginPath();
      ctx.moveTo(b[0], b[1]);
      ctx.quadraticCurveTo(mid[0], mid[1], tip[0], tip[1]);
      ctx.stroke();
    }
    ctx.restore();
  }
  const put = (im, q, d) => {
    ctx.save();
    ctx.translate(q[0], q[1]);
    ctx.rotate(d);
    ctx.drawImage(im.c, im.x0, im.y0, im.sw, im.sh);
    ctx.restore();
  };
  put(spr.fan, p, dir);
  for (let i = 4; i >= 0; i--) put(spr.segs[i].img, joints[i][0], joints[i][1]);
  put(spr.head, [0, 0], 0);
  claw([L * 0.24, L * 0.08], 0.8 + ca * 0.5 - cs * 0.6, -0.32 - wob, 0.04 + ca * 0.15 - stream * 0.3, 0.4, 0.95, 1);
  ctx.restore();
}
