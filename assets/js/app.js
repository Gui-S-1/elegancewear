/* =========================================================================
   Black Fit Suplementos × Elegance Fitwear — motor de movimento

   Dois "mundos" na ordem do HTML: o primeiro .world/.panel é o inicial,
   o segundo sobe como líquido por cima dele. O mesmo arquivo serve para
   o site da Black Fit (preto → rosa) e para o da Elegance (rosa → preto).

   Estado único: p (0 = primeiro mundo, 1 = segundo). Tudo (fundos, fotos,
   cards, seletor e o canvas ASCII) é desenhado a partir de p, então não
   existe estado intermediário "quebrado": qualquer valor de p é um quadro
   válido da transição.
   ========================================================================= */
(() => {
  'use strict';

  /* ---------- utilidades ---------- */
  const root = document.documentElement;
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const hash = (a, b, c) => {
    let h = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177);
    h = Math.imul(h ^ (h >>> 13), 1103515245);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };

  const mqReduce = matchMedia('(prefers-reduced-motion: reduce)');
  let reduce = mqReduce.matches;

  /* ---------- elementos (na ordem do HTML) ---------- */
  const worlds = $$('.world');
  const el = {
    worlds,
    wraps: worlds.map(w => $('.owner-wrap', w)),
    owners: worlds.map(w => $('.owner', w)),
    panels: $$('.panel'),
    topbar: $('.topbar'),
    switchBtns: $$('.switch-btn'),
    canvas: $('#fx'),
    intro: $('#intro'),
    themeMeta: $('meta[name="theme-color"]'),
    live: $('#live'),
  };
  const ctx = el.canvas.getContext('2d');

  /* ---------- atlas de glifos: paletas ---------- */
  const RAMP = ' .:-=+*#%@';
  const FOAM = '01<>/\\|{}[]~^+*';
  const GLYPHS = RAMP + FOAM;
  const PAL = ['#e4e4ea', '#ffb3ca', '#ffffff']; // prata, rosa, espuma
  const PAL_MONO = 0, PAL_ROSE = 1, PAL_FOAM = 2;
  const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';

  /* ---------- identidade de cada mundo (data-key no HTML) ---------- */
  const LOOK = {
    black: {
      pal: PAL_MONO,
      base: '5,5,6',
      theme: '#050506',
      tint: '232,232,238',
      // fluido: cor do corpo, da fita, do brilho, intensidade
      fluid: [[0.14, 0.14, 0.16], [0.72, 0.72, 0.78], [1, 1, 1], 0.36],
    },
    pink: {
      pal: PAL_ROSE,
      base: '19,5,11',
      theme: '#14060c',
      tint: '255,190,215',
      fluid: [[0.46, 0.06, 0.22], [1, 0.4, 0.6], [1, 0.84, 0.9], 0.56],
    },
  };
  const keyOf = w => el.worlds[w].dataset.key;
  const look = w => LOOK[keyOf(w)] || LOOK.black;

  // #elegance, #blackfit... (data-hash no painel; o primeiro nome é o oficial)
  const ALIASES = el.panels.map(p => (p.dataset.hash || '').toLowerCase().split(/\s+/).filter(Boolean));
  const worldFromHash = () => {
    const h = location.hash.replace('#', '').toLowerCase();
    const i = h ? ALIASES.findIndex(a => a.includes(h)) : -1;
    return i < 0 ? 0 : i;
  };

  /* ---------- estado ---------- */
  const S = {
    W: 0, H: 0, dpr: 1,
    p: 0, vel: 0, settled: 0,
    anim: null, drag: null, moving: false,
    time: 0, last: 0,
    hb: 120,        // meia-altura da faixa ASCII
    ampNow: 0,      // amplitude total da onda no quadro atual
    wrapTop: [0, 0],
  };

  /* =========================================================================
     Atlas de glifos ASCII (desenhados uma vez, copiados com drawImage)
     ========================================================================= */
  const A = { canvas: document.createElement('canvas'), cw: 6, ch: 12, gw: 6, gh: 12 };

  function buildAtlas() {
    const size = S.W < 700 ? 10 : 12;
    const m = A.canvas.getContext('2d');
    m.font = `600 ${size}px ${MONO}`;
    A.cw = Math.max(5, Math.round(m.measureText('M').width));
    A.ch = Math.round(size * 1.18);
    A.gw = Math.round(A.cw * S.dpr);
    A.gh = Math.round(A.ch * S.dpr);
    A.canvas.width = A.gw * GLYPHS.length;
    A.canvas.height = A.gh * PAL.length;
    m.font = `600 ${size * S.dpr}px ${MONO}`;
    m.textAlign = 'center';
    m.textBaseline = 'middle';
    PAL.forEach((color, row) => {
      m.fillStyle = color;
      for (let i = 0; i < GLYPHS.length; i++) {
        m.fillText(GLYPHS[i], i * A.gw + A.gw / 2, row * A.gh + A.gh / 2 + 0.5 * S.dpr);
      }
    });
    G.at = 0;
  }

  function glyph(g, pal, x, y, a) {
    ctx.globalAlpha = a;
    ctx.drawImage(A.canvas, g * A.gw, pal * A.gh, A.gw, A.gh, x, y, A.cw, A.ch);
  }

  /* =========================================================================
     Amostragem das fotos em grade de luminância (uma célula = um caractere)
     ========================================================================= */
  const G = { cols: 0, rows: 0, lum: [new Float32Array(0), new Float32Array(0)], at: 0 };
  const off = document.createElement('canvas');
  const octx = off.getContext('2d', { willReadFrequently: true });

  function sampleOwners() {
    G.cols = Math.ceil(S.W / A.cw) + 1;
    G.rows = Math.ceil(S.H / A.ch) + 1;
    off.width = G.cols;
    off.height = G.rows;
    G.lum[0] = sampleOwner(el.owners[0]);
    G.lum[1] = sampleOwner(el.owners[1]);
    G.at = performance.now();
  }

  function photoMask(img) {
    const cs = getComputedStyle(img);
    return [parseFloat(cs.getPropertyValue('--ma')) || 0.5, parseFloat(cs.getPropertyValue('--mb')) || 0.9];
  }

  function sampleOwner(img) {
    const n = G.cols * G.rows;
    const out = new Float32Array(n);
    const r = img.getBoundingClientRect();
    if (!img.complete || !img.naturalWidth || !r.width) return out;
    const [ma, mb] = photoMask(img);
    const sx = 1 / A.cw, sy = 1 / A.ch;

    octx.globalCompositeOperation = 'source-over';
    octx.imageSmoothingQuality = 'high';
    octx.clearRect(0, 0, G.cols, G.rows);
    octx.drawImage(img, r.left * sx, r.top * sy, r.width * sx, r.height * sy);
    // mesma máscara de fade que o CSS aplica na foto
    const grad = octx.createLinearGradient(0, (r.top + r.height * ma) * sy, 0, (r.top + r.height * mb) * sy);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    octx.globalCompositeOperation = 'destination-in';
    octx.fillStyle = grad;
    octx.fillRect(0, 0, G.cols, G.rows);
    octx.globalCompositeOperation = 'source-over';

    let d;
    try {
      d = octx.getImageData(0, 0, G.cols, G.rows).data;
    } catch (e) {
      return silhouette(r, out); // canvas "tainted" (ex.: aberto via file://)
    }
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const l = ((0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) / 255) * (d[j + 3] / 255);
      out[i] = Math.min(1, Math.pow(l, 0.72) * 1.4);
    }
    return out;
  }

  // Plano B sem acesso aos pixels: uma silhueta suave no lugar da pessoa
  function silhouette(r, out) {
    const cx = r.left + r.width * 0.52, cy = r.top + r.height * 0.42;
    const rx = r.width * 0.24, ry = r.height * 0.42;
    for (let row = 0; row < G.rows; row++) {
      for (let c = 0; c < G.cols; c++) {
        const dx = (c * A.cw - cx) / rx, dy = (row * A.ch - cy) / ry;
        const v = 1 - Math.sqrt(dx * dx + dy * dy);
        out[row * G.cols + c] = v > 0 ? Math.min(1, v * 1.6) * (0.55 + 0.45 * hash(c, row, 9)) : 0;
      }
    }
    return out;
  }

  /* =========================================================================
     Fundo fluido (WebGL): seda líquida se movendo atrás do vidro.
     Renderizado em 1/4 da resolução (é um borrão de propósito) a ~30 fps.
     Fica longe do rosto: só aparece abaixo da foto e nas laterais livres.
     ========================================================================= */
  const FLUID_VS = 'attribute vec2 a;varying vec2 v;void main(){v=vec2(a.x*.5+.5,.5-a.y*.5);gl_Position=vec4(a,0.,1.);}';
  const FLUID_FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform vec2 uRes;
