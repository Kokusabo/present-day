/* ascii.js
 * A small ASCII renderer. A scene draws with the normal canvas 2D API onto a
 * tiny "source" canvas (one pixel per character cell, in square units), and
 * every frame that picture is turned into rows of characters.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rand(a, b) {
    if (a === undefined) return Math.random();
    if (b === undefined) return Math.random() * a;
    return a + Math.random() * (b - a);
  }
  function ease(k, dt) { return 1 - Math.exp(-k * dt); }

  var RAMPS = {
    classic: " .'`^\",:;Il!i><~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
    soft: ' .:-=+*#%@',
    flora: ' .,:;irsXA253hMHGS#9B&@',
    wired: ' .,:;+=xX$&#',
    snow: " .'`,:;!i+*%#@",
    portrait: ' .:;+=xX$&@'
  };
  var GLITCH = '#$%&?!<>/\\|01{}[]=+*^~';

  var reduced = false;
  try { reduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { /* old browsers */ }

  /* ---------- shared pointer ---------- */
  var Pointer = { x: -1e5, y: -1e5, active: false, last: 0 };
  function onPointer(e) {
    Pointer.x = e.clientX; Pointer.y = e.clientY;
    Pointer.active = true; Pointer.last = performance.now();
  }
  global.addEventListener('pointermove', onPointer, { passive: true });
  global.addEventListener('pointerdown', onPointer, { passive: true });
  document.addEventListener('mouseout', function (e) { if (!e.relatedTarget) Pointer.active = false; });

  var DEFAULTS = {
    cols: 120,            // wanted columns on wide screens
    colsNarrow: 0,        // wanted columns below 560px (0 = same as cols)
    minFont: 6,
    maxFont: 13,
    lineHeight: 1.16,
    heightRatio: 0.6,     // canvas height / width (css px)
    heightRatioNarrow: 0,
    ramp: RAMPS.classic,
    mode: 'mono',         // 'mono' or 'color'
    tint: '#e6e1d8',
    gradient: null,       // [[stop, color], ...] vertical gradient for mono mode
    edges: false,         // use / \ | - on strong edges
    edgeThresh: 0.3,
    gamma: 1,
    lumMix: 0,            // 0 = luma, 1 = brightest channel (lets saturated colours stay dense)
    fillDim: 0,           // colour mode: dim the fill characters so inked lines stand out
    inkTint: null,        // mono mode: colour for inked lines (drawn in a second pass)
    jitter: 0.02,
    fps: 24,
    weight: 400,
    family: '"Courier Prime", "Courier New", ui-monospace, Menlo, Consolas, monospace'
  };

  var views = [];

  var io = new IntersectionObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var v = entries[i].target.__ascii;
      if (!v) continue;
      v.visible = entries[i].isIntersecting;
      if (v.visible) v.dirty = true;
    }
  }, { rootMargin: '160px 0px' });

  var ro = new ResizeObserver(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var v = entries[i].target.__asciiParent;
      if (v && Math.abs(v.canvas.clientWidth - v.cssW) > 1) v.resize();
    }
  });

  function AsciiView(canvas, scene, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scene = scene;
    this.o = Object.assign({}, DEFAULTS, opts || {});
    this.src = document.createElement('canvas');
    this.sctx = this.src.getContext('2d', { willReadFrequently: true });
    this.col = document.createElement('canvas');
    this.cctx = this.col.getContext('2d');
    this.t = 0; this.dt = 1 / 24; this.last = 0;
    this.visible = false; this.dirty = true;
    this.glitch = 0; this.invert = false;
    this.px = -1e5; this.py = -1e5; this.pointerIn = false; this.pointerActive = false;
    this.lines = [];
    canvas.__ascii = this;
    canvas.parentElement.__asciiParent = this;
    var self = this;
    canvas.addEventListener('pointerdown', function (e) {
      var r = canvas.getBoundingClientRect();
      var x = (e.clientX - r.left - self.ox) / self.cellW;
      var y = (e.clientY - r.top) / self.cellW;
      if (self.scene.click) self.scene.click(x, y, self);
      self.dirty = true;
    });
    if (scene.init) scene.init(this);
    this.resize();
    views.push(this);
    io.observe(canvas);
    ro.observe(canvas.parentElement);
  }

  AsciiView.prototype.resize = function () {
    var o = this.o;
    var cssW = Math.max(120, this.canvas.clientWidth || 300);
    var narrow = cssW < 560;
    var want = narrow && o.colsNarrow ? o.colsNarrow : o.cols;
    var ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = o.weight + ' 100px ' + o.family;
    var ratio = ctx.measureText('M').width / 100 || 0.6;
    var fs = clamp(cssW / (want * ratio), o.minFont, o.maxFont);
    this.font = o.weight + ' ' + fs.toFixed(2) + 'px ' + o.family;
    ctx.font = this.font;
    var cw = ctx.measureText('M').width || fs * 0.6;
    var cols = Math.max(10, Math.floor(cssW / cw));
    var ch = fs * o.lineHeight;
    var hr = typeof o.heightRatio === 'function' ? o.heightRatio(cssW) :
      (narrow && o.heightRatioNarrow ? o.heightRatioNarrow : o.heightRatio);
    var rows = Math.max(8, Math.round(cssW * hr / ch));
    var cssH = Math.round(rows * ch);
    var dpr = Math.min(2, global.devicePixelRatio || 1);

    this.fs = fs; this.cellW = cw; this.cellH = ch;
    this.cols = cols; this.rows = rows;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.ox = (cssW - cols * cw) / 2;
    this.aspect = ch / cw;
    this.W = cols; this.H = rows * this.aspect;

    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.src.width = cols; this.src.height = rows;
    this.col.width = cols; this.col.height = rows;
    this.colImg = this.cctx.createImageData(cols, rows);
    this.L = new Float32Array(cols * rows);
    this.inkC = new Uint8Array(cols * rows);
    this.inkRGB = new Uint8Array(cols * rows * 3);
    this.inkHi = new Uint8Array(cols * rows);
    this.shift = new Float32Array(rows);

    this.fill = o.tint;
    if (o.gradient) {
      var g = ctx.createLinearGradient(0, 0, 0, cssH);
      for (var i = 0; i < o.gradient.length; i++) g.addColorStop(o.gradient[i][0], o.gradient[i][1]);
      this.fill = g;
    }
    if (this.scene.resize) this.scene.resize(this);
    this.dirty = true;
    if (this.visible) this.render();
  };

  AsciiView.prototype.kick = function (amount) {
    this.glitch = Math.max(this.glitch, amount || 0.6);
    this.dirty = true;
  };

  AsciiView.prototype.tick = function (now) {
    if (reduced) {
      if (!this.dirty) return;
    } else if (!this.dirty && now - this.last < 1000 / this.o.fps - 2) {
      return;
    }
    var dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / this.o.fps;
    this.last = now;
    this.dt = dt;
    if (!reduced) this.t += dt;
    var r = this.canvas.getBoundingClientRect();
    this.px = (Pointer.x - r.left - this.ox) / this.cellW;
    this.py = (Pointer.y - r.top) / this.cellW;
    this.pointerActive = Pointer.active && now - Pointer.last < 5000;
    this.pointerIn = this.pointerActive && Pointer.x >= r.left && Pointer.x <= r.right &&
      Pointer.y >= r.top && Pointer.y <= r.bottom;
    this.glitch = Math.max(0, this.glitch - dt * 1.4);
    this.render();
    this.dirty = false;
  };

  AsciiView.prototype.render = function () {
    var cols = this.cols, rows = this.rows, o = this.o;
    var s = this.sctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.fillStyle = '#000';
    s.fillRect(0, 0, cols, rows);
    s.setTransform(1, 0, 0, 1 / this.aspect, 0, 0);
    s.lineCap = 'round';
    s.lineJoin = 'round';
    this.inkC.fill(0);
    this.scene.draw(s, this, this.t, this.dt);

    var data = s.getImageData(0, 0, cols, rows).data;
    var L = this.L, n = cols * rows, inv = this.invert, mix = o.lumMix;
    for (var i = 0, j = 0; i < n; i++, j += 4) {
      var r0 = data[j], g0 = data[j + 1], b0 = data[j + 2];
      var l = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
      if (mix) {
        var mx = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
        l = l + (mx / 255 - l) * mix;
      }
      L[i] = inv ? 1 - l : l;
    }

    var ramp = o.ramp, rn = ramp.length - 1;
    var gamma = o.gamma, jit = o.jitter;
    var color = o.mode === 'color';
    var out = this.colImg.data;
    var edges = o.edges, thr = o.edgeThresh, asp = this.aspect;
    var g = this.glitch;
    var lines = this.lines;
    var inkC = this.inkC, inkRGB = this.inkRGB, inkHi = this.inkHi, fd = o.fillDim;
    var sep = !color && o.inkTint;
    var inkLines = this.inkLines || (this.inkLines = []);

    for (var y = 0; y < rows; y++) {
      var str = '', istr = '';
      var rowGlitch = g > 0 && Math.random() < g * 0.18;
      for (var x = 0; x < cols; x++) {
        var idx = y * cols + x;
        var src = idx;
        var c = '';
        var ic = inkC[idx];
        if (ic) {
          c = String.fromCharCode(ic);
        } else if (edges && x > 0 && y > 0 && x < cols - 1 && y < rows - 1) {
          var a1 = L[idx - cols - 1], b1 = L[idx - cols], c1 = L[idx - cols + 1];
          var d1 = L[idx - 1], f1 = L[idx + 1];
          var g1 = L[idx + cols - 1], h1 = L[idx + cols], k1 = L[idx + cols + 1];
          var gx = ((c1 + 2 * f1 + k1) - (a1 + 2 * d1 + g1)) / 4;
          var gy = ((g1 + 2 * h1 + k1) - (a1 + 2 * b1 + c1)) / 4 / asp * 1.6;
          var mag = Math.sqrt(gx * gx + gy * gy);
          if (mag > thr) {
            var ang = Math.atan2(gy, gx) * 57.2958;
            if (ang < 0) ang += 180;
            if (ang < 22.5 || ang >= 157.5) c = '|';
            else if (ang < 67.5) c = '/';
            else if (ang < 112.5) c = gy < 0 ? '_' : '-';
            else c = '\\';
            if (color) {
              var best = idx, bl = L[idx];
              if (b1 > bl) { bl = b1; best = idx - cols; }
              if (d1 > bl) { bl = d1; best = idx - 1; }
              if (f1 > bl) { bl = f1; best = idx + 1; }
              if (h1 > bl) { bl = h1; best = idx + cols; }
              src = best;
            }
          }
        }
        if (!c) {
          var v = gamma === 1 ? L[idx] : Math.pow(L[idx], gamma);
          if (jit) v += (Math.random() - 0.5) * jit;
          var k = (v * rn + 0.5) | 0;
          c = ramp[k < 0 ? 0 : k > rn ? rn : k];
        }
        if (rowGlitch && Math.random() < 0.25) c = GLITCH[(Math.random() * GLITCH.length) | 0];
        if (sep && ic && inkHi[idx]) { str += ' '; istr += c; }
        else { str += c; if (sep) istr += ' '; }
        if (color) {
          var q = idx * 4;
          if (ic) {
            out[q] = inkRGB[idx * 3]; out[q + 1] = inkRGB[idx * 3 + 1]; out[q + 2] = inkRGB[idx * 3 + 2]; out[q + 3] = 255;
          } else {
            var p = src * 4;
            var r = data[p], gg = data[p + 1], bb = data[p + 2];
            var m = r > gg ? (r > bb ? r : bb) : (gg > bb ? gg : bb);
            if (m > 0) { var f = 255 / m; if (fd) f *= fd + (1 - fd) * Math.min(1, L[idx] * 1.6); r *= f; gg *= f; bb *= f; }
            out[q] = r; out[q + 1] = gg; out[q + 2] = bb; out[q + 3] = 255;
          }
        }
      }
      lines[y] = str;
      if (sep) inkLines[y] = istr;
      this.shift[y] = g > 0 && Math.random() < g * 0.22 ? (Math.random() - 0.5) * g * 14 * this.cellW : 0;
    }

    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.font = this.font;
    if ('fontKerning' in ctx) ctx.fontKerning = 'none';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = color ? '#fff' : this.fill;
    var ch = this.cellH;
    for (var yy = 0; yy < rows; yy++) ctx.fillText(lines[yy], this.ox + this.shift[yy], (yy + 0.5) * ch);
    if (sep) {
      ctx.fillStyle = o.inkTint;
      for (yy = 0; yy < rows; yy++) ctx.fillText(inkLines[yy], this.ox + this.shift[yy], (yy + 0.5) * ch);
    }
    if (color) {
      this.cctx.putImageData(this.colImg, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.col, 0, 0, cols, rows, this.ox, 0, cols * this.cellW, rows * ch);
      ctx.globalCompositeOperation = 'source-over';
    }
  };

  /* ---------- inked lines ----------
   * ink() writes a polyline (in the scene's current transform) straight into
   * character cells, picking / | \ - _ from the direction of each segment.
   * mask() erases ink under a closed shape, so later fills hide earlier lines. */
  var RGBC = {};
  function rgbOf(c) {
    var v = RGBC[c];
    if (!v) {
      var h = c.charAt(0) === '#' ? c.slice(1) : 'ffffff';
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      v = RGBC[c] = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }
    return v;
  }
  AsciiView.prototype.ink = function (ctx, pts, color, ch) {
    var m = ctx.getTransform(), cols = this.cols, rows = this.rows, asp = this.aspect;
    var C = this.inkC, RGB = this.inkRGB, HI = this.inkHi;
    var rgb = rgbOf(color || '#ffffff'), hi = Math.max(rgb[0], rgb[1], rgb[2]) >= 150 ? 1 : 0;
    var fixed = ch ? ch.charCodeAt(0) : 0;
    function put(x, y, code) {
      var cx = Math.floor(x), cy = Math.floor(y);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      var i = cy * cols + cx;
      C[i] = code; HI[i] = hi;
      RGB[i * 3] = rgb[0]; RGB[i * 3 + 1] = rgb[1]; RGB[i * 3 + 2] = rgb[2];
    }
    var px = 0, py = 0;
    for (var k = 0; k < pts.length; k += 2) {
      var x = m.a * pts[k] + m.c * pts[k + 1] + m.e, y = m.b * pts[k] + m.d * pts[k + 1] + m.f;
      if (k === 0) { if (pts.length === 2) put(x, y, fixed || 46); px = x; py = y; continue; }
      var code = fixed, horiz = false;
      if (!code) {
        var a = Math.atan2(-(y - py) * asp, x - px) * 57.29578;
        if (a < 0) a += 180;
        if (a < 22 || a >= 158) horiz = true;
        else code = a < 68 ? 47 : a < 112 ? 124 : 92;
      }
      var n = Math.max(1, Math.ceil(Math.max(Math.abs(x - px), Math.abs(y - py)) * 2.2));
      for (var s = 1; s <= n; s++) {
        var sx = px + (x - px) * s / n, sy = py + (y - py) * s / n;
        if (horiz) {
          var fy = sy - Math.floor(sy);
          if (fy < 0.3) put(sx, sy - 1, 95); else put(sx, sy, fy > 0.62 ? 95 : 45);
        } else put(sx, sy, code);
      }
      px = x; py = y;
    }
  };
  AsciiView.prototype.mask = function (ctx, subs) {
    var m = ctx.getTransform(), polys = [], x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (var s = 0; s < subs.length; s++) {
      var p = subs[s], q = new Float32Array(p.length);
      for (var k = 0; k < p.length; k += 2) {
        var x = m.a * p[k] + m.c * p[k + 1] + m.e, y = m.b * p[k] + m.d * p[k + 1] + m.f;
        q[k] = x; q[k + 1] = y;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      polys.push(q);
    }
    var cols = this.cols, C = this.inkC;
    var cx0 = Math.max(0, Math.floor(x0)), cx1 = Math.min(cols - 1, Math.ceil(x1));
    var cy0 = Math.max(0, Math.floor(y0)), cy1 = Math.min(this.rows - 1, Math.ceil(y1));
    var xs = [];
    for (var cy = cy0; cy <= cy1; cy++) {
      var yc = cy + 0.5;
      xs.length = 0;
      for (var s2 = 0; s2 < polys.length; s2++) {
        var q2 = polys[s2];
        for (var k2 = 0; k2 + 3 < q2.length; k2 += 2) {
          var ya = q2[k2 + 1], yb = q2[k2 + 3];
          if ((ya <= yc) !== (yb <= yc)) xs.push(q2[k2] + (yc - ya) / (yb - ya) * (q2[k2 + 2] - q2[k2]));
        }
      }
      if (xs.length < 2) continue;
      xs.sort(function (a, b) { return a - b; });
      for (var j = 0; j + 1 < xs.length; j += 2) {
        var a = Math.max(cx0, Math.ceil(xs[j] - 0.5)), b = Math.min(cx1, Math.floor(xs[j + 1] - 0.5));
        for (var cx = a; cx <= b; cx++) C[cy * cols + cx] = 0;
      }
    }
  };

  function frame(now) {
    global.requestAnimationFrame(frame);
    if (document.hidden) return;
    for (var i = 0; i < views.length; i++) if (views[i].visible) views[i].tick(now);
  }
  var running = false;
  function start() {
    if (running) return;
    running = true;
    global.requestAnimationFrame(frame);
  }

  global.addEventListener('resize', function () {
    for (var i = 0; i < views.length; i++) {
      if (Math.abs(views[i].canvas.clientWidth - views[i].cssW) > 1) views[i].resize();
    }
  });

  global.ASCII = {
    AsciiView: AsciiView, RAMPS: RAMPS, Pointer: Pointer, views: views, start: start,
    TAU: TAU, clamp: clamp, lerp: lerp, rand: rand, ease: ease, reduced: reduced
  };
})(window);
