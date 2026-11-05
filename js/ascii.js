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

  /* pick characters by how much ink they really put on screen in this font */
  var rampCache = {};
  var CANDIDATES = " .'`,:;~\"!^*+=<>ivxrclzunosaeyftjJLTYCUOQ0Z?mwqpdbkhXKAVNSGEHRD#%&8BM@$";
  function autoRamp(weight, family, levels) {
    levels = levels || 30;
    var key = weight + ' ' + family + ' ' + levels;
    if (rampCache[key]) return rampCache[key];
    var size = 40, c = document.createElement('canvas');
    c.width = size; c.height = Math.round(size * 1.3);
    var x = c.getContext('2d', { willReadFrequently: true });
    x.font = weight + ' ' + size + 'px ' + family;
    x.textBaseline = 'middle';
    var list = [];
    for (var i = 0; i < CANDIDATES.length; i++) {
      x.clearRect(0, 0, c.width, c.height);
      x.fillStyle = '#fff';
      x.fillText(CANDIDATES[i], 4, c.height / 2);
      var d = x.getImageData(0, 0, c.width, c.height).data, sum = 0;
      for (var j = 3; j < d.length; j += 4) sum += d[j];
      list.push([CANDIDATES[i], sum]);
    }
    list.sort(function (a, b) { return a[1] - b[1]; });
    var max = list[list.length - 1][1] || 1, out = ' ';
    for (var k = 1; k < levels; k++) {
      var target = k / (levels - 1) * max, best = '', bd = 1e18;
      for (var m = 1; m < list.length; m++) {
        var dd = Math.abs(list[m][1] - target);
        if (dd < bd) { bd = dd; best = list[m][0]; }
      }
      if (out.indexOf(best) < 0) out += best;
    }
    rampCache[key] = out;
    return out;
  }

  var RGBC = {};
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
    minFont: 5,
    maxFont: 13,
    lineHeight: 1.16,
    heightRatio: 0.6,     // canvas height / width (css px)
    heightRatioNarrow: 0,
    ramp: 'auto',         // 'auto' = characters picked by measured ink coverage of the font
    ss: 2,                // supersampling: source pixels per cell side
    mode: 'mono',         // 'mono' or 'color'
    tint: '#e6e1d8',
    gradient: null,       // [[stop, color], ...] vertical gradient for mono mode
    edges: false,         // use / \ | - on strong edges
    edgeThresh: 0.3,
    gamma: 1,
    lumMix: 0,            // 0 = luma, 1 = brightest channel (lets saturated colours stay dense)
    fillDim: 0,           // colour mode: dim the fill characters so inked lines stand out
    duo: null,            // colour mode: [base, accent] - every cell becomes a shade of base, or accent where the scene is red
    heavyGlitch: false,   // glitches also corrupt blocks of characters and leave red/bone ghosts
    duoMin: 0.42,         // colour mode with duo: how dark the darkest characters get (0 = black, 1 = all full colour)
    inkTint: null,        // mono mode: colour for inked lines (drawn in a second pass)
    jitter: 0.02,
    fps: 60,
    weight: 400,
    family: '"Courier Prime", "Courier New", ui-monospace, Menlo, Consolas, monospace'
  };

  var views = [];

  // Canvas positions are read in one batch at the start of a frame, and only after
  // something could have moved them. Reading them per view inside the frame forced the
  // browser to lay the page out again and again, which shows up as occasional stutter.
  var rectsDirty = true;
  function markRects() { rectsDirty = true; }
  global.addEventListener('scroll', markRects, { passive: true });
  setInterval(markRects, 500); // late layout changes: fonts, a resized textarea

  // Low-power fallback: if the page keeps running well below 60 fps, draw the pictures at
  // 1x resolution and drop the grain and vignette layers.
  var maxDpr = 2, lite = false, gaps = [], lastFrame = 0;
  function goLite() {
    if (lite) return;
    lite = true;
    maxDpr = 1;
    document.documentElement.classList.add('lite');
    for (var i = 0; i < views.length; i++) views[i].resize();
  }

  var io = new IntersectionObserver(function (entries) {
    rectsDirty = true;
    for (var i = 0; i < entries.length; i++) {
      var v = entries[i].target.__ascii;
      if (!v) continue;
      v.visible = entries[i].isIntersecting;
      if (v.visible) v.dirty = true;
    }
  }, { rootMargin: '160px 0px' });

  var ro = new ResizeObserver(function (entries) {
    rectsDirty = true;
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
    this.glitch = 0; this.invert = false; this.cost = 0; this.fpsCap = 0; this.frames = 0;
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
    var dpr = Math.min(maxDpr, global.devicePixelRatio || 1);

    this.ramp = o.ramp === 'auto' ? autoRamp(o.weight, o.family, o.rampLevels) : o.ramp;
    this.duo = o.duo ? [rgbOf(o.duo[0]), rgbOf(o.duo[1])] : null;
    this.ss = Math.max(1, o.ss | 0);
    this.fs = fs; this.cellW = cw; this.cellH = ch;
    this.cols = cols; this.rows = rows;
    this.cssW = cssW; this.cssH = cssH; this.dpr = dpr;
    this.ox = (cssW - cols * cw) / 2;
    this.aspect = ch / cw;
    this.W = cols; this.H = rows * this.aspect;

    this.canvas.style.height = cssH + 'px';
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.sw = cols * this.ss; this.sh = rows * this.ss;
    this.src.width = this.sw; this.src.height = this.sh;
    this.col.width = cols; this.col.height = rows;
    this.colImg = this.cctx.createImageData(cols, rows);
    this.L = new Float32Array(cols * rows);
    this.cR = new Float32Array(cols * rows);
    this.cG = new Float32Array(cols * rows);
    this.cB = new Float32Array(cols * rows);
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

  // frames per second this view aims for right now: lower in calm mode, and lower
  // still when this computer turns out to be slow at drawing it
  AsciiView.prototype.fps = function () {
    return Math.min(this.o.fps, this.fpsCap || 999);
  };
  // how overdue this view is, in ms (> 0 means it should draw now)
  AsciiView.prototype.due = function (now) {
    // 0.75 of the period: on 120-165 Hz screens this keeps frames evenly spaced instead of skipping
    return this.dirty ? 1e6 : (now - this.last) - (1000 / this.fps()) * 0.75;
  };

  AsciiView.prototype.tick = function (now) {
    var dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 1 / this.fps();
    this.last = now;
    this.dt = dt;
    this.t += dt;
    var r = this.rect || (this.rect = this.canvas.getBoundingClientRect());
    this.px = (Pointer.x - r.left - this.ox) / this.cellW;
    this.py = (Pointer.y - r.top) / this.cellW;
    this.pointerActive = Pointer.active && now - Pointer.last < 5000;
    this.pointerIn = this.pointerActive && Pointer.x >= r.left && Pointer.x <= r.right &&
      Pointer.y >= r.top && Pointer.y <= r.bottom;
    this.glitch = Math.max(0, this.glitch - dt * 1.4);
    var t0 = performance.now();
    this.render();
    var cost = performance.now() - t0;
    this.cost = this.cost ? this.cost * 0.9 + cost * 0.1 : cost;
    // every second or so: draw less often if frames are expensive here, more often once they are cheap again
    if (++this.frames % 25 === 0) {
      var cap = this.fpsCap || this.o.fps;
      if (this.cost > 10) this.fpsCap = Math.max(24, cap - 6);
      else if (this.cost < 6 && this.fpsCap) this.fpsCap = cap + 6 >= this.o.fps ? 0 : cap + 6;
    }
    this.dirty = false;
  };

  AsciiView.prototype.render = function () {
    var cols = this.cols, rows = this.rows, o = this.o;
    var s = this.sctx;
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalAlpha = 1;
    s.globalCompositeOperation = 'source-over';
    s.fillStyle = '#000';
    s.fillRect(0, 0, this.sw, this.sh);
    var ss = this.ss;
    s.setTransform(ss, 0, 0, ss / this.aspect, 0, 0);
    s.lineCap = 'round';
    s.lineJoin = 'round';
    this.inkC.fill(0);
    this.scene.draw(s, this, this.t, this.dt);

    var sw = this.sw, data = s.getImageData(0, 0, sw, this.sh).data;
    var L = this.L, cR = this.cR, cG = this.cG, cB = this.cB, inv = this.invert, mix = o.lumMix;
    var area = 1 / (ss * ss);
    for (var cy = 0, i = 0; cy < rows; cy++) {
      for (var cx = 0; cx < cols; cx++, i++) {
        var r0 = 0, g0 = 0, b0 = 0;
        for (var sy = 0; sy < ss; sy++) {
          var j = ((cy * ss + sy) * sw + cx * ss) * 4;
          for (var sx = 0; sx < ss; sx++, j += 4) { r0 += data[j]; g0 += data[j + 1]; b0 += data[j + 2]; }
        }
        r0 *= area; g0 *= area; b0 *= area;
        cR[i] = r0; cG[i] = g0; cB[i] = b0;
        var l = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
        if (mix) {
          var mx = r0 > g0 ? (r0 > b0 ? r0 : b0) : (g0 > b0 ? g0 : b0);
          l = l + (mx / 255 - l) * mix;
        }
        L[i] = inv ? 1 - l : l;
      }
    }

    var ramp = this.ramp, rn = ramp.length - 1;
    var gamma = o.gamma, jit = o.jitter, jseed = Math.imul(((this.t * 15) | 0) + 1, 0x9e3779b1);
    var color = o.mode === 'color';
    var out = this.colImg.data;
    var edges = o.edges, thr = o.edgeThresh, asp = this.aspect;
    var g = this.glitch;
    var lines = this.lines;
    var inkC = this.inkC, inkRGB = this.inkRGB, inkHi = this.inkHi, fd = o.fillDim, duo = this.duo;
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
          if (jit && v > 0.02) { // grain only where something is drawn, never on the black
            var hn = Math.imul(idx ^ jseed, 0x85ebca6b); hn ^= hn >>> 13; hn = Math.imul(hn, 0xc2b2ae35); hn ^= hn >>> 16;
            v += ((hn >>> 0) / 4294967296 - 0.5) * jit;
          }
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
            var r = cR[src], gg = cG[src], bb = cB[src];
            var m = r > gg ? (r > bb ? r : bb) : (gg > bb ? gg : bb);
            if (duo) {
              // how red is this cell: red channel above the others, relative to its brightness
              var red = m > 8 ? (r - (gg > bb ? gg : bb)) / m : 0;
              var w = red < 0.3 ? 0 : red > 0.6 ? 1 : (red - 0.3) / 0.3;
              var shade = o.duoMin + (1 - o.duoMin) * Math.min(1, L[src] * 1.5);
              var A0 = duo[0], A1 = duo[1];
              out[q] = (A0[0] + (A1[0] - A0[0]) * w) * (w ? 1 : shade);
              out[q + 1] = (A0[1] + (A1[1] - A0[1]) * w) * (w ? 1 : shade);
              out[q + 2] = (A0[2] + (A1[2] - A0[2]) * w) * (w ? 1 : shade);
            } else {
              if (m > 0) { var f = 255 / m; if (fd) f *= fd + (1 - fd) * Math.min(1, L[idx] * 1.6); r *= f; gg *= f; bb *= f; }
              out[q] = r; out[q + 1] = gg; out[q + 2] = bb;
            }
            out[q + 3] = 255;
          }
        }
      }
      lines[y] = str;
      if (sep) inkLines[y] = istr;
      this.shift[y] = g > 0 && Math.random() < g * 0.22 ? (Math.random() - 0.5) * g * 14 * this.cellW : 0;
    }

    // heavy glitch: big pieces of the picture slide away, jump up or down, or vanish;
    // characters and their colours move together
    var heavy = o.heavyGlitch && g > 0.05;
    if (heavy) {
      var rc = [], rnd = Math.random;
      var chars = function (y) { return rc[y] || (rc[y] = lines[y].split('')); };
      var copyCells = function (y, x0, w) { // characters and colours of one row segment
        var c = chars(y).slice(x0, x0 + w), px = color ? out.slice((y * cols + x0) * 4, (y * cols + x0 + w) * 4) : null;
        return [c, px];
      };
      var pasteCells = function (y, x0, cell) {
        var row = chars(y), c = cell[0];
        for (var k = 0; k < c.length; k++) {
          var x = x0 + k;
          if (x < 0 || x >= cols) continue;
          row[x] = c[k];
          if (color) { var d = (y * cols + x) * 4, sIdx = k * 4; out[d] = cell[1][sIdx]; out[d + 1] = cell[1][sIdx + 1]; out[d + 2] = cell[1][sIdx + 2]; }
        }
      };
      var blank = function (y, x0, w) { var row = chars(y); for (var x = Math.max(0, x0); x < Math.min(cols, x0 + w); x++) row[x] = ' '; };

      var pieces = 1 + ((rnd() * (1 + g * 4)) | 0);
      for (var pc = 0; pc < pieces; pc++) {
        var pw = Math.max(6, (cols * (0.12 + rnd() * 0.55 * g)) | 0), ph = Math.max(1, (rows * (0.05 + rnd() * 0.35 * g)) | 0);
        var px0 = (rnd() * (cols - pw)) | 0, py0 = (rnd() * (rows - ph)) | 0, kind = rnd(), yy0;
        if (kind < 0.3) {
          for (yy0 = py0; yy0 < py0 + ph; yy0++) blank(yy0, px0, pw);           // gone
        } else if (kind < 0.75) {
          var sdx = Math.round((rnd() < 0.5 ? -1 : 1) * cols * (0.05 + rnd() * 0.3 * g));
          for (yy0 = py0; yy0 < py0 + ph; yy0++) {                                // slides sideways
            var seg = copyCells(yy0, px0, pw);
            blank(yy0, px0, pw);
            pasteCells(yy0, px0 + sdx, seg);
          }
        } else {
          var sdy = Math.round((rnd() < 0.5 ? -1 : 1) * rows * (0.08 + rnd() * 0.3 * g));
          var moved = [];
          for (yy0 = py0; yy0 < py0 + ph; yy0++) moved.push(copyCells(yy0, px0, pw));
          if (rnd() < 0.6) for (yy0 = py0; yy0 < py0 + ph; yy0++) blank(yy0, px0, pw);
          for (var mi = 0; mi < moved.length; mi++) {                             // jumps up or down
            var ty = py0 + mi + sdy;
            if (ty >= 0 && ty < rows) pasteCells(ty, px0, moved[mi]);
          }
        }
      }
      // a band of dropped scanlines
      if (rnd() < 0.25 * g) {
        var dy0 = (rnd() * rows) | 0, dh = (rows * (0.1 + rnd() * 0.3)) | 0, step = rnd() < 0.5 ? 2 : 3;
        for (var dyy = dy0; dyy < Math.min(rows, dy0 + dh); dyy++) if (dyy % step === 0) blank(dyy, 0, cols);
      }
      // junk where the signal broke
      var blocks = (rnd() * g * 6) | 0;
      for (var bk = 0; bk < blocks; bk++) {
        var bx = (rnd() * cols) | 0, bw = 4 + ((rnd() * 40 * g) | 0);
        var y0 = (rnd() * rows) | 0, h0 = 1 + ((rnd() * 3) | 0);
        var junk = rnd() < 0.5 ? GLITCH[(rnd() * GLITCH.length) | 0] : '';
        for (var yk = y0; yk < Math.min(rows, y0 + h0); yk++) {
          var jr = chars(yk);
          for (var xk = 0; xk < bw && bx + xk < cols; xk++) jr[bx + xk] = junk || GLITCH[(rnd() * GLITCH.length) | 0];
        }
      }
      for (var ry in rc) lines[ry] = rc[ry].join('');
      // whole bands torn sideways at draw time
      var bands = 1 + ((rnd() * g * 4) | 0);
      for (var bnd = 0; bnd < bands; bnd++) {
        var by = (rnd() * rows) | 0, bh = 1 + ((rnd() * Math.max(1, rows * 0.25 * g)) | 0);
        var bs = (rnd() - 0.5) * g * 90 * this.cellW;
        for (var yb = by; yb < Math.min(rows, by + bh); yb++) this.shift[yb] = bs;
      }
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
    if (heavy) {
      // colour ghosts: a red copy to one side and a pale copy to the other, on some rows only
      var dx = (2 + g * 7) * this.cellW;
      ctx.globalAlpha = Math.min(0.75, 0.25 + g * 0.6);
      ctx.fillStyle = '#e3182d';
      for (yy = 0; yy < rows; yy++) if (lines[yy].trim() && Math.random() < 0.2 + g * 0.3) ctx.fillText(lines[yy], this.ox + this.shift[yy] - dx, (yy + 0.5) * ch);
      if (g > 0.6) {
        ctx.globalAlpha = Math.min(0.4, 0.1 + g * 0.3);
        ctx.fillStyle = '#e8e3da';
        for (yy = 0; yy < rows; yy++) if (lines[yy].trim() && Math.random() < 0.12) ctx.fillText(lines[yy], this.ox + this.shift[yy] + dx * 0.6, (yy + 0.5) * ch);
      }
      ctx.globalAlpha = 1;
    }
  };

  /* ---------- inked lines ----------
   * ink() writes a polyline (in the scene's current transform) straight into
   * character cells, picking / | \ - _ from the direction of each segment.
   * mask() erases ink under a closed shape, so later fills hide earlier lines. */
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
    var m = ctx.getTransform(), cols = this.cols, rows = this.rows, asp = this.aspect, k1 = 1 / this.ss;
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
      var x = (m.a * pts[k] + m.c * pts[k + 1] + m.e) * k1, y = (m.b * pts[k] + m.d * pts[k + 1] + m.f) * k1;
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
    var m = ctx.getTransform(), polys = [], x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, k1 = 1 / this.ss;
    for (var s = 0; s < subs.length; s++) {
      var p = subs[s], q = new Float32Array(p.length);
      for (var k = 0; k < p.length; k += 2) {
        var x = (m.a * p[k] + m.c * p[k + 1] + m.e) * k1, y = (m.b * p[k] + m.d * p[k + 1] + m.f) * k1;
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

  // Draw the most overdue views first and stop when this frame's time budget is used,
  // so two pictures on screen take turns instead of both drawing in the same frame.
  var BUDGET_MS = 8;
  var dueList = [];
  function frame(now) {
    global.requestAnimationFrame(frame);
    if (document.hidden) { lastFrame = 0; return; }
    if (lastFrame && !lite) {
      gaps.push(now - lastFrame);
      if (gaps.length >= 150) {
        var sorted = gaps.slice().sort(function (a, b) { return a - b; });
        if (sorted[75] > 24) goLite(); // median frame longer than 24 ms: below ~42 fps for 2-3 s
        gaps.length = 0;
      }
    }
    lastFrame = now;
    if (rectsDirty) {
      rectsDirty = false;
      for (var r = 0; r < views.length; r++) if (views[r].visible) views[r].rect = views[r].canvas.getBoundingClientRect();
    }
    dueList.length = 0;
    for (var i = 0; i < views.length; i++) {
      if (!views[i].visible) continue;
      var d = views[i].due(now);
      if (d > 0) dueList.push([d, views[i]]);
    }
    if (!dueList.length) return;
    dueList.sort(function (a, b) { return b[0] - a[0]; });
    var start = performance.now();
    for (var k = 0; k < dueList.length; k++) {
      if (k > 0 && performance.now() - start > BUDGET_MS) break;
      dueList[k][1].tick(now);
    }
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
    clearRamps: function () { rampCache = {}; },
    goLite: goLite,
    isLite: function () { return lite; },
    TAU: TAU, clamp: clamp, lerp: lerp, rand: rand, ease: ease, reduced: reduced
  };
})(window);
