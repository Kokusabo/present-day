/* scenes.js
 * Every scene draws on the ASCII source canvas in "square units":
 * one unit = one character width, in both directions. view.W x view.H is the
 * size of the canvas in those units.
 */
(function (global) {
  'use strict';

  var A = global.ASCII;
  var TAU = A.TAU, clamp = A.clamp, lerp = A.lerp, rand = A.rand, ease = A.ease;

  function rng(seed) {
    var s = (seed >>> 0) || 1;
    return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }
  // map a w x h design space into the view, keeping proportions
  function fit(v, w, h, pad, ax, ay) {
    var s = Math.min(v.W / w, v.H / h) * (pad || 1);
    return { s: s, x: (v.W - w * s) * (ax === undefined ? 0.5 : ax), y: (v.H - h * s) * (ay === undefined ? 0.5 : ay) };
  }
  function bez(p, s) {
    var u = 1 - s;
    return {
      x: u * u * u * p[0].x + 3 * u * u * s * p[1].x + 3 * u * s * s * p[2].x + s * s * s * p[3].x,
      y: u * u * u * p[0].y + 3 * u * u * s * p[1].y + 3 * u * s * s * p[2].y + s * s * s * p[3].y
    };
  }
  function bezD(p, s) {
    var u = 1 - s;
    return {
      x: 3 * u * u * (p[1].x - p[0].x) + 6 * u * s * (p[2].x - p[1].x) + 3 * s * s * (p[3].x - p[2].x),
      y: 3 * u * u * (p[1].y - p[0].y) + 6 * u * s * (p[2].y - p[1].y) + 3 * s * s * (p[3].y - p[2].y)
    };
  }
  function curve(ctx, p) {
    ctx.bezierCurveTo(p[1].x, p[1].y, p[2].x, p[2].y, p[3].x, p[3].y);
  }
  function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
  // draw fn mirrored around x = 50 (portrait design space)
  function sym(ctx, fn) { ctx.save(); ctx.translate(100, 0); ctx.scale(-1, 1); fn(); ctx.restore(); }

  /* ====================================================================
   * EYE - follows the pointer, blinks only while you are not looking
   * ==================================================================== */
  function Eye() {
    var st = {
      lx: 0, ly: 0, tx: 0, ty: 0, sacc: 0,
      blink: 0, blinkT: -1, next: 1.2, dbl: false, blinks: 0,
      pupil: 1, contract: 0, watched: false,
      tear: null, nextTear: 16
    };
    var dust = [];
    return {
      state: st,
      init: function () {
        var r = rng(3);
        for (var i = 0; i < 80; i++) dust.push({ x: r(), y: r(), p: r() * TAU, s: 0.2 + r() * 0.8 });
      },
      click: function (x, y, v) { st.contract = 1; v.kick(0.5); },
      draw: function (ctx, v, t, dt) {
        var W = v.W, H = v.H, cx = W / 2, cy = H * 0.53;
        var ew = Math.min(W * 0.84, H * 2.25), eh = ew * 0.28;

        // where to look
        if (v.pointerActive) {
          var dx = (v.px - cx) / ew, dy = (v.py - cy) / ew;
          var d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
          var m = Math.min(1, d * 2) / d;
          st.tx = dx * m; st.ty = dy * m;
        } else if (t > st.sacc) {
          st.sacc = t + rand(0.5, 3.2);
          if (Math.random() < 0.3) { st.tx = 0; st.ty = 0; }
          else { st.tx = rand(-0.85, 0.85); st.ty = rand(-0.6, 0.6); }
        }
        var k = ease(v.pointerActive ? 10 : 30, dt);
        st.lx = lerp(st.lx, st.tx, k); st.ly = lerp(st.ly, st.ty, k);

        // it only blinks while you are not looking at it
        st.watched = v.pointerIn;
        if (st.blinkT < 0 && t > st.next && !st.watched) { st.blinkT = 0; st.blinks++; }
        if (st.blinkT >= 0) {
          st.blinkT += dt;
          var p = st.blinkT / 0.24;
          st.blink = p < 0.35 ? p / 0.35 : p < 0.5 ? 1 : Math.max(0, 1 - (p - 0.5) / 0.5);
          if (p >= 1) {
            st.blinkT = -1; st.blink = 0;
            if (!st.dbl && Math.random() < 0.25) { st.dbl = true; st.next = t + 0.1; }
            else { st.dbl = false; st.next = t + rand(1.6, 5); }
          }
        }
        st.contract = Math.max(0, st.contract - dt * 0.7);
        var pt = (st.watched ? 1.28 : 1) * (1 - 0.5 * st.contract) * (1 + 0.06 * Math.sin(t * 0.8));
        st.pupil = lerp(st.pupil, pt, ease(5, dt));

        // dust and a faint glow
        for (var i = 0; i < dust.length; i++) {
          var u = dust[i];
          var x = ((u.x * W + t * 0.6 * u.s) % W + W) % W, y = u.y * H + Math.sin(t * 0.5 + u.p) * 2;
          ctx.fillStyle = 'rgba(220,214,204,' + (0.18 + 0.16 * Math.sin(t * 1.7 + u.p)) + ')';
          circle(ctx, x, y, 0.35);
        }
        var glow = ctx.createRadialGradient(cx, cy, eh * 0.4, cx, cy, ew * 0.7);
        glow.addColorStop(0, 'rgba(230,220,210,0.13)');
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);

        // lids
        var open = 1 - st.blink;
        var Lx = cx - ew / 2, Ly = cy + eh * 0.12, Rx = cx + ew / 2, Ry = cy - eh * 0.06;
        var lo = cy + eh * 0.9;
        var upOpen = cy - eh * (st.watched ? 1.38 : 1.25);
        var up = lerp(lo - eh * 0.04, upOpen, open);
        var U = [{ x: Lx, y: Ly }, { x: Lx + ew * 0.2, y: up }, { x: Rx - ew * 0.3, y: up + eh * 0.06 }, { x: Rx, y: Ry }];
        var D = [{ x: Rx, y: Ry }, { x: Rx - ew * 0.26, y: lo }, { x: Lx + ew * 0.3, y: lo + eh * 0.05 }, { x: Lx, y: Ly }];

        var ix = cx + st.lx * ew * 0.24, iy = cy + eh * 0.05 + st.ly * eh * 0.42;
        var ri = eh * 0.76;
        if (open > 0.04) {
          ctx.save();
          ctx.beginPath(); ctx.moveTo(Lx, Ly); curve(ctx, U); curve(ctx, D); ctx.closePath();
          var sg = ctx.createRadialGradient(cx, cy, eh * 0.3, cx, cy, ew * 0.55);
          sg.addColorStop(0, '#ece6dc'); sg.addColorStop(0.55, '#b8b1a6'); sg.addColorStop(1, '#46423e');
          ctx.fillStyle = sg; ctx.fill();
          ctx.clip();

          var ig = ctx.createRadialGradient(ix, iy, 0, ix, iy, ri);
          ig.addColorStop(0, '#ff8a66'); ig.addColorStop(0.3, '#f22a32');
          ig.addColorStop(0.72, '#8a0716'); ig.addColorStop(0.92, '#3a0208'); ig.addColorStop(1, '#120003');
          ctx.fillStyle = ig; circle(ctx, ix, iy, ri);

          var rp = ri * 0.36 * st.pupil;
          ctx.lineWidth = Math.max(0.22, ri * 0.022);
          for (var f = 0; f < 64; f++) {
            var a = f / 64 * TAU + Math.sin(f * 7.31) * 0.04;
            var r0 = rp * 1.08, r1 = ri * (0.8 + 0.13 * Math.sin(f * 3.7));
            ctx.strokeStyle = f % 2 ? 'rgba(255,190,170,0.5)' : 'rgba(20,0,0,0.6)';
            ctx.beginPath();
            ctx.moveTo(ix + Math.cos(a) * r0, iy + Math.sin(a) * r0);
            ctx.lineTo(ix + Math.cos(a) * r1, iy + Math.sin(a) * r1);
            ctx.stroke();
          }
          ctx.fillStyle = '#000'; circle(ctx, ix, iy, rp);
          ctx.fillStyle = '#fff';
          circle(ctx, ix - ri * 0.34, iy - ri * 0.36, ri * 0.15);
          circle(ctx, ix + ri * 0.3, iy + ri * 0.3, ri * 0.06);

          var lg = ctx.createLinearGradient(0, up + eh * 0.2, 0, up + eh * 1.1);
          lg.addColorStop(0, 'rgba(0,0,0,0.85)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
          ctx.fillStyle = lg; ctx.fillRect(Lx, cy - eh * 2, ew, eh * 4);
          ctx.restore();
        }

        // upper lid line, lower lid, crease
        ctx.strokeStyle = '#f2ede4';
        ctx.lineWidth = eh * 0.1;
        ctx.beginPath(); ctx.moveTo(Lx, Ly); curve(ctx, U); ctx.stroke();
        ctx.strokeStyle = 'rgba(230,224,214,0.8)';
        ctx.lineWidth = eh * 0.04;
        ctx.beginPath(); ctx.moveTo(Rx, Ry); curve(ctx, D); ctx.stroke();
        var crY = lerp(cy - eh * 0.6, upOpen - eh * 0.55, 0.4 + 0.6 * open);
        ctx.strokeStyle = 'rgba(220,214,204,0.55)';
        ctx.lineWidth = eh * 0.035;
        ctx.beginPath();
        ctx.moveTo(Lx + ew * 0.1, Ly - eh * 0.4);
        ctx.bezierCurveTo(Lx + ew * 0.3, crY, Rx - ew * 0.3, crY, Rx - ew * 0.03, Ry - eh * 0.5);
        ctx.stroke();

        // lashes
        ctx.strokeStyle = '#efe9df';
        ctx.lineWidth = eh * 0.035;
        for (var j = 0; j < 24; j++) {
          var s = 0.1 + j / 23 * 0.88;
          var P = bez(U, s), T = bezD(U, s);
          var tl = Math.sqrt(T.x * T.x + T.y * T.y) || 1;
          var nx = T.y / tl, ny = -T.x / tl;
          var fan = (s - 0.4) * 1.2;
          var c = Math.cos(fan), sn = Math.sin(fan);
          var lx = nx * c - ny * sn, ly = nx * sn + ny * c;
          ly = ly * (0.2 + 0.8 * open) + (1 - open) * 0.9;
          var len = eh * (0.2 + 0.32 * Math.sin(Math.PI * Math.min(1, s * 1.05)));
          ctx.beginPath();
          ctx.moveTo(P.x, P.y);
          ctx.quadraticCurveTo(P.x + lx * len * 0.6, P.y + ly * len * 0.6, P.x + lx * len + len * 0.25, P.y + ly * len + len * 0.1);
          ctx.stroke();
        }
        ctx.strokeStyle = 'rgba(230,224,214,0.6)';
        ctx.lineWidth = eh * 0.025;
        for (j = 0; j < 10; j++) {
          s = 0.12 + j / 9 * 0.6;
          P = bez(D, s); T = bezD(D, s);
          tl = Math.sqrt(T.x * T.x + T.y * T.y) || 1;
          nx = T.y / tl; ny = -T.x / tl;
          len = eh * 0.12;
          ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(P.x + nx * len - len * 0.2, P.y + ny * len); ctx.stroke();
        }

        // a tear, now and then, when nobody is looking
        if (!st.tear && t > st.nextTear && !st.watched) st.tear = { y: 0, v: 0 };
        if (st.tear) {
          var base = bez(D, 0.86);
          st.tear.v += dt * eh * 0.6;
          st.tear.y += st.tear.v * dt;
          var ty0 = base.y + st.tear.y;
          ctx.strokeStyle = 'rgba(208,16,32,0.55)';
          ctx.lineWidth = eh * 0.035;
          ctx.beginPath(); ctx.moveTo(base.x, base.y + eh * 0.05); ctx.lineTo(base.x, ty0); ctx.stroke();
          ctx.fillStyle = '#e01428';
          circle(ctx, base.x, ty0, eh * 0.075);
          if (ty0 > H + 3) { st.tear = null; st.nextTear = t + rand(22, 45); }
        }
      }
    };
  }

  /* ====================================================================
   * BLOOM - lilies and red spider lilies
   * ==================================================================== */
  var PAL = {
    crimson: ['#3a0010', '#c4122c', '#ff5566'],
    white: ['#7a8a50', '#ece6d6', '#ffffff'],
    yellow: ['#6a4000', '#f0b020', '#fff6a0'],
    pink: ['#50003a', '#e0308a', '#ffd0ea'],
    orange: ['#5a1800', '#f06418', '#ffc080']
  };

  function Bloom() {
    var flowers = [], petals = [], motes = [], wind = 0, lastPx = null, lastPy = null, lastDir = 0, F = null;
    // shake: grows while the pointer swings back and forth over the bouquet, fades on its own
    var shake = 0, shakeX = 50, shakeY = 50, phoneShake = 0;
    var LEAVES = [[-1, 30, 60, 0], [1, 34, 58, 0.6], [-1, 42, 74, 1.3], [1, 40, 72, 2], [-1, 20, 80, 2.7], [1, 22, 79, 3.1]];

    function lily(ctx, f, t) {
      var pal = PAL[f.pal], L = f.s;
      ctx.save();
      ctx.translate(f.hx, f.hy); ctx.rotate(f.r); ctx.scale(1, f.sq);
      for (var pass = 0; pass < 2; pass++) {
        for (var j = 0; j < 3; j++) {
          var a = f.a0 + pass * Math.PI / 3 + j * TAU / 3;
          petal(ctx, a, L * (pass ? 0.94 : 1), L * (pass ? 0.24 : 0.19), pal, f, pass);
        }
      }
      var tg = ctx.createRadialGradient(0, 0, 0, 0, 0, L * 0.26);
      tg.addColorStop(0, '#e8f0a0'); tg.addColorStop(1, 'rgba(200,220,120,0)');
      ctx.fillStyle = tg; circle(ctx, 0, 0, L * 0.26);
      ctx.lineWidth = 0.28;
      for (var k = 0; k < 6; k++) {
        var b = f.a0 + 0.4 + k * TAU / 6 + Math.sin(t * 1.3 + k) * 0.04;
        var sl = L * 0.62, ex = Math.cos(b) * sl, ey = Math.sin(b) * sl;
        ctx.strokeStyle = '#d8e8a8';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(ex * 0.5, ey * 0.5 - L * 0.12, ex, ey); ctx.stroke();
        ctx.fillStyle = '#c0501a';
        ctx.beginPath(); ctx.ellipse(ex, ey, L * 0.075, L * 0.03, b + Math.PI / 2, 0, TAU); ctx.fill();
      }
      ctx.restore();
    }
    function petal(ctx, a, len, wid, pal, f, pass) {
      ctx.save(); ctx.rotate(a);
      var curl = len * 0.07;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.25, -wid * 1.05, len * 0.7, -wid * 0.95, len, curl);
      ctx.bezierCurveTo(len * 0.72, wid * 0.75, len * 0.28, wid * 0.95, 0, 0);
      var g = ctx.createLinearGradient(0, 0, len, 0);
      g.addColorStop(0, pal[0]); g.addColorStop(0.32, pal[1]); g.addColorStop(1, pal[2]);
      ctx.fillStyle = g; ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 0.55; ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(len * 0.12, 0); ctx.quadraticCurveTo(len * 0.55, -wid * 0.08, len * 0.93, curl * 0.9); ctx.stroke();
      if (f.pal !== 'white' && f.pal !== 'yellow') {
        ctx.fillStyle = 'rgba(40,0,10,0.75)';
        for (var i = 0; i < 6; i++) {
          var sp = f.spots[(i + pass * 6) % f.spots.length];
          circle(ctx, len * sp[0], wid * sp[1] * 2, 0.34);
        }
      }
      ctx.restore();
    }
    function spider(ctx, f, t) {
      var s = f.s, n = 7;
      ctx.save(); ctx.translate(f.hx, f.hy);
      for (var i = 0; i < n; i++) {
        var a = f.a0 + i / n * TAU;
        var bx = Math.cos(a) * s * 0.16, by = Math.sin(a) * s * 0.1 - s * 0.05;
        var dx = Math.cos(a), dy = Math.sin(a) * 0.55 - 0.45;
        var dl = Math.sqrt(dx * dx + dy * dy); dx /= dl; dy /= dl;
        var px = -dy, py = dx;
        ctx.lineWidth = s * 0.026;
        for (var k = -1; k <= 1; k++) {
          var sa = k * 0.22 + Math.sin(t * 0.8 + i + k) * 0.03;
          var sx = dx * Math.cos(sa) - dy * Math.sin(sa), sy = dx * Math.sin(sa) + dy * Math.cos(sa);
          var L1 = s * (0.95 + 0.12 * k * k);
          var ex = bx + sx * L1, ey = by + sy * L1 - s * 0.25;
          ctx.strokeStyle = '#ff2a3c';
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.bezierCurveTo(bx + sx * L1 * 0.4, by + sy * L1 * 0.4, ex - sx * L1 * 0.2, ey + s * 0.15, ex, ey);
          ctx.stroke();
          ctx.fillStyle = '#ffd890'; circle(ctx, ex, ey, s * 0.04);
        }
        ctx.strokeStyle = i % 2 ? '#e0142e' : '#b80c22';
        ctx.lineWidth = s * 0.07;
        for (var q = -1; q <= 1; q++) {
          var o = q * 0.42;
          var qx = dx * Math.cos(o) - dy * Math.sin(o), qy = dx * Math.sin(o) + dy * Math.cos(o);
          var wv = Math.sin(t * 2 + i + q) * s * 0.02;
          var side = q === 0 ? (i % 2 ? 1 : -1) : q;
          ctx.beginPath(); ctx.moveTo(bx, by);
          ctx.bezierCurveTo(
            bx + qx * s * 0.25 + wv, by + qy * s * 0.25,
            bx + qx * s * 0.5 + px * side * s * 0.08, by + qy * s * 0.5 + py * side * s * 0.08 + s * 0.04,
            bx + qx * s * 0.42 + px * side * s * 0.17, by + qy * s * 0.42 + py * side * s * 0.1 + s * 0.15);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    function bud(ctx, f) {
      var pal = PAL[f.pal], s = f.s;
      ctx.save(); ctx.translate(f.hx, f.hy); ctx.rotate(f.r);
      var g = ctx.createLinearGradient(0, s * 0.4, 0, -s);
      g.addColorStop(0, '#4a8a30'); g.addColorStop(0.5, pal[1]); g.addColorStop(1, pal[2]);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, s * 0.4);
      ctx.bezierCurveTo(s * 0.36, 0, s * 0.26, -s * 0.7, 0, -s);
      ctx.bezierCurveTo(-s * 0.26, -s * 0.7, -s * 0.36, 0, 0, s * 0.4);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(0, s * 0.3); ctx.quadraticCurveTo(s * 0.08, -s * 0.4, 0, -s * 0.95); ctx.stroke();
      ctx.restore();
    }
    function spawnPetal(x, y, pal, push) {
      var c = pal ? PAL[pal][Math.random() < 0.5 ? 1 : 2] : (Math.random() < 0.5 ? '#e0142e' : '#ff5566');
      petals.push({ x: x, y: y, vx: rand(-1, 1) + (push || 0), vy: rand(-1.5, 0.5), a: rand(TAU), va: rand(-3, 3), s: rand(0.8, 1.6), c: c });
    }

    return {
      // a shake from outside the canvas (the phone itself, or the terminal)
      shake: function (amount) { phoneShake = Math.min(3, phoneShake + amount); },
      petalCount: function () { return petals.length; },
      init: function () {
        var r = rng(9);
        flowers = [
          { k: 'spider', x: 50, y: 13, s: 12 },
          { k: 'lily', x: 24, y: 28, s: 11, rot: -0.55, sq: 0.72, pal: 'white' },
          { k: 'lily', x: 77, y: 25, s: 11, rot: 0.5, sq: 0.7, pal: 'yellow' },
          { k: 'bud', x: 91, y: 46, s: 6, rot: 0.55, pal: 'pink' },
          { k: 'bud', x: 9, y: 49, s: 6, rot: -0.65, pal: 'white' },
          { k: 'lily', x: 52, y: 44, s: 15, rot: 0.05, sq: 0.8, pal: 'crimson' },
          { k: 'spider', x: 18, y: 64, s: 11 },
          { k: 'lily', x: 81, y: 61, s: 12, rot: 0.35, sq: 0.78, pal: 'pink' },
          { k: 'lily', x: 36, y: 77, s: 10, rot: -0.25, sq: 0.74, pal: 'orange' },
          { k: 'spider', x: 67, y: 81, s: 9 }
        ];
        for (var i = 0; i < flowers.length; i++) {
          var f = flowers[i];
          f.a0 = r() * TAU; f.ph = r() * TAU; f.spots = [];
          for (var j = 0; j < 12; j++) f.spots.push([0.12 + r() * 0.35, (r() - 0.5) * 0.24]);
        }
        for (i = 0; i < 70; i++) motes.push({ x: r(), y: r(), p: r() * TAU });
      },
      draw: function (ctx, v, t, dt) {
        var W = v.W, H = v.H;
        F = fit(v, 100, 112, 0.98, 0.5, 0.5);
        for (var i = 0; i < motes.length; i++) {
          var m = motes[i];
          ctx.fillStyle = 'rgba(255,240,230,' + (0.12 + 0.14 * Math.sin(t * 1.3 + m.p)) + ')';
          circle(ctx, m.x * W, m.y * H, 0.4);
        }
        var pxd = (v.px - F.x) / F.s, pyd = (v.py - F.y) / F.s;
        if (v.pointerIn) {
          if (lastPx !== null) {
            var mvx = pxd - lastPx, mvy = pyd - lastPy, speed = Math.sqrt(mvx * mvx + mvy * mvy);
            wind += clamp(mvx * 0.035, -0.3, 0.3);
            // a swing counts more when it changes direction: that is what shaking is
            var dir = mvx > 0.4 ? 1 : mvx < -0.4 ? -1 : 0;
            var turn = dir && lastDir && dir !== lastDir ? 0.6 : 0;
            if (dir) lastDir = dir;
            shake += Math.min(speed, 12) * 0.028 + turn;
            shakeX = pxd; shakeY = pyd;
          }
          lastPx = pxd; lastPy = pyd;
        } else { lastPx = null; lastDir = 0; }
        shake = Math.min(4, shake * Math.exp(-dt * 2.2));
        phoneShake *= Math.exp(-dt * 1.8);
        if (phoneShake > 0.05) wind += Math.sin(t * 17) * phoneShake * 0.12;
        wind = clamp(wind * Math.exp(-dt * 1.4), -1.4, 1.4);

        ctx.save();
        ctx.translate(F.x, F.y); ctx.scale(F.s, F.s);

        for (i = 0; i < flowers.length; i++) {
          var f = flowers[i];
          var tremble = Math.sin(t * 15 + f.ph * 3) * Math.min(1.6, shake * 0.4 + phoneShake * 0.5);
          var sway = Math.sin(t * 0.7 + f.ph) * 0.9 + wind * (1.3 - f.y / 112) * 5 + tremble;
          var push = 0;
          if (v.pointerIn) {
            var ddx = f.x - pxd, ddy = f.y - pyd, d2 = ddx * ddx + ddy * ddy;
            if (d2 < 420) push = (1 - d2 / 420) * 3.2 * (ddx < 0 ? -1 : 1);
          }
          f.push = lerp(f.push || 0, push, ease(5, dt));
          f.hx = f.x + sway + f.push;
          f.hy = f.y + Math.cos(t * 0.9 + f.ph) * 0.4;
          f.r = (f.rot || 0) + (sway + f.push) * 0.03;
        }

        // leaves
        for (i = 0; i < LEAVES.length; i++) {
          var lf = LEAVES[i], side = lf[0];
          var tipX = 50 + side * lf[1] + Math.sin(t * 0.6 + lf[3]) * 0.8 + wind * 3, tipY = lf[2];
          var lg = ctx.createLinearGradient(50, 94, tipX, tipY);
          lg.addColorStop(0, '#0e3a10'); lg.addColorStop(1, '#4aa83a');
          ctx.fillStyle = lg;
          ctx.beginPath();
          ctx.moveTo(50 + side, 94);
          ctx.quadraticCurveTo(50 + side * lf[1] * 0.25, tipY + (94 - tipY) * 0.25, tipX, tipY);
          ctx.quadraticCurveTo(50 + side * lf[1] * 0.5, tipY + (94 - tipY) * 0.65, 50 + side * 3, 94);
          ctx.fill();
        }
        // stems
        ctx.strokeStyle = '#3f9a34';
        ctx.lineWidth = 0.95;
        for (i = 0; i < flowers.length; i++) {
          f = flowers[i];
          var tx = 50 + (f.x - 50) * 0.1, ty = 88;
          ctx.beginPath();
          ctx.moveTo(f.hx, f.hy + (f.k === 'bud' ? f.s * 0.4 : 0));
          ctx.quadraticCurveTo(lerp(f.hx, 50, 0.2), lerp(f.hy, ty, 0.7), tx, ty);
          ctx.lineTo(50 + (f.x - 50) * 0.05, 113);
          ctx.stroke();
        }
        // a red ribbon where the stems are tied
        ctx.fillStyle = '#d0102a';
        ctx.beginPath(); ctx.ellipse(46.2, 87.5, 3.6, 1.7, -0.35, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.ellipse(53.8, 87.5, 3.6, 1.7, 0.35, 0, TAU); ctx.fill();
        ctx.strokeStyle = '#d0102a'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(50, 88.5); ctx.quadraticCurveTo(47 + wind * 2, 95, 45.5 + Math.sin(t) * 0.6, 101); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(50, 88.5); ctx.quadraticCurveTo(53 + wind * 2, 95, 55 + Math.sin(t + 1) * 0.6, 100); ctx.stroke();
        ctx.fillStyle = '#ff4050'; circle(ctx, 50, 88, 1.2);

        var order = flowers.slice().sort(function (a, b) { return a.y - b.y; });
        for (i = 0; i < order.length; i++) {
          f = order[i];
          if (f.k === 'lily') lily(ctx, f, t);
          else if (f.k === 'spider') spider(ctx, f, t);
          else bud(ctx, f);
        }

        // petals only come loose when the flowers are shaken, mostly the ones nearest the hand
        if (shake > 0.55 || phoneShake > 0.2) {
          for (i = 0; i < flowers.length; i++) {
            f = flowers[i];
            var near = Math.exp(-((f.hx - shakeX) * (f.hx - shakeX) + (f.hy - shakeY) * (f.hy - shakeY)) / 700);
            var rate = Math.max(0, shake - 0.55) * near * 2.6 + phoneShake * 0.9;
            if (Math.random() < rate * dt) spawnPetal(f.hx + rand(-2, 2), f.hy + rand(-1.5, 1.5), f.pal, wind * 3);
          }
        }
        for (i = petals.length - 1; i >= 0; i--) {
          var p = petals[i];
          p.vy = Math.min(p.vy + dt * 3, 3.2);
          p.x += (p.vx + wind * 8 + Math.sin(t * 1.5 + p.a) * 1.2) * dt;
          p.y += p.vy * dt;
          p.a += p.va * dt;
          if (p.y > 116) { petals.splice(i, 1); continue; }
          ctx.fillStyle = p.c;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s, p.s * 0.45, p.a, 0, TAU); ctx.fill();
        }
        if (petals.length > 260) petals.splice(0, petals.length - 260);
        ctx.restore();
      }
    };
  }

  /* ====================================================================
   * MOON - a shaded sphere with craters and phases
   * ==================================================================== */
  function Moon() {
    var st = { blood: false, img: null, phase: 0.5 };
    var cr = [], stars = [];
    var r = rng(11);
    for (var i = 0; i < 34; i++) {
      var lon = r() * TAU, lat = (r() - 0.5) * 2.4, mare = i < 8;
      cr.push({
        x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon),
        rad: mare ? 0.3 + r() * 0.3 : 0.04 + r() * r() * 0.22,
        depth: mare ? 0.3 + r() * 0.14 : 0.4 + r() * 0.4,
        mare: mare
      });
      cr[i].cosR = Math.cos(cr[i].rad * 1.35);
    }
    for (i = 0; i < 70; i++) stars.push({ x: r(), y: r(), p: r() * TAU, b: 0.25 + r() * 0.6 });
    return {
      state: st,
      click: function (x, y, v) { st.blood = !st.blood; v.kick(0.4); },
      resize: function (v) { st.img = v.sctx.createImageData(v.sw, v.sh); st.alb = new Float32Array(v.sw * v.sh); st.albRot = -1; },
      draw: function (ctx, v, t) {
        var img = st.img, d = img.data, sw = v.sw, sh = v.sh, ss = v.ss, asp = v.aspect;
        var cx = v.W / 2, cy = v.H / 2, R = Math.min(v.W, v.H) * 0.42;
        var rot = t * 0.03;
        var th = st.phase * TAU + Math.sin(t * 0.2) * 0.02;
        var Lx = Math.sin(th), Ly = -0.12, Lz = -Math.cos(th);
        var ln = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz); Lx /= ln; Ly /= ln; Lz /= ln;
        var cR = Math.cos(rot), sR = Math.sin(rot);
        var tint = st.blood ? [255, 52, 40] : [244, 238, 228];
        var c, o, val, A2 = st.alb;
        var relief = Math.abs(rot - st.albRot) > 0.008;
        if (relief) st.albRot = rot;
        for (var y = 0; y < sh; y++) {
          var dy = ((y + 0.5) / ss * asp - cy) / R;
          for (var x = 0; x < sw; x++) {
            var dx = ((x + 0.5) / ss - cx) / R, d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              var nz = Math.sqrt(1 - d2);
              var lam = dx * Lx + dy * Ly + nz * Lz;
              lam = lam < 0 ? 0 : Math.pow(lam, 0.7);
              var alb;
              if (relief) {
                var px = dx * cR - nz * sR, pz = dx * sR + nz * cR, py = dy;
                alb = 0.82;
                for (var i = 0; i < cr.length; i++) {
                  c = cr[i];
                  var cd = px * c.x + py * c.y + pz * c.z;
                  if (cd > c.cosR) {
                    var q = Math.acos(cd > 1 ? 1 : cd) / c.rad;
                    if (c.mare) alb -= c.depth * Math.exp(-q * q * 2);
                    else {
                      if (q < 1) alb -= c.depth * (1 - q * q) * 0.7;
                      alb += 0.2 * Math.exp(-((q - 1) * (q - 1)) / 0.02);
                    }
                  }
                }
                A2[y * sw + x] = alb;
              } else alb = A2[y * sw + x];
              // soft terminator, faint earthshine, darker limb
              val = alb * (0.11 + 0.89 * lam) * (0.78 + 0.22 * nz);
            } else {
              val = 0.16 * Math.exp(-(Math.sqrt(d2) - 1) * 5);
            }
            o = (y * sw + x) * 4;
            d[o] = val * tint[0]; d[o + 1] = val * tint[1]; d[o + 2] = val * tint[2]; d[o + 3] = 255;
          }
        }
        for (i = 0; i < stars.length; i++) {
          var s = stars[i], sx = (s.x * v.cols) | 0, sy = (s.y * v.rows) | 0;
          var ddx = (sx + 0.5 - cx) / R, ddy = ((sy + 0.5) * asp - cy) / R;
          if (ddx * ddx + ddy * ddy < 1.4) continue;
          val = s.b * (0.5 + 0.5 * Math.sin(t * 1.6 + s.p)) * 255;
          for (var yy = 0; yy < ss; yy++) for (var xx = 0; xx < ss; xx++) {
            o = ((sy * ss + yy) * sw + sx * ss + xx) * 4;
            d[o] = d[o + 1] = d[o + 2] = val;
          }
        }
        ctx.putImageData(img, 0, 0);
      }
    };
  }

  /* ====================================================================
   * WIRES - power lines under a white sky
   * ==================================================================== */
  function Wires() {
    var st = { hum: false, fly: -99 };
    var crows = [[0.18, 0], [0.26, 1], [0.34, 0], [0.58, 1], [0.66, 0], [0.82, 1]];
    var r = rng(21), bld = [], dots = [];
    for (var i = 0; i < 30; i++) bld.push({ w: 0.025 + r() * 0.06, h: 0.04 + r() * 0.15, roof: r() });
    for (i = 0; i < 90; i++) dots.push({ u: r(), v: r(), s: 0.3 + r() * 0.65, p: r() * TAU });
    return {
      state: st,
      click: function (x, y, v) { v.kick(0.9); st.fly = v.t; },
      draw: function (ctx, v, t) {
        var W = v.W, H = v.H, hor = H * 0.7;
        var g = ctx.createLinearGradient(0, 0, 0, hor);
        g.addColorStop(0, '#4c4c47'); g.addColorStop(0.65, '#86847b'); g.addColorStop(1, '#b0ac9f');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, hor);
        var sx = W * 0.8, sy = H * 0.17, sr = Math.min(W, H) * 0.08;
        var sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr * 3.2);
        sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.3, '#ffffff');
        sg.addColorStop(0.34, 'rgba(255,255,255,0.55)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg; ctx.fillRect(sx - sr * 4, sy - sr * 4, sr * 8, sr * 8);

        // houses along the horizon
        ctx.fillStyle = '#080808';
        var x = 0, k = 0;
        while (x < W) {
          var b = bld[k % bld.length], bw = b.w * W, bh = b.h * H;
          ctx.fillRect(x, hor - bh, bw + 0.6, bh + 1);
          if (b.roof > 0.55) {
            ctx.beginPath(); ctx.moveTo(x - 0.5, hor - bh); ctx.lineTo(x + bw / 2, hor - bh - bw * 0.4); ctx.lineTo(x + bw + 0.5, hor - bh); ctx.fill();
          }
          x += bw; k++;
        }
        // sunlit asphalt, one long shadow, and the red inside the shadow
        var gg = ctx.createLinearGradient(0, hor, 0, H);
        gg.addColorStop(0, '#2a2a28'); gg.addColorStop(1, '#4e4c46');
        ctx.fillStyle = gg; ctx.fillRect(0, hor, W, H - hor);
        ctx.fillStyle = '#020202';
        ctx.beginPath(); ctx.moveTo(0, hor); ctx.lineTo(W * 0.5, hor); ctx.lineTo(W * 0.28, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
        for (i = 0; i < dots.length; i++) {
          var d = dots[i];
          var dx = lerp(d.u * W * 0.48, d.u * W * 0.26, d.v), dy = lerp(hor + 0.5, H, d.v);
          ctx.fillStyle = 'rgba(255,20,36,' + (0.5 + 0.5 * Math.sin(t * 0.7 + d.p)) + ')';
          circle(ctx, dx, dy, d.s);
        }

        // poles in perspective
        var vpX = W * 0.97, vpY = hor - H * 0.04, poles = [];
        for (k = 0; k < 7; k++) {
          var z = 1 + k * 0.9 + k * k * 0.25;
          poles.push({
            x: vpX + (W * 0.1 - vpX) / z,
            top: vpY + (-H * 0.06 - vpY) / z,
            base: vpY + (H * 1.1 - vpY) / z,
            z: z, w: Math.max(1.1, 3 / z), arm: Math.min(W * 0.12, 14) / z
          });
        }
        ctx.strokeStyle = '#030303';
        var levels = [0.05, 0.12], offs = [-1, -0.45, 0.45, 1];
        var amp = st.hum ? 0.55 : 0.2;
        for (k = -1; k < poles.length - 1; k++) {
          var p0 = k < 0 ? { x: -W * 0.4, top: -H * 0.5, base: H * 1.6, z: 0.6, arm: 20 } : poles[k];
          var p1 = poles[k + 1];
          for (var li = 0; li < levels.length; li++) {
            for (var oi = 0; oi < offs.length; oi++) {
              var o = offs[oi];
              var x0 = p0.x + o * p0.arm, y0 = p0.top + (p0.base - p0.top) * levels[li];
              var x1 = p1.x + o * p1.arm, y1 = p1.top + (p1.base - p1.top) * levels[li];
              var sag = Math.abs(x1 - x0) * 0.07 + 0.6;
              var hum = Math.sin(t * 11 + k * 1.7 + oi * 2.1 + li) * amp;
              ctx.lineWidth = Math.max(0.85, 1.2 / Math.sqrt(Math.max(1, p1.z)));
              ctx.beginPath(); ctx.moveTo(x0, y0);
              ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + 2 * sag + hum, x1, y1);
              ctx.stroke();
            }
          }
        }
        // crows on the wire between the first two poles; a tap scares them off
        var cp0 = poles[0], cp1 = poles[1], since = t - st.fly;
        for (i = 0; i < crows.length; i++) {
          var cw = crows[i], lv = cw[1] ? 0.12 : 0.05, s0 = cw[0], u = 1 - s0;
          var ax = cp0.x - 0.45 * cp0.arm, ay = cp0.top + (cp0.base - cp0.top) * lv;
          var bx2 = cp1.x - 0.45 * cp1.arm, by2 = cp1.top + (cp1.base - cp1.top) * lv;
          var sg = Math.abs(bx2 - ax) * 0.07 + 0.6;
          var mxw = (ax + bx2) / 2, myw = (ay + by2) / 2 + 2 * sg;
          var wx = u * u * ax + 2 * u * s0 * mxw + s0 * s0 * bx2, wy = u * u * ay + 2 * u * s0 * myw + s0 * s0 * by2;
          var sc = 1.5 - s0 * 0.5, fx = 0, fy = 0;
          if (since >= 0 && since < 14) {
            var fl = since < 7 ? since : 14 - since;
            fx = -fl * fl * 2.2 * (1 + i * 0.15); fy = -fl * fl * 1.4;
          }
          var bob = Math.sin(t * 2 + i * 1.7) * 0.08;
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.ellipse(wx + fx, wy - 0.9 * sc + bob + fy, 0.95 * sc, 0.62 * sc, 0.2, 0, TAU); ctx.fill();
          circle(ctx, wx + fx - 0.75 * sc, wy - 1.55 * sc + bob + fy, 0.42 * sc);
          ctx.beginPath(); ctx.moveTo(wx + fx + 0.7 * sc, wy - 0.8 * sc + fy); ctx.lineTo(wx + fx + 1.9 * sc, wy - 0.2 * sc + fy);
          ctx.lineTo(wx + fx + 1.6 * sc, wy - 1.0 * sc + fy); ctx.fill();
        }

        ctx.fillStyle = '#050505';
        for (k = poles.length - 1; k >= 0; k--) {
          var p = poles[k], ph = p.base - p.top;
          ctx.fillRect(p.x - p.w / 2, p.top, p.w, ph);
          for (li = 0; li < levels.length; li++) {
            var ay = p.top + ph * levels[li];
            ctx.fillRect(p.x - p.arm * 1.12, ay - 0.25 / p.z, p.arm * 2.24, 1.3 / p.z + 0.3);
            for (oi = 0; oi < offs.length; oi++) ctx.fillRect(p.x + offs[oi] * p.arm - 0.35 / p.z, ay - 1.6 / p.z, 0.7 / p.z + 0.2, 1.6 / p.z);
          }
          if (k === 1) {
            ctx.fillRect(p.x + p.w * 0.6, p.top + ph * 0.2, 3.2 / p.z * 2, 6 / p.z * 2);
          }
        }

      }
    };
  }

  /* ====================================================================
   * SNOW - a nine-storey block at night
   * ==================================================================== */
  function Snow(onLights) {
    var st = { win: [], flakes: [], next: 2, lit: -1 };
    var B = null, trees = [];
    var r = rng(5);
    return {
      state: st,
      resize: function (v) {
        var W = v.W, H = v.H;
        var x0 = W * 0.22, x1 = W * 0.8, y0 = H * 0.11, y1 = H * 0.8;
        var floors = 9, cols = clamp(Math.round((x1 - x0) / 5.2), 6, 18);
        B = { x0: x0, x1: x1, y0: y0, y1: y1, floors: floors, cols: cols, fh: (y1 - y0) / floors, cw: (x1 - x0) / cols };
        if (st.win.length !== floors * cols) {
          st.win = [];
          for (var i = 0; i < floors * cols; i++) st.win.push({ s: r() < 0.22 ? (r() < 0.25 ? 2 : 1) : 0, f: r() });
        }
        var n = Math.min(420, Math.round(W * H / 26));
        st.flakes = [];
        for (i = 0; i < n; i++) st.flakes.push({ x: r() * W, y: r() * H, z: 0.25 + r() * 0.75, p: r() * TAU });
        trees = [];
        var spots = [[0.07, 2], [0.15, 1.3], [0.87, 2.4], [0.95, 1.5]];
        for (i = 0; i < spots.length; i++) {
          var tr = { x: W * spots[i][0], w: spots[i][1], br: [], marks: [] };
          var top = -2, bottom = y1 + (H - y1) * 0.45;
          tr.top = top; tr.bottom = bottom;
          for (var j = 0; j < 9; j++) {
            var hy = lerp(top + 4, y1 - (y1 - y0) * 0.25, r());
            var side = r() < 0.5 ? -1 : 1;
            var len = 4 + r() * 10;
            tr.br.push({ y: hy, side: side, len: len, up: 0.6 + r() * 0.8, sub: r() });
          }
          for (j = 0; j < 14; j++) tr.marks.push({ y: lerp(top, bottom, r()), l: 0.4 + r() * 0.8 });
          trees.push(tr);
        }
      },
      click: function (x, y) {
        if (!B || x < B.x0 || x > B.x1 || y < B.y0 || y > B.y1) return;
        var c = Math.floor((x - B.x0) / B.cw), f = Math.floor((y - B.y0) / B.fh);
        var w = st.win[f * B.cols + c];
        if (w) w.s = w.s ? 0 : 1;
      },
      draw: function (ctx, v, t, dt) {
        var W = v.W, H = v.H;
        var g = ctx.createLinearGradient(0, 0, 0, B.y1);
        g.addColorStop(0, '#000000'); g.addColorStop(1, '#0c0a0b');
        ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

        // the block
        ctx.fillStyle = '#383a42'; ctx.fillRect(B.x0, B.y0, B.x1 - B.x0, B.y1 - B.y0);
        ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 0.35;
        for (var f = 1; f < B.floors; f++) {
          ctx.beginPath(); ctx.moveTo(B.x0, B.y0 + f * B.fh); ctx.lineTo(B.x1, B.y0 + f * B.fh); ctx.stroke();
        }
        for (var c = 1; c < B.cols; c += 2) {
          ctx.beginPath(); ctx.moveTo(B.x0 + c * B.cw, B.y0); ctx.lineTo(B.x0 + c * B.cw, B.y1); ctx.stroke();
        }
        ctx.fillStyle = '#0a0a0e'; ctx.fillRect(B.x0 - 0.8, B.y0 - 1, B.x1 - B.x0 + 1.6, 1.1);
        ctx.strokeStyle = '#0a0a0e'; ctx.lineWidth = 0.35;
        ctx.beginPath();
        ctx.moveTo(B.x0 + 8, B.y0 - 1); ctx.lineTo(B.x0 + 8, B.y0 - 7); ctx.moveTo(B.x0 + 6, B.y0 - 5.5); ctx.lineTo(B.x0 + 10, B.y0 - 5.5);
        ctx.moveTo(B.x1 - 12, B.y0 - 1); ctx.lineTo(B.x1 - 12, B.y0 - 5); ctx.moveTo(B.x1 - 14, B.y0 - 4); ctx.lineTo(B.x1 - 10, B.y0 - 4);
        ctx.stroke();
        ctx.fillStyle = 'rgba(220,226,235,0.85)'; ctx.fillRect(B.x0 - 0.8, B.y0 - 1.3, B.x1 - B.x0 + 1.6, 0.45);

        var lit = 0;
        for (f = 0; f < B.floors; f++) {
          for (c = 0; c < B.cols; c++) {
            var w = st.win[f * B.cols + c];
            var x = B.x0 + c * B.cw + B.cw * 0.18, y = B.y0 + f * B.fh + B.fh * 0.2;
            var ww = B.cw * 0.64, wh = B.fh * 0.58;
            if (w.s === 0) ctx.fillStyle = '#07080b';
            else if (w.s === 1) ctx.fillStyle = w.f > 0.5 ? '#ffcf78' : '#ffb85a';
            else {
              var k = 0.45 + 0.55 * Math.abs(Math.sin(t * 7.3 + w.f * 40) * Math.sin(t * 2.1 + w.f * 9));
              ctx.fillStyle = 'rgb(' + (80 * k | 0) + ',' + (120 * k | 0) + ',' + (255 * k | 0) + ')';
            }
            ctx.fillRect(x, y, ww, wh);
            if (w.s) {
              lit++;
              if (w.f > 0.65) { ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(x, y, ww * 0.42, wh); }
            }
          }
        }
        if (lit !== st.lit) { st.lit = lit; if (onLights) onLights(lit); }
        for (f = 1; f < B.floors; f++) {
          for (c = 0; c < B.cols; c += 3) {
            var bxx = B.x0 + c * B.cw + B.cw * 0.08, byy = B.y0 + f * B.fh + B.fh * 0.8;
            ctx.fillStyle = '#4a4d57'; ctx.fillRect(bxx, byy, B.cw * 0.84, B.fh * 0.16);
            ctx.fillStyle = 'rgba(225,230,238,0.9)'; ctx.fillRect(bxx, byy - B.fh * 0.04, B.cw * 0.84, B.fh * 0.05);
          }
        }

        // porch lights
        for (var e = 0; e < 3; e++) {
          var px = B.x0 + (e + 0.5) * (B.x1 - B.x0) / 3, py = B.y1 - 2.2;
          var pg = ctx.createRadialGradient(px, py, 0, px, py, 6);
          pg.addColorStop(0, 'rgba(255,200,120,0.9)'); pg.addColorStop(1, 'rgba(255,200,120,0)');
          ctx.fillStyle = pg; ctx.fillRect(px - 6, py - 6, 12, 12);
          ctx.fillStyle = '#16120e'; ctx.fillRect(px - 1.2, py, 2.4, 2.2);
        }

        // snow on the ground, a trodden path
        var gg = ctx.createLinearGradient(0, B.y1, 0, H);
        gg.addColorStop(0, '#5e6672'); gg.addColorStop(1, '#b4bcc6');
        ctx.fillStyle = gg; ctx.fillRect(0, B.y1, W, H - B.y1);
        ctx.strokeStyle = 'rgba(40,44,52,0.55)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(B.x0 + (B.x1 - B.x0) / 6, B.y1);
        ctx.bezierCurveTo(W * 0.3, H * 0.9, W * 0.62, H * 0.86, W * 0.58, H + 1); ctx.stroke();

        // a street lamp
        var lx = W * 0.115, ly = B.y1 - (B.y1 - B.y0) * 0.55;
        var lg = ctx.createRadialGradient(lx + 2.5, ly + 1, 0, lx + 2.5, ly + 1, H * 0.3);
        lg.addColorStop(0, 'rgba(255,176,96,0.42)'); lg.addColorStop(1, 'rgba(255,176,96,0)');
        ctx.fillStyle = lg; ctx.fillRect(0, 0, W * 0.4, H);
        ctx.strokeStyle = '#0b0b0d'; ctx.lineWidth = 0.9;
        ctx.beginPath(); ctx.moveTo(lx, H); ctx.lineTo(lx, ly); ctx.quadraticCurveTo(lx, ly - 2, lx + 2.5, ly - 1.2); ctx.stroke();
        ctx.fillStyle = '#ffd9a0'; ctx.fillRect(lx + 1.6, ly - 0.8, 2.2, 1.1);

        // birches
        for (var i = 0; i < trees.length; i++) {
          var tr = trees[i];
          ctx.strokeStyle = 'rgba(200,200,196,0.75)'; ctx.lineWidth = 0.35;
          for (var j = 0; j < tr.br.length; j++) {
            var b = tr.br[j], sway = Math.sin(t * 0.6 + j + i) * 0.3;
            var bx = tr.x + b.side * b.len * 0.9 + sway, by = b.y - b.len * b.up;
            ctx.beginPath(); ctx.moveTo(tr.x, b.y); ctx.quadraticCurveTo(tr.x + b.side * b.len * 0.4, b.y - b.len * 0.2, bx, by); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(lerp(tr.x, bx, 0.6), lerp(b.y, by, 0.6)); ctx.lineTo(bx + b.side * 2 * b.sub, by - 3); ctx.stroke();
          }
          ctx.fillStyle = '#e6e6e0';
          ctx.fillRect(tr.x - tr.w / 2, tr.top, tr.w, tr.bottom - tr.top);
          ctx.fillStyle = '#0a0a0a';
          for (j = 0; j < tr.marks.length; j++) {
            var m = tr.marks[j];
            ctx.fillRect(tr.x - tr.w / 2 + (j % 2 ? tr.w * 0.3 : 0), m.y, tr.w * 0.7, m.l);
          }
        }

        // snowfall
        var wind = Math.sin(t * 0.25) * 1.5 + (v.pointerIn ? clamp((v.px - W / 2) / W, -0.5, 0.5) * 6 : 0);
        ctx.fillStyle = '#ffffff';
        var fl = st.flakes;
        for (i = 0; i < fl.length; i++) {
          var s = fl[i];
          s.y += (3 + 9 * s.z) * dt;
          s.x += (Math.sin(t * 0.8 + s.p) * 1.2 + wind) * s.z * dt * 2;
          if (s.y > H + 1) { s.y = -1; s.x = Math.random() * W; }
          if (s.x > W + 1) s.x = -1; else if (s.x < -1) s.x = W + 1;
          circle(ctx, s.x, s.y, 0.16 + 0.5 * s.z);
        }

        // lights go on and off by themselves
        if (t > st.next) {
          st.next = t + rand(0.7, 2.4);
          var win = st.win[(Math.random() * st.win.length) | 0];
          var target = 0.2 + 0.08 * Math.sin(t * 0.05);
          win.s = win.s ? 0 : (lit / st.win.length < target ? (Math.random() < 0.2 ? 2 : 1) : 0);
        }
      }
    };
  }

  global.SCENES = { Eye: Eye, Bloom: Bloom, Moon: Moon, Wires: Wires, Snow: Snow };
})(window);