uniform float uTime;
uniform float uGain;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform vec4 uSub;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(h(i), h(i + vec2(1., 0.)), u.x), mix(h(i + vec2(0., 1.)), h(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0., a = .5;
  for (int i = 0; i < 4; i++) { s += a * n(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p; a *= .5; }
  return s;
}
void main() {
  vec2 px = v * uRes;
  vec2 p = px / min(uRes.x, uRes.y) * 1.8;
  float t = uTime * .05;
  vec2 q = vec2(fbm(p + vec2(0., t)), fbm(p + vec2(5.2, 1.3) - t * .8));
  vec2 r = vec2(fbm(p + 3.2 * q + vec2(1.7, 9.2) + t * 1.2), fbm(p + 3.2 * q + vec2(8.3, 2.8) - t * .9));
  float f = fbm(p + 3.4 * r);
  float rib = pow(1. - abs(f * 2. - 1.), 5.);
  float body = smoothstep(.3, .85, f);
  vec3 col = mix(uC1, uC2, clamp(rib * 1.2, 0., 1.)) + uC3 * pow(rib, 3.) * .6;
  float below = smoothstep(uSub.z, uSub.w, px.y);
  float side = smoothstep(uSub.y * .85, uSub.y * 1.35, abs(px.x - uSub.x));
  float a = clamp((body * .45 + rib * .75) * uGain * max(below, side * .8), 0., 1.);
  gl_FragColor = vec4(col * a, a);
}`;

  const FL = { list: [], raf: 0, last: 0 };

  function createFluid(canvas, cfg) {
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    } catch (e) { /* sem WebGL */ }
    if (!gl) return null;
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = shader(gl.VERTEX_SHADER, FLUID_VS), fs = shader(gl.FRAGMENT_SHADER, FLUID_FS);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = {};
    ['uRes', 'uTime', 'uGain', 'uC1', 'uC2', 'uC3', 'uSub'].forEach(k => (U[k] = gl.getUniformLocation(prog, k)));
    gl.uniform3fv(U.uC1, cfg[0]);
    gl.uniform3fv(U.uC2, cfg[1]);
    gl.uniform3fv(U.uC3, cfg[2]);
    gl.uniform1f(U.uGain, cfg[3]);

    const f = { lost: false, w: 0, h: 0, sub: [0, 0, 0, 1] };
    canvas.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      f.lost = true;
      canvas.closest('.world').classList.remove('has-fluid');
    });
    f.resize = (W, H) => {
      f.w = W;
      f.h = H;
      canvas.width = Math.max(32, Math.round(W / 4));
      canvas.height = Math.max(32, Math.round(H / 4));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };
    f.draw = time => {
      if (f.lost) return;
      gl.uniform2f(U.uRes, f.w, f.h);
      gl.uniform1f(U.uTime, time);
      gl.uniform4fv(U.uSub, f.sub);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    return f;
  }

  // região da pessoa: centro x, meia-largura, e a faixa onde a foto some
  function fluidSubject(w) {
    const img = el.owners[w];
    const r = img.getBoundingClientRect();
    const [ma, mb] = photoMask(img);
    const fx = parseFloat(getComputedStyle(el.worlds[w]).getPropertyValue('--fx')) || 0.5;
    return [r.left + r.width * fx, r.width * 0.27, r.top + r.height * (ma - 0.04), r.top + r.height * (mb + 0.02)];
  }

  function initFluid() {
    el.worlds.forEach((world, w) => {
      const cv = $('.fluid', world);
      const f = cv ? createFluid(cv, look(w).fluid) : null;
      FL.list[w] = f;
      if (f) world.classList.add('has-fluid');
    });
    sizeFluid();
    startFluid();
  }

  function sizeFluid() {
    FL.list.forEach((f, w) => {
      if (!f) return;
      f.resize(S.W, S.H);
      f.sub = fluidSubject(w);
      f.draw(performance.now() / 1000);
    });
  }

  function fluidTick(now) {
    FL.raf = 0;
    if (document.hidden || reduce) return;
    if (now - FL.last >= 32) {
      FL.last = now;
      const both = S.moving || (S.p > 0 && S.p < 1);
      FL.list.forEach((f, w) => {
        if (f && (both || w === S.settled)) f.draw(now / 1000);
      });
    }
    FL.raf = requestAnimationFrame(fluidTick);
  }

  function startFluid() {
    if (!FL.raf && !reduce && FL.list.some(Boolean)) FL.raf = requestAnimationFrame(fluidTick);
  }

  /* =========================================================================
     A superfície do líquido
     ========================================================================= */
  const F = { ys: new Float32Array(0), yc: 0, energy: 0 };

  function computeFront() {
    const n = G.cols;
    if (F.ys.length !== n) F.ys = new Float32Array(n);
    const W = S.W, p = S.p;
    const edge = S.hb + 14;
    F.yc = lerp(S.H + edge, -edge, p);
    const e = Math.sin(Math.PI * clamp(p, 0, 1));
    F.energy = e;
    const a1 = 2 + 8 * e, a2 = 1 + 3.5 * e;
    const tilt = clamp(-S.vel * 6, -8, 8) * e;
    const bulge = S.drag ? 14 * e : 0;
    const bx = S.drag ? S.drag.x : 0;
    const t = S.time;
    S.ampNow = a1 + a2 + Math.abs(tilt) + bulge;
    for (let c = 0; c < n; c++) {
      const x = c * A.cw + A.cw * 0.5;
      const u = x / W;
      let y = F.yc
        + a1 * Math.sin(u * 5.4 + t * 2.1)
        + a2 * Math.sin(u * 13.7 - t * 3.4 + 1.7)
        + tilt * (2 * u - 1);
      if (bulge) {
        const k = (x - bx) / (W * 0.22);
        y -= bulge * Math.exp(-k * k);
      }
      F.ys[c] = y;
    }
  }

  const frontAt = x => F.ys[clamp((x / A.cw) | 0, 0, F.ys.length - 1)];

  /* ---------- camadas DOM seguindo a superfície ---------- */
  let layerState = '';

  function applyTideLayers() {
    const [w0, w1] = el.worlds;
    const W = S.W, H = S.H, cw = A.cw, n = F.ys.length;
    if (layerState !== 'tide') {
      w0.style.visibility = 'visible';
      w1.style.visibility = 'visible';
      w1.style.opacity = '';
      layerState = 'tide';
    }
    // o segundo mundo é recortado pela superfície (abaixo dela = ele)
    const step = Math.max(1, Math.round(n / 64));
    let pts = `0px ${F.ys[0].toFixed(1)}px`;
    for (let c = 0; c < n; c += step) pts += `,${(c * cw + cw / 2).toFixed(1)}px ${F.ys[c].toFixed(1)}px`;
    pts += `,${W}px ${F.ys[n - 1].toFixed(1)}px,${W}px ${H + 2}px,0px ${H + 2}px`;
    const clip = `polygon(${pts})`;
    w1.style.clipPath = clip;
    w1.style.webkitClipPath = clip;

    // as fotos se apagam perto da superfície; ali quem desenha é o ASCII
    const A0 = S.ampNow + 6;
    const bEnd = F.yc - A0 - S.wrapTop[0];
    const bStart = bEnd - S.hb * 0.8;
    const m0 = `linear-gradient(to bottom, #000 ${bStart.toFixed(1)}px, transparent ${bEnd.toFixed(1)}px)`;
    const pStart = F.yc + A0 - S.wrapTop[1];
    const pEnd = pStart + S.hb * 0.8;
    const m1 = `linear-gradient(to bottom, transparent ${pStart.toFixed(1)}px, #000 ${pEnd.toFixed(1)}px)`;
    el.wraps[0].style.webkitMaskImage = m0;
    el.wraps[0].style.maskImage = m0;
    el.wraps[1].style.webkitMaskImage = m1;
    el.wraps[1].style.maskImage = m1;
  }

  function applyRestLayers(w) {
    const key = 'rest' + w;
    if (layerState === key) return;
    layerState = key;
    const [w0, w1] = el.worlds;
    w1.style.clipPath = '';
    w1.style.webkitClipPath = '';
    w1.style.opacity = '';
    el.wraps.forEach(x => {
      x.style.webkitMaskImage = '';
      x.style.maskImage = '';
    });
    w0.style.visibility = w === 0 ? 'visible' : 'hidden';
    w1.style.visibility = w === 1 ? 'visible' : 'hidden';
  }

  function applyReducedLayers() {
    layerState = 'reduced';
    const [w0, w1] = el.worlds;
    w1.style.clipPath = '';
    w1.style.webkitClipPath = '';
    w0.style.visibility = S.p < 1 ? 'visible' : 'hidden';
    w1.style.visibility = S.p > 0 ? 'visible' : 'hidden';
    w1.style.opacity = S.p.toFixed(3);
  }

  /* =========================================================================
     Desenho da maré (canvas)
     ========================================================================= */
  function drawTide() {
    const cols = F.ys.length, rows = G.rows, hb = S.hb, cw = A.cw, ch = A.ch;
    const L0 = G.lum[0], L1 = G.lum[1];
    if (L0.length !== cols * rows) return;
    const pal0 = look(0).pal, pal1 = look(1).pal;
    const tick = (S.time * 16) | 0;
    const FOAM_Z = 0.18;
    const nRamp = RAMP.length - 1;

    for (let c = 0; c < cols; c++) {
      const f = F.ys[c], x = c * cw;
      const r0 = Math.max(0, Math.floor((f - hb) / ch));
      const r1 = Math.min(rows - 1, Math.floor((f + hb) / ch));
      for (let r = r0; r <= r1; r++) {
        const y = r * ch;
        const d = (y + ch * 0.5 - f) / hb;
        const ad = d < 0 ? -d : d;
        if (ad >= 1) continue;
        const below = d > 0;
        const L = (below ? L1 : L0)[r * cols + c];
        const env = 1 - smooth(0.45, 1, ad);

        if (ad < FOAM_Z) {
          // espuma: caracteres soltos cintilando na superfície
          const foam = 1 - ad / FOAM_Z;
          const h = hash(c, r, tick);
          if (h < foam * 0.28 * (0.4 + 0.6 * F.energy)) {
            const g = RAMP.length + (((h * 9973) | 0) % FOAM.length);
            glyph(g, PAL_FOAM, x, y, (0.2 + 0.5 * foam) * (0.45 + 0.55 * hash(r, c, tick + 3)));
            continue;
          }
        }
        if (L < 0.06) {
          if (hash(c, r, 7) > 0.975) glyph(1, below ? pal1 : pal0, x, y, 0.4 * env);
          continue;
        }
        const g = Math.min(nRamp, 1 + ((L * nRamp) | 0));
        glyph(g, below ? pal1 : pal0, x, y, env * (0.25 + 0.6 * L));
      }
    }
    ctx.globalAlpha = 1;

    // superfície de vidro líquido
    const W = S.W;
    const surface = () => {
      ctx.beginPath();
      ctx.moveTo(-4, F.ys[0]);
      for (let c = 0; c < cols; c++) ctx.lineTo(c * cw + cw / 2, F.ys[c]);
      ctx.lineTo(W + 4, F.ys[cols - 1]);
    };

    // profundidade logo abaixo da superfície, na cor do líquido que sobe
    const liquid = look(1).tint;
    surface();
    ctx.lineTo(W + 4, S.H + 4);
    ctx.lineTo(-4, S.H + 4);
    ctx.closePath();
    const depth = ctx.createLinearGradient(0, F.yc - S.ampNow, 0, F.yc + S.ampNow + 70);
    depth.addColorStop(0, `rgba(${liquid},.12)`);
    depth.addColorStop(1, `rgba(${liquid},0)`);
    ctx.fillStyle = depth;
    ctx.fill();

    const tint = ctx.createLinearGradient(0, 0, W, 0);
    tint.addColorStop(0, `rgb(${look(0).tint})`);
    tint.addColorStop(0.5, 'rgb(255,250,252)');
    tint.addColorStop(1, `rgb(${look(1).tint})`);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = tint;
    [[18, 0.04], [8, 0.08], [3, 0.18]].forEach(([w, a]) => {
      ctx.globalAlpha = a;
      ctx.lineWidth = w;
      surface();
      ctx.stroke();
    });
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = '#fff';
    surface();
    ctx.stroke();
    // reflexo especular logo acima
    ctx.save();
    ctx.translate(0, -3.5);
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 1;
    surface();
    ctx.stroke();
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ---------- bolhas ---------- */
  const bubbles = [];

  function updateBubbles(dt) {
    if (S.moving && S.p > 0 && S.p < 1 && F.energy > 0.08 && bubbles.length < 14 && Math.random() < F.energy * 0.3) {
      const x = Math.random() * S.W;
      bubbles.push({
        x,
        y: frontAt(x) + 18 + Math.random() * S.hb,
        r: 0.8 + Math.random() * 2,
        vy: 50 + Math.random() * 110,
        wob: Math.random() * 6.28,
        life: 1,
        pop: 0,
      });
    }
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.vy * dt;
      b.wob += dt * 4;
      b.x += Math.sin(b.wob) * 0.35;
      if (!S.moving) b.life -= dt * 0.9;
      else if (F.ys.length && b.y < frontAt(b.x) + 2) b.pop += dt * 7;
      if (b.pop >= 1 || b.life <= 0 || b.y < -20) bubbles.splice(i, 1);
    }
  }

  function drawBubbles() {
    if (!bubbles.length) return;
    ctx.lineWidth = 1;
    ctx.strokeStyle = `rgb(${look(1).tint})`;
    ctx.fillStyle = '#fff';
    for (const b of bubbles) {
      const a = 0.45 * b.life * (1 - b.pop);
      if (a <= 0) continue;
      const r = b.r * (1 + b.pop * 1.4);
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, 6.2832);
      ctx.stroke();
      ctx.globalAlpha = a * 0.9;
      ctx.fillRect(b.x - r * 0.45, b.y - r * 0.45, 1.2, 1.2);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- varredura ASCII periódica sobre a foto ---------- */
  const scan = { t: -1 };
  let scanTimer = 0;

  function scheduleScan(delay = 9000) {
    clearTimeout(scanTimer);
    if (reduce) return;
    scanTimer = setTimeout(() => {
      if (document.hidden || S.moving || INTRO.blocking) return scheduleScan(4000);
      sampleOwners();
      scan.t = 0;
      kick();
    }, delay);
  }

  function drawScan(dt) {
    if (scan.t < 0) return;
    if (S.moving) {
      scan.t = -1;
      return;
    }
    scan.t += dt / 2.2;
    if (scan.t >= 1) {
      scan.t = -1;
      scheduleScan(11000);
      return;
    }
    const w = S.settled, L = G.lum[w];
    if (L.length !== G.cols * G.rows) return;
    const lk = look(w);
    const r = el.owners[w].getBoundingClientRect();
    const y0 = Math.max(r.top + r.height * 0.08, 0), y1 = Math.min(r.top + r.height * 0.78, S.H);
    const yb = lerp(y0, y1, easeInOut(scan.t));
    const bh = 64, env = Math.sin(Math.PI * scan.t);
    const cw = A.cw, ch = A.ch, cols = G.cols;
    const ra = Math.max(0, Math.floor((yb - bh) / ch)), rb = Math.min(G.rows - 1, Math.ceil((yb + bh) / ch));
    const ca = Math.max(0, Math.floor(r.left / cw)), cb = Math.min(cols - 1, Math.ceil(r.right / cw));
    // escurece a foto dentro da faixa para o ASCII "substituir" a imagem
    const shade = ctx.createLinearGradient(0, yb - bh, 0, yb + bh);
    shade.addColorStop(0, `rgba(${lk.base},0)`);
    shade.addColorStop(0.5, `rgba(${lk.base},${(0.62 * env).toFixed(3)})`);
    shade.addColorStop(1, `rgba(${lk.base},0)`);
    ctx.fillStyle = shade;
    ctx.fillRect(r.left, yb - bh, r.width, bh * 2);
    for (let row = ra; row <= rb; row++) {
      const k = 1 - Math.abs(row * ch + ch / 2 - yb) / bh;
      if (k <= 0) continue;
      for (let c = ca; c <= cb; c++) {
        const v = L[row * cols + c];
        if (v < 0.08) continue;
        glyph(Math.min(RAMP.length - 1, 1 + ((v * (RAMP.length - 1)) | 0)), lk.pal, c * cw, row * ch, env * smooth(0, 0.6, k) * (0.35 + 0.65 * v));
      }
    }
    // fio de luz só sobre a pessoa, sumindo nas pontas
    const lx0 = r.left + r.width * 0.22, lx1 = r.right - r.width * 0.22;
    const line = ctx.createLinearGradient(lx0, 0, lx1, 0);
    line.addColorStop(0, `rgba(${lk.tint},0)`);
    line.addColorStop(0.5, `rgba(${lk.tint},1)`);
    line.addColorStop(1, `rgba(${lk.tint},0)`);
    ctx.globalAlpha = 0.35 * env;
    ctx.fillStyle = line;
    ctx.fillRect(lx0, yb, lx1 - lx0, 1);
    ctx.globalAlpha = 1;
  }

  /* =========================================================================
     Itens de conteúdo: revelados pela passagem da maré
     ========================================================================= */
  const ITEMS = [];

  function collectItems() {
    el.panels.forEach((panel, w) => {
      $$('.rv', panel).forEach((node, i) => ITEMS.push({ el: node, w, i, x: 0, y: 0, last: -1, shown: false, hook: node.dataset.hook }));
    });
  }

  function measureItems() {
    for (const it of ITEMS) {
      const r = it.el.getBoundingClientRect();
      it.x = r.left + r.width / 2;
      it.y = r.top + r.height / 2;
    }
    S.wrapTop = el.wraps.map(x => x.getBoundingClientRect().top);
  }

  function updateItems(now) {
    const p = S.p;
    for (const it of ITEMS) {
      let t;
      if (reduce) t = it.w ? p : 1 - p;
      else if (p <= 0) t = it.w ? 0 : 1;
      else if (p >= 1) t = it.w ? 1 : 0;
      else {
        const f = frontAt(it.x);
        const u = it.w ? (it.y - f) / S.hb : (f - it.y) / S.hb;
        t = smooth(-0.2, 0.85, u);
      }

      let ti = 1;
      if (INTRO.active && it.w === INTRO.world) ti = easeOut(clamp((now - INTRO.t0 - it.i * 60) / 800, 0, 1));
      const v = t * ti;

      if (v !== it.last) {
        it.last = v;
        const s = it.el.style;
        if (v >= 1) {
          s.removeProperty('opacity');
          s.removeProperty('translate');
          s.removeProperty('scale');
        } else {
          const away = it.w === 0 && t < 1 ? -(1 - t) * 18 : (1 - t) * 26;
          s.opacity = v.toFixed(3);
          s.translate = `0 ${(away + (1 - ti) * 22).toFixed(2)}px`;
          s.scale = (0.965 + 0.035 * v).toFixed(4);
        }
      }

      if (v > 0.04 && !it.shown) {
        it.shown = true;
        runHook(it);
      } else if (v === 0) it.shown = false;
    }
    if (INTRO.active && now > INTRO.t0 + 60 * ITEMS.length + 900) INTRO.active = false;
  }

  /* ---------- ganchos de entrada: palavras, scramble ASCII, contador ---------- */
  let counted = false;

  function runHook(it) {
    if (reduce) return;
    if (it.hook === 'words') {
      it.el.classList.remove('words-in');
      void it.el.offsetWidth;
      it.el.classList.add('words-in');
    } else if (it.hook === 'scramble') {
      $$('[data-scramble]', it.el).forEach(n => scramble(n, 900));
    } else if (it.hook === 'count' && !counted) {
      counted = true;
      countUp($('.count', it.el));
    }
    if (it.el.classList.contains('hint')) scramble($('.hint-lbl', it.el), 800);
  }

  function splitWords(h) {
    let i = 0;
    const walk = node => {
      Array.from(node.childNodes).forEach(n => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) {
              frag.appendChild(document.createTextNode(part));
              return;
            }
            const w = document.createElement('span');
            const s = document.createElement('span');
            w.className = 'w';
            s.textContent = part;
            s.style.setProperty('--wi', i++);
            w.appendChild(s);
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) walk(n);
      });
    };
    walk(h);
  }

  const SCR = '!<>-_\\/[]{}=+*^?#01ABCDEFGHJKLMNPRSTUVXZ';

  function scramble(node, dur = 700) {
    if (!node || reduce) return;
    if (node._orig == null) node._orig = node.textContent;
    const orig = node._orig, n = orig.length;
    const start = new Float32Array(n), end = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      start[i] = (i / n) * dur * 0.45 + Math.random() * dur * 0.1;
      end[i] = start[i] + dur * 0.22 + Math.random() * dur * 0.3;
    }
    cancelAnimationFrame(node._raf);
    const t0 = performance.now();
    const step = now => {
      const t = now - t0;
      let out = '', done = true;
      for (let i = 0; i < n; i++) {
        const c = orig[i];
        if (c === ' ' || c === '·' || t >= end[i]) out += c;
        else {
          done = false;
          out += t < start[i] ? (Math.random() < 0.6 ? '·' : SCR[(Math.random() * SCR.length) | 0]) : SCR[(Math.random() * SCR.length) | 0];
        }
      }
      node.textContent = out;
      if (!done) node._raf = requestAnimationFrame(step);
    };
    node._raf = requestAnimationFrame(step);
  }

  function countUp(node) {
    if (!node) return;
    const target = +node.dataset.to || 0, t0 = performance.now(), dur = 1700;
    const step = now => {
      const k = clamp((now - t0) / dur, 0, 1);
      const v = Math.round(target * easeOut(k));
      node.textContent = v.toLocaleString('pt-BR');
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* =========================================================================
     Laço de animação
     ========================================================================= */
  let raf = 0;
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(frame);
  };

  function frame(now) {
    raf = 0;
    const dt = S.last ? clamp((now - S.last) / 1000, 0.001, 0.05) : 1 / 60;
    S.last = now;
    S.time += dt;
    const prev = S.p;
    stepAnim(now, dt);
    S.vel = lerp(S.vel, (S.p - prev) / dt, 0.3);
    render(now, dt);
    if (S.anim || S.drag || S.moving || bubbles.length || scan.t >= 0 || INTRO.active) kick();
    else S.last = 0;
  }

  function render(now, dt) {
    const tide = !reduce && S.p > 0 && S.p < 1;
    if (tide) {
      computeFront();
      applyTideLayers();
    } else if (reduce) applyReducedLayers();
    else applyRestLayers(S.p >= 1 ? 1 : 0);

    updateItems(now);

    const st = el.topbar.style;
    st.setProperty('--p', S.p.toFixed(4));
    st.setProperty('--stretch', (1 + 0.16 * Math.sin(Math.PI * S.p)).toFixed(4));

    ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    ctx.clearRect(0, 0, S.W, S.H);
    if (reduce) return;
    if (tide) drawTide();
    updateBubbles(dt);
    drawBubbles();
    drawScan(dt);
  }

  /* ---------- animações de p ---------- */
  function stepAnim(now, dt) {
    const a = S.anim;
    if (!a) return;
    if (a.type === 'tween') {
      const k = clamp((now - a.t0) / a.dur, 0, 1);
      S.p = lerp(a.from, a.to, easeInOut(k));
      if (k >= 1) settle(a.to);
    } else {
      const K = 64, C = 2 * Math.sqrt(K) * 0.94;
      a.v += (K * (a.to - S.p) - C * a.v) * dt;
      S.p += a.v * dt;
      if (S.p <= 0 || S.p >= 1) {
        S.p = clamp(S.p, 0, 1);
        a.v = 0;
      }
      if (Math.abs(a.to - S.p) < 0.0008 && Math.abs(a.v) < 0.03) settle(a.to);
    }
  }

  function beginMotion() {
    if (S.moving) return;
    S.moving = true;
    root.classList.add('is-moving');
    el.panels.forEach(panel => {
      panel.inert = true;
      panel.style.visibility = 'visible';
    });
    scan.t = -1;
    clearTimeout(scanTimer);
    measureItems();
    sampleOwners();
  }

  function applyWorldMeta(w) {
    root.dataset.world = keyOf(w);
    el.themeMeta.content = look(w).theme;
  }

  function settle(w) {
    S.p = w;
    S.anim = null;
    S.moving = false;
    S.vel = 0;
    root.classList.remove('is-moving');
    el.panels.forEach((panel, i) => {
      panel.inert = i !== w;
      panel.style.visibility = i === w ? 'visible' : 'hidden';
    });
    el.switchBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.go === w)));
    if (w !== S.settled) {
      S.settled = w;
      applyWorldMeta(w);
      el.live.textContent = el.panels[w].getAttribute('aria-label') || '';
      try {
        history.replaceState(null, '', w && ALIASES[w][0] ? `#${ALIASES[w][0]}` : location.pathname + location.search);
      } catch (e) { /* file:// */ }
    }
    scheduleScan(6000);
    kick();
  }

  function go(to) {
    to = to ? 1 : 0;
    if (S.drag || INTRO.blocking) return;
    if (!S.moving && S.p === to) return;
    beginMotion();
    const dist = Math.abs(to - S.p);
    S.anim = { type: 'tween', from: S.p, to, t0: performance.now(), dur: (reduce ? 420 : 1250) * Math.max(0.45, dist) };
    kick();
  }

  /* =========================================================================
     Gestos: toque (arrasta a maré com o dedo), roda do mouse e teclado
     ========================================================================= */
  function dragStart(x, y) {
    S.anim = null;
    beginMotion();
    S.drag = { y0: y, p0: S.p, x, samples: [[performance.now(), S.p]] };
    kick();
  }

  function dragMove(x, y) {
    const d = S.drag, now = performance.now();
    S.p = clamp(d.p0 + (d.y0 - y) / (S.H * 0.72), 0, 1);
    d.x = x;
    d.samples.push([now, S.p]);
    while (d.samples.length > 2 && now - d.samples[0][0] > 110) d.samples.shift();
    kick();
  }

  function dragEnd() {
    const d = S.drag;
    S.drag = null;
    const [t0, p0] = d.samples[0];
    const dtS = (performance.now() - t0) / 1000;
    const v = dtS > 0.008 ? (S.p - p0) / dtS : 0;
    let to = S.p > 0.5 ? 1 : 0;
    if (Math.abs(v) > 0.45) to = v > 0 ? 1 : 0;
    if (reduce) return go(to);
    S.anim = { type: 'spring', to, v: clamp(v, -6, 6) };
    kick();
  }

  // O painel só conta como rolável se sobrar conteúdo de verdade
  // (ignora os poucos px que as animações de entrada empurram para fora).
  function panelScroll() {
    const pan = el.panels[S.settled];
    const room = pan.scrollHeight - pan.clientHeight;
    if (room <= 24) return { canDown: false, canUp: false };
    return { canDown: pan.scrollTop < room - 2, canUp: pan.scrollTop > 2 };
  }

  let T = null;
  addEventListener('touchstart', e => {
    if (INTRO.blocking || e.touches.length > 1) {
      T = null;
      return;
    }
    const t = e.touches[0];
    T = { x0: t.clientX, y0: t.clientY, mode: null };
    if (S.anim) {
      // pegar a maré no meio do caminho
      T.mode = 'drag';
      dragStart(t.clientX, t.clientY);
    }
  }, { passive: true });

  addEventListener('touchmove', e => {
    if (!T) return;
    const t = e.touches[0];
    const dx = t.clientX - T.x0, dy = t.clientY - T.y0;
    if (!T.mode) {
      if (dx * dx + dy * dy < 64) return;
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        T.mode = 'none';
        return;
      }
      const { canDown, canUp } = panelScroll();
      const toward = dy < 0 ? 1 : 0;
      if (S.moving) T.mode = 'drag';
      else if (toward !== S.settled && ((dy < 0 && !canDown) || (dy > 0 && !canUp))) T.mode = 'drag';
      else if ((dy < 0 && canDown) || (dy > 0 && canUp)) T.mode = 'native';
      else T.mode = 'block';
      if (T.mode === 'drag') dragStart(t.clientX, t.clientY);
    }
    if (T.mode === 'drag') {
      if (e.cancelable) e.preventDefault();
      dragMove(t.clientX, t.clientY);
    } else if (T.mode === 'block' && e.cancelable) e.preventDefault();
  }, { passive: false });

  const touchEnd = () => {
    if (T && T.mode === 'drag' && S.drag) dragEnd();
    T = null;
  };
  addEventListener('touchend', touchEnd);
  addEventListener('touchcancel', touchEnd);

  // roda / trackpad: um gesto = uma troca (ignora a inércia do trackpad)
  const WH = { acc: 0, last: 0, locked: false };
  addEventListener('wheel', e => {
    if (e.ctrlKey) return; // zoom do navegador
    if (INTRO.blocking) {
      e.preventDefault();
      return;
    }
    const dy = e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? S.H : 1);
    if (!S.moving) {
      const { canDown, canUp } = panelScroll();
      if ((dy > 0 && canDown) || (dy < 0 && canUp)) return; // rolagem nativa do painel
    }
    e.preventDefault();
    const now = performance.now();
    const quiet = now - WH.last > 220;
    WH.last = now;
    if (S.anim || S.drag) return;
    if (WH.locked && !quiet) return;
    WH.locked = false;
    if (quiet) WH.acc = 0;
    WH.acc += dy;
    if (Math.abs(WH.acc) > 28) {
      const to = WH.acc > 0 ? 1 : 0;
      WH.acc = 0;
      WH.locked = true;
      go(to);
    }
  }, { passive: false });

  addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onBody = e.target === document.body || e.target === root;
    if (['ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && onBody)) {
      e.preventDefault();
      go(1);
    } else if (['ArrowUp', 'PageUp'].includes(e.key)) {
      e.preventDefault();
      go(0);
    }
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-go]');
    if (b) go(+b.dataset.go);
  });

  addEventListener('hashchange', () => go(worldFromHash()));

  /* ---------- vidro: ondulação ao tocar ---------- */
  document.addEventListener('pointerdown', e => {
    const g = e.target.closest('.cta, .tile');
    if (!g || reduce) return;
    let box = g.querySelector(':scope > .ripples');
    if (!box) {
      box = document.createElement('span');
      box.className = 'ripples';
      g.appendChild(box);
    }
    const r = g.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.4;
    const rip = document.createElement('span');
    rip.className = 'ripple';
    rip.style.cssText = `left:${e.clientX - r.left}px;top:${e.clientY - r.top}px;width:${size}px;height:${size}px`;
    box.appendChild(rip);
    rip.addEventListener('animationend', () => rip.remove());
  });

  /* =========================================================================
     Intro ASCII: o logo se monta caractere por caractere
     ========================================================================= */
  const INTRO = { active: false, blocking: false, t0: 0, world: 0 };

  function startReveal(w) {
    INTRO.world = w;
    INTRO.active = !reduce;
    INTRO.t0 = performance.now();
    render(INTRO.t0, 1 / 60);
    root.classList.add('ready');
    kick();
  }

  async function runIntro(w) {
    let seen = false;
    try {
      seen = sessionStorage.getItem('intro-seen') === '1';
      sessionStorage.setItem('intro-seen', '1');
    } catch (e) { /* sem storage */ }
    const src = $('[data-intro]', el.panels[w]);
    if (reduce || seen || !el.intro || !src) {
      if (el.intro) el.intro.remove();
      startReveal(w);
      scheduleScan(3500);
      return;
    }
    INTRO.blocking = true;
    el.intro.dataset.world = keyOf(w);
    el.intro.classList.add('is-on');
    await Promise.race([
      Promise.all([src.decode().catch(() => {}), document.fonts ? document.fonts.load(`600 12px ${MONO}`).catch(() => {}) : 0]),
      new Promise(r => setTimeout(r, 900)),
    ]);
    await asciiIntro(src, w);
    el.intro.classList.add('is-out');
    INTRO.blocking = false;
    startReveal(w);
    setTimeout(() => el.intro.remove(), 900);
    scheduleScan(3500);
  }

  function asciiIntro(src, w) {
    return new Promise(resolve => {
      const cv = $('.intro-art', el.intro);
      const label = $('.intro-label', el.intro);
      const c = cv.getContext('2d');
      const dpr = Math.min(2, devicePixelRatio || 1);
      const aspect = (src.naturalWidth || 1) / (src.naturalHeight || 1);
      const wide = aspect > 1.6;
      const usePixel = src.dataset.intro === 'pixel';
      const tint = look(w).tint;
      const cssW = wide ? Math.min(innerWidth * 0.86, 460) : Math.min(innerWidth * 0.64, 270);
      const cols = wide ? 92 : 44;
      const cell = cssW / cols;
      const cellH = cell / 0.62;
      const rows = Math.max(1, Math.round(cssW / aspect / cellH));
      const cssH = rows * cellH;
      cv.style.width = `${cssW}px`;
      cv.style.height = `${cssH}px`;
      cv.width = Math.round(cssW * dpr);
      cv.height = Math.round(cssH * dpr);

      const o = document.createElement('canvas');
      o.width = cols;
      o.height = rows;
      const oc = o.getContext('2d', { willReadFrequently: true });
      oc.drawImage(src, 0, 0, cols, rows);
      let data = null;
      try {
        data = oc.getImageData(0, 0, cols, rows).data;
      } catch (e) { /* file:// */ }

      const n = cols * rows;
      const tgt = new Int16Array(n).fill(-1);
      const col = new Array(n);
      const at = new Float32Array(n);
      const cx = cols / 2, cy = rows / 2, maxD = Math.hypot(cx, cy * 1.6);
      for (let i = 0; i < n; i++) {
        const x = i % cols, y = (i / cols) | 0;
        let a, l, rgb;
        if (data) {
          const j = i * 4;
          a = data[j + 3] / 255;
          l = (0.2126 * data[j] + 0.7152 * data[j + 1] + 0.0722 * data[j + 2]) / 255;
          rgb = `${data[j]},${data[j + 1]},${data[j + 2]}`;
        } else {
          const d = Math.hypot((x - cx) / cx, (y - cy) / cy);
          a = d < 1 ? 1 : 0;
          l = 0.6;
        }
        if (a > 0.3) {
          const level = usePixel ? 0.55 + 0.45 * a : (0.32 + 0.68 * l) * a;
          tgt[i] = Math.min(RAMP.length - 1, 1 + ((level * (RAMP.length - 1)) | 0));
          col[i] = usePixel && rgb ? `rgb(${rgb})` : `rgba(${tint},${(0.45 + 0.55 * l).toFixed(2)})`;
        }
        at[i] = 120 + (Math.hypot(x - cx, (y - cy) * 1.6) / maxD) * 520 + Math.random() * 260;
      }

      const t0 = performance.now();
      const HOLD = 1250;
      let labelDone = false, finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        removeEventListener('pointerdown', finish);
        removeEventListener('keydown', finish);
        resolve();
      };
      addEventListener('pointerdown', finish);
      addEventListener('keydown', finish);

      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.font = `600 ${(cellH * 0.86).toFixed(2)}px ${MONO}`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';

      const tickFn = now => {
        if (finished) return;
        const t = now - t0;
        c.clearRect(0, 0, cssW, cssH);
        const flick = (t / 45) | 0;
        for (let i = 0; i < n; i++) {
          const x = (i % cols) * cell + cell / 2, y = ((i / cols) | 0) * cellH + cellH / 2;
          if (tgt[i] < 0) {
            if (t < at[i] + 150 && hash(i, flick, 1) > 0.985) {
              c.globalAlpha = 0.25;
              c.fillStyle = '#fff';
              c.fillText(FOAM[(i + flick) % FOAM.length], x, y);
            }
            continue;
          }
          if (t < at[i]) {
            if (hash(i, flick, 2) > 0.55) {
              c.globalAlpha = 0.35 * Math.min(1, t / at[i] + 0.2);
              c.fillStyle = '#fff';
              c.fillText(FOAM[((hash(i, flick, 3) * FOAM.length) | 0)], x, y);
            }
          } else {
            c.globalAlpha = Math.min(1, (t - at[i]) / 160);
            c.fillStyle = col[i];
            c.fillText(RAMP[tgt[i]], x, y);
          }
        }
        c.globalAlpha = 1;
        if (!labelDone && t > 380) {
          labelDone = true;
          label.textContent = src.dataset.introLabel || '';
          label._orig = null;
          scramble(label, 750);
        }
        if (t >= HOLD) finish();
        else requestAnimationFrame(tickFn);
      };
      requestAnimationFrame(tickFn);
    });
  }

  /* =========================================================================
     Medidas e inicialização
     ========================================================================= */
  function measure() {
    S.W = innerWidth;
    S.H = innerHeight;
    S.dpr = Math.min(2, devicePixelRatio || 1);
    el.canvas.width = Math.round(S.W * S.dpr);
    el.canvas.height = Math.round(S.H * S.dpr);
    S.hb = clamp(S.H * 0.11, 60, 110);
    buildAtlas();
    if (S.moving) {
      measureItems();
      sampleOwners();
    }
    F.ys = new Float32Array(0);
    if (S.moving) computeFront();
    sizeFluid();
    kick();
  }

  function init() {
    const start = worldFromHash();
    S.p = start;
    S.settled = start;
    applyWorldMeta(start);
    el.panels.forEach((panel, i) => {
      panel.inert = i !== start;
      panel.style.visibility = i === start ? 'visible' : 'hidden';
    });
    el.switchBtns.forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.go === start)));

    $$('.title').forEach(splitWords);
    collectItems();
    measure();
    sampleOwners();
    initFluid();

    let rT = 0;
    addEventListener('resize', () => {
      clearTimeout(rT);
      rT = setTimeout(measure, 120);
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => buildAtlas());
    el.owners.forEach(img => img.complete || img.addEventListener('load', () => {
      G.at = 0;
      sizeFluid();
    }, { once: true }));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        kick();
        startFluid();
      }
    });
    const onReduce = () => {
      reduce = mqReduce.matches;
      layerState = '';
      kick();
      startFluid();
    };
    if (mqReduce.addEventListener) mqReduce.addEventListener('change', onReduce);

    runIntro(start);

    // ?debug: congela a maré num ponto para inspecionar (ex.: __bf.freeze(.5))
    if (/[?&]debug\b/.test(location.search)) {
      window.__bf = {
        S,
        go,
        freeze(p) {
          beginMotion();
          S.anim = null;
          S.p = clamp(p, 0, 1);
          kick();
        },
        release: to => go(to),
        scan() {
          sampleOwners();
          scan.t = 0;
          kick();
        },
        fluid: () => FL.list.map(Boolean),
        // avança quadros manualmente (útil quando a aba está em segundo plano)
        flush(ms = 3000) {
          const t0 = performance.now();
          for (let t = 16; t <= ms; t += 16) {
            cancelAnimationFrame(raf);
            raf = 0;
            frame(t0 + t);
          }
          FL.list.forEach(f => f && f.draw((t0 + ms) / 1000));
        },
        // custo médio (ms) de um quadro da maré
        bench(n = 120) {
          beginMotion();
          S.anim = null;
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            S.p = 0.05 + 0.9 * (i / n);
            S.time += 1 / 60;
            render(performance.now(), 1 / 60);
          }
          const ms = (performance.now() - t0) / n;
          settle(S.settled);
          return ms;
        },
      };
    }
  }

  init();
})();
