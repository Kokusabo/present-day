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
        if (!st.tear && t > st.nextTear && !st.watched && !A.reduced) st.tear = { y: 0, v: 0 };
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
    var flowers = [], petals = [], motes = [], wind = 0, lastPx = null, F = null;
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
    function spawnPetal(x, y, pal) {
      var c = pal ? PAL[pal][Math.random() < 0.5 ? 1 : 2] : (Math.random() < 0.5 ? '#e0142e' : '#ff5566');
      petals.push({ x: x, y: y, vx: rand(-1, 1), vy: rand(-2, 0.5), a: rand(TAU), va: rand(-3, 3), s: rand(0.8, 1.6), c: c });
    }

    return {
      scatter: function () {
        for (var i = 0; i < flowers.length; i++) {
          for (var j = 0; j < 4; j++) spawnPetal(flowers[i].hx || flowers[i].x, flowers[i].hy || flowers[i].y, flowers[i].pal);
        }
      },
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
      click: function (x, y, v) {
        if (!F) return;
        var dx = (x - F.x) / F.s, dy = (y - F.y) / F.s, best = flowers[0], bd = 1e9;
        for (var i = 0; i < flowers.length; i++) {
          var f = flowers[i], d = (f.hx - dx) * (f.hx - dx) + (f.hy - dy) * (f.hy - dy);
          if (d < bd) { bd = d; best = f; }
        }
        for (i = 0; i < 18; i++) spawnPetal(dx + rand(-3, 3), dy + rand(-3, 3), best.pal);
        wind += rand(-0.4, 0.4);
        v.kick(0.15);
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
          if (lastPx !== null) wind += clamp((pxd - lastPx) * 0.03, -0.25, 0.25);
          lastPx = pxd;
        } else lastPx = null;
        wind = clamp(wind * Math.exp(-dt * 1.4), -1.2, 1.2);

        ctx.save();
        ctx.translate(F.x, F.y); ctx.scale(F.s, F.s);

        for (i = 0; i < flowers.length; i++) {
          var f = flowers[i];
          var sway = Math.sin(t * 0.7 + f.ph) * 0.9 + wind * (1.3 - f.y / 112) * 5;
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

        // falling petals
        if (!A.reduced && Math.random() < dt * 0.7) {
          f = flowers[(Math.random() * flowers.length) | 0];
          spawnPetal(f.hx, f.hy, f.pal);
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
    var st = { blood: false, img: null };
    var cr = [], stars = [];
    var r = rng(11);
    for (var i = 0; i < 30; i++) {
      var lon = r() * TAU, lat = (r() - 0.5) * 2.4, mare = i < 7;
      cr.push({
        x: Math.cos(lat) * Math.sin(lon), y: Math.sin(lat), z: Math.cos(lat) * Math.cos(lon),
        rad: mare ? 0.32 + r() * 0.3 : 0.05 + r() * r() * 0.24,
        depth: mare ? 0.3 + r() * 0.14 : 0.4 + r() * 0.4,
        mare: mare
      });
    }
    for (i = 0; i < 46; i++) stars.push({ x: r(), y: r(), p: r() * TAU, b: 0.25 + r() * 0.5 });
    return {
      state: st,
      click: function (x, y, v) { st.blood = !st.blood; v.kick(0.4); },
      resize: function (v) { st.img = v.sctx.createImageData(v.cols, v.rows); },
      draw: function (ctx, v, t) {
        var img = st.img, d = img.data, cols = v.cols, rows = v.rows, asp = v.aspect;
        var cx = v.W / 2, cy = v.H / 2, R = Math.min(v.W, v.H) * 0.4;
        var rot = t * 0.05, ph = Math.sin(t * 0.045 + 0.6) * 1.35;
        var Lx = Math.sin(ph), Ly = -0.18, Lz = Math.cos(ph);
        var ln = Math.sqrt(Lx * Lx + Ly * Ly + Lz * Lz); Lx /= ln; Ly /= ln; Lz /= ln;
        var cR = Math.cos(rot), sR = Math.sin(rot);
        var tint = st.blood ? [255, 46, 36] : [242, 236, 224];
        var c, o, val;
        for (var y = 0; y < rows; y++) {
          var dy = ((y + 0.5) * asp - cy) / R;
          for (var x = 0; x < cols; x++) {
            var dx = (x + 0.5 - cx) / R, d2 = dx * dx + dy * dy;
            if (d2 < 1) {
              var nz = Math.sqrt(1 - d2);
              var lam = dx * Lx + dy * Ly + nz * Lz; if (lam < 0) lam = 0;
              var px = dx * cR - nz * sR, pz = dx * sR + nz * cR, py = dy;
              var alb = 0.8;
              for (var i = 0; i < cr.length; i++) {
                c = cr[i];
                var cd = px * c.x + py * c.y + pz * c.z;
                if (cd > Math.cos(c.rad * 1.35)) {
                  var q = Math.acos(cd > 1 ? 1 : cd) / c.rad;
                  if (c.mare) alb -= c.depth * Math.exp(-q * q * 2);
                  else {
                    if (q < 1) alb -= c.depth * (1 - q * q) * 0.7;
                    alb += 0.2 * Math.exp(-((q - 1) * (q - 1)) / 0.02);
                  }
                }
              }
              val = alb * (0.09 + 0.91 * Math.pow(lam, 0.75)) * (0.82 + 0.18 * nz);
            } else {
              val = 0.13 * Math.exp(-(Math.sqrt(d2) - 1) * 6);
            }
            o = (y * cols + x) * 4;
            d[o] = val * tint[0]; d[o + 1] = val * tint[1]; d[o + 2] = val * tint[2]; d[o + 3] = 255;
          }
        }
        for (i = 0; i < stars.length; i++) {
          var s = stars[i], sx = (s.x * cols) | 0, sy = (s.y * rows) | 0;
          var ddx = (sx + 0.5 - cx) / R, ddy = ((sy + 0.5) * asp - cy) / R;
          if (ddx * ddx + ddy * ddy < 1.3) continue;
          val = s.b * (0.5 + 0.5 * Math.sin(t * 1.8 + s.p));
          o = (sy * cols + sx) * 4;
          d[o] = d[o + 1] = d[o + 2] = val * 255;
        }
        ctx.putImageData(img, 0, 0);
      }
    };
  }

  /* ====================================================================
   * TWO GIRLS - original characters drawn as ascii line art.
   * Fills are dim (they become light texture); contours are inked straight
   * into character cells, and every shape hides the lines behind it.
   * ==================================================================== */
  function Path() { this.subs = []; this.cur = null; this.x = 0; this.y = 0; }
  Path.prototype.M = function (x, y) { this.cur = [x, y]; this.subs.push(this.cur); this.x = x; this.y = y; return this; };
  Path.prototype.L = function (x, y) { this.cur.push(x, y); this.x = x; this.y = y; return this; };
  Path.prototype.Q = function (cx, cy, x, y) {
    var x0 = this.x, y0 = this.y;
    var n = clamp(Math.ceil((Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy)) / 1.1), 2, 40);
    for (var i = 1; i <= n; i++) {
      var t = i / n, u = 1 - t;
      this.cur.push(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y);
    }
    this.x = x; this.y = y; return this;
  };
  Path.prototype.C = function (ax, ay, bx, by, x, y) {
    var x0 = this.x, y0 = this.y;
    var n = clamp(Math.ceil((Math.hypot(ax - x0, ay - y0) + Math.hypot(bx - ax, by - ay) + Math.hypot(x - bx, y - by)) / 1.1), 2, 60);
    for (var i = 1; i <= n; i++) {
      var t = i / n, u = 1 - t;
      this.cur.push(u * u * u * x0 + 3 * u * u * t * ax + 3 * u * t * t * bx + t * t * t * x,
        u * u * u * y0 + 3 * u * u * t * ay + 3 * u * t * t * by + t * t * t * y);
    }
    this.x = x; this.y = y; return this;
  };
  // a gently waving line from the current point to (x1, y1)
  Path.prototype.W = function (x1, y1, amp, waves, phase) {
    var x0 = this.x, y0 = this.y, n = 36;
    var dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
    for (var i = 1; i <= n; i++) {
      var t = i / n, o = Math.sin(t * TAU * waves + (phase || 0)) * amp * Math.sin(t * Math.PI);
      this.cur.push(x0 + dx * t + nx * o, y0 + dy * t + ny * o);
    }
    this.x = x1; this.y = y1; return this;
  };
  Path.prototype.Z = function () { this.cur.push(this.cur[0], this.cur[1]); return this; };
  Path.prototype.trace = function (ctx) {
    ctx.beginPath();
    for (var s = 0; s < this.subs.length; s++) {
      var p = this.subs[s];
      ctx.moveTo(p[0], p[1]);
      for (var i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
    }
    return this;
  };
  Path.prototype.fill = function (ctx, style) { this.trace(ctx); ctx.fillStyle = style; ctx.fill(); return this; };
  Path.prototype.cover = function (v, ctx, style) { this.fill(ctx, style); v.mask(ctx, this.subs); return this; };
  Path.prototype.ink = function (v, ctx, color, ch) {
    for (var s = 0; s < this.subs.length; s++) v.ink(ctx, this.subs[s], color, ch);
    return this;
  };
  function P() { return new Path(); }
  function oval(cx, cy, rx, ry, rot, a0, a1) {
    var p = P(), n = 40, c = Math.cos(rot || 0), s = Math.sin(rot || 0);
    a0 = a0 || 0; a1 = a1 === undefined ? TAU : a1;
    for (var i = 0; i <= n; i++) {
      var a = a0 + (a1 - a0) * i / n, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
      if (i) p.L(cx + x * c - y * s, cy + x * s + y * c); else p.M(cx + x * c - y * s, cy + x * s + y * c);
    }
    return p;
  }
  // x mirrored around the middle of the 100-unit design space
  function mir(f) { return f ? function (x) { return 100 - x; } : function (x) { return x; }; }
  function crop(v, x0, y0, w, h) {
    var F = fit(v, w, h, 1, 0.5, 0.5);
    return { s: F.s, x: F.x - x0 * F.s, y: F.y - y0 * F.s };
  }
  function blinker(st, t, dt, lo, hi) {
    if (st.blinkT < 0 && t > st.next) st.blinkT = 0;
    if (st.blinkT >= 0) {
      st.blinkT += dt;
      var p = st.blinkT / 0.22;
      st.blink = p < 0.4 ? p / 0.4 : p < 0.55 ? 1 : Math.max(0, 1 - (p - 0.55) / 0.45);
      if (p >= 1) { st.blinkT = -1; st.blink = 0; st.next = t + rand(lo, hi); }
    }
  }

  function hexField(ctx, v, t, ripples, color) {
    var R = 4.4, w = Math.sqrt(3) * R, h = 1.5 * R;
    ctx.lineWidth = 0.4;
    for (var row = -1; row * h < v.H + R; row++) {
      for (var col = -1; col * w < v.W + w; col++) {
        var x = col * w + (row % 2 ? w / 2 : 0), y = row * h, a = 0;
        for (var i = 0; i < ripples.length; i++) {
          var rp = ripples[i], age = t - rp.t, rad = age * 55;
          var d = Math.sqrt((x - rp.x) * (x - rp.x) + (y - rp.y) * (y - rp.y));
          a += Math.exp(-((d - rad) * (d - rad)) / 30) * Math.max(0, 1 - age / 1.5);
        }
        if (a < 0.02) continue;
        ctx.strokeStyle = 'rgba(' + color + ',' + Math.min(1, a) + ')';
        ctx.beginPath();
        for (var k = 0; k < 6; k++) {
          var an = Math.PI / 6 + k * Math.PI / 3;
          var px = x + Math.cos(an) * R * 0.9, py = y + Math.sin(an) * R * 0.9;
          if (k) ctx.lineTo(px, py); else ctx.moveTo(px, py);
        }
        ctx.closePath(); ctx.stroke();
      }
    }
  }

  /* ---------- the doll: a silhouette in profile, looking up at the moon ---------- */
  var DOLL = {
    moonHi: '#f2eefb', moonLo: '#7e7a96', crater: 'rgba(60,56,84,0.35)',
    rim: '#ffffff', rimSoft: '#cfc6f2', line: '#6d6890', bow: '#e8607a'
  };
  function dollProfile(p) {
    return p.C(40.8, 24, 37.6, 28.5, 37, 33.5).C(36.6, 37, 36.8, 40, 37.6, 42).Q(37.8, 43.4, 36.9, 44.8)
      .C(35.8, 47, 34.6, 49.4, 33.8, 51.2).Q(33.4, 52.3, 34.4, 52.7).Q(35.4, 53.1, 36, 53.8)
      .Q(36.2, 55, 35.8, 56).Q(35.3, 56.7, 35.9, 57.3).Q(36.4, 57.7, 36.1, 58.1).Q(35.7, 58.7, 36.2, 59.5)
      .Q(37, 60.2, 36.9, 61.2).C(36.7, 62.8, 37.2, 65, 39, 66.2).C(43, 68, 50, 65.5, 56, 61);
  }
  // drawn facing left in design space; the caller mirrors it so she faces the moon
  function dollFigure(v, ctx, st, t) {
    var c = DOLL, sw = Math.sin(t * 0.8) * 0.5, black = '#000000';

    // long hair falling behind her back
    var hair = P().M(42, 23).C(44, 13, 56, 9, 66, 11).C(78, 14, 84.5, 26, 84.5, 40)
      .C(84.5, 56, 88, 74, 93 + sw, 92).W(99 + sw, 126, 1.6, 2, t * 0.7)
      .L(70 + sw, 126).W(63, 74, 1.4, 2, -t * 0.7).L(58, 46).L(48, 32).Z();
    hair.cover(v, ctx, black);
    hair.ink(v, ctx, c.line);
    P().M(78, 30).C(80, 50, 83, 70, 86 + sw, 92).W(90 + sw, 124, 1.2, 2, t * 0.7 + 1).ink(v, ctx, c.line);

    // dress with a high frilled collar
    var dress = P().M(10, 126).C(17, 104, 30, 93, 43.2, 88).Q(51, 87, 60, 85).C(71, 87, 85, 95, 94, 126).Z();
    dress.cover(v, ctx, black); dress.ink(v, ctx, c.line);
    var neck = P().M(41.5, 64.5).C(42.5, 70, 43, 76, 43.6, 82).L(58.6, 80).C(58.4, 72, 58.2, 66, 57.6, 58).Z();
    neck.cover(v, ctx, black);
    P().M(41.8, 66).C(42.6, 71, 43, 75, 43.4, 79).ink(v, ctx, c.rimSoft);
    var collar = P().M(42.6, 78.5).Q(50.5, 77, 58.8, 76).L(59.8, 85.5).Q(51, 87.4, 43.4, 88).Z();
    collar.cover(v, ctx, black);
    P().M(42.4, 78.2).Q(50.5, 76.7, 58.8, 75.7).ink(v, ctx, c.rimSoft, '~');
    P().M(43.4, 88).Q(51, 87.4, 59.8, 85.5).ink(v, ctx, c.line, '~');

    // head
    var head = dollProfile(P().M(44.6, 22)).L(61, 54).L(67, 30).L(57, 19).Z();
    head.cover(v, ctx, black);
    dollProfile(P().M(44.6, 22)).ink(v, ctx, c.rim);

    // eye: long lashes, a glint, looking up
    var open = 1 - st.blink, lid = lerp(45.8, 43.6, open);
    P().M(43, 44.6).Q(41, lid - 0.9, 38.9, 44.6).L(37.2, 43.2).ink(v, ctx, c.rim);
    P().M(39.8, 44.2).L(38.6, 42.4).ink(v, ctx, c.rim);
    if (open > 0.3) {
      P().M(40.2, 45.6).ink(v, ctx, c.rimSoft, '.');
      P().M(42.4, 47.2).Q(40.8, 47.4, 39.4, 46.6).ink(v, ctx, c.line);
    }

    // fringe and a lock in front of the ear
    var fringe = P().M(57, 16).C(48, 15, 40.5, 19, 37, 27).Q(35.6, 31, 35.8, 35.5).L(38.6, 32)
      .Q(38.8, 36, 40, 39.5).L(41.8, 33.5).Q(43.2, 37, 45.4, 39).L(46, 31).L(57, 30).Z();
    fringe.cover(v, ctx, black);
    P().M(57, 16).C(48, 15, 40.5, 19, 37, 27).Q(35.6, 31, 35.8, 35.5).ink(v, ctx, c.rimSoft);
    var lock = P().M(50, 30).C(53, 44, 52 + sw, 60, 50.5 + sw, 76).L(53.6 + sw, 71).C(55.6, 56, 56.6, 42, 56, 32).Z();
    lock.cover(v, ctx, black); lock.ink(v, ctx, c.line);
    P().M(42, 23).C(44, 13, 56, 9, 66, 11).C(76, 13.5, 82, 21, 84, 32).ink(v, ctx, c.rimSoft);

    // a ribbon bow at the back of her head
    ctx.save(); ctx.translate(76, 21); ctx.rotate(0.35 + Math.sin(t * 0.9) * 0.04);
    var l1 = oval(-4.2, -1.6, 5, 3, -0.5).Z(), l2 = oval(4.4, -1.2, 5, 3, 0.45).Z();
    l1.cover(v, ctx, black); l2.cover(v, ctx, black);
    l1.ink(v, ctx, c.bow); l2.ink(v, ctx, c.bow);
    P().M(-0.6, 1).Q(-2 + sw, 8, -1 + sw * 1.5, 15).ink(v, ctx, c.bow);
    P().M(0.8, 1).Q(3 + sw, 7, 3.6 + sw * 1.5, 13).ink(v, ctx, c.bow);
    P().M(0, 0).ink(v, ctx, c.bow, 'o');
    ctx.restore();
  }

  function Doll() {
    var st = { blink: 0, blinkT: -1, next: 2.4, ripples: [], nextField: 7 };
    var stars = [], craters = [], r = rng(41), i;
    for (i = 0; i < 50; i++) stars.push({ x: r(), y: r(), p: r() * TAU });
    for (i = 0; i < 16; i++) craters.push({ a: r() * TAU, d: Math.sqrt(r()) * 0.82, s: 0.04 + r() * r() * 0.16 });
    return {
      state: st,
      click: function (x, y, v) { st.ripples.push({ x: x, y: y, t: v.t }); v.kick(0.2); },
      draw: function (ctx, v, t, dt) {
        var W = v.W, H = v.H, F = crop(v, 2, 0, 94, 112);
        for (i = 0; i < stars.length; i++) {
          var s = stars[i];
          ctx.fillStyle = 'rgba(220,214,255,' + (0.18 + 0.18 * Math.sin(t * 1.4 + s.p)) + ')';
          circle(ctx, s.x * W, s.y * H, 0.4);
        }
        ctx.save();
        ctx.translate(F.x, F.y); ctx.scale(F.s, F.s);

        // the moon
        var mx = 45, my = 41, mr = 37;
        var glow = ctx.createRadialGradient(mx, my, mr * 0.9, mx, my, mr * 1.5);
        glow.addColorStop(0, 'rgba(190,180,240,0.22)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = glow; ctx.fillRect(mx - mr * 1.6, my - mr * 1.6, mr * 3.2, mr * 3.2);
        var mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.35, mr * 0.1, mx, my, mr);
        mg.addColorStop(0, c0(DOLL.moonHi)); mg.addColorStop(0.75, '#c4bfda'); mg.addColorStop(1, DOLL.moonLo);
        ctx.fillStyle = mg; circle(ctx, mx, my, mr);
        ctx.fillStyle = DOLL.crater;
        for (i = 0; i < craters.length; i++) {
          var k = craters[i];
          circle(ctx, mx + Math.cos(k.a + t * 0.01) * k.d * mr, my + Math.sin(k.a + t * 0.01) * k.d * mr, k.s * mr);
        }
        ctx.restore();

        if (t > st.nextField && !A.reduced) {
          st.ripples.push({ x: F.x + 45 * F.s, y: F.y + 41 * F.s, t: t });
          st.nextField = t + rand(10, 16);
        }
        st.ripples = st.ripples.filter(function (q) { return t - q.t < 1.6; });
        if (st.ripples.length) hexField(ctx, v, t, st.ripples, '200,186,255');

        blinker(st, t, dt, 2.5, 6.5);
        ctx.save();
        ctx.translate(F.x, F.y + Math.sin(t * 1.1) * 0.3 * F.s); ctx.scale(F.s, F.s);
        // mirror so she faces right, toward the moon, and tilt her face up
        ctx.translate(96, 0); ctx.scale(-1, 1);
        ctx.translate(52, 72); ctx.rotate(0.18 + Math.sin(t * 0.4) * 0.015); ctx.translate(-52, -72);
        ctx.translate(-6, 8);
        dollFigure(v, ctx, st, t);
        ctx.restore();
      }
    };
  }
  function c0(x) { return x; }

  /* ---------- the listener: side profile, headphones, a cable ---------- */
  var WIRED = {
    skin: '#3c3c3c', hair: '#171717', hood: '#262626', phones: '#0c0c0c', white: '#5c5c5c',
    ink: '#ffffff', line: '#9a9a9a', dim: '#4a4a4a'
  };
  function profile(p) {
    return p.C(40.5, 24.5, 37.5, 29, 36.8, 34).C(36.4, 37.5, 36.6, 40, 37.4, 41.8).Q(37.6, 43.2, 36.6, 44.6)
      .C(35.2, 47, 33.4, 50, 32.2, 52.2).Q(31.6, 53.4, 32.6, 53.9).Q(34, 54.4, 35, 55).Q(35.4, 56.4, 34.9, 57.6)
      .Q(34.2, 58.4, 34.9, 59.1).Q(35.6, 59.5, 35.2, 60).Q(34.6, 60.7, 35.3, 61.6).Q(36.4, 62.4, 36.2, 63.6)
      .C(35.8, 65.2, 36.2, 67.6, 38, 68.8).C(42, 70.6, 50, 67.5, 56, 62);
  }
  function wiredFigure(v, ctx, st, t) {
    var c = WIRED, sw = Math.sin(t * 0.9) * 0.35, i;

    // hoodie
    var hood = P().M(16, 124).C(21, 104, 32, 92, 44, 87.5).Q(52, 86, 59.5, 80).C(65, 71, 78, 69.5, 85, 79)
      .C(91, 89, 94, 104, 96, 124).Z();
    hood.cover(v, ctx, c.hood); hood.ink(v, ctx, c.ink);
    P().M(59.5, 80).Q(70, 75.5, 81, 83).ink(v, ctx, c.line);
    P().M(65, 83).C(70, 93, 72, 105, 70, 124).ink(v, ctx, c.dim);
    P().M(35, 95).C(39, 105, 39.5, 114, 38, 124).ink(v, ctx, c.dim);
    P().M(46.5, 89).Q(45.8 + sw * 0.3, 97, 46 + sw * 0.6, 105).ink(v, ctx, c.line);
    P().M(46 + sw * 0.6, 106).ink(v, ctx, c.ink, 'o');
    P().M(50.5, 88).Q(50.8 + sw * 0.3, 95, 51.4 + sw * 0.6, 101.5).ink(v, ctx, c.line);
    P().M(51.4 + sw * 0.6, 102.5).ink(v, ctx, c.ink, 'o');

    // neck
    var neck = P().M(41, 67.5).C(42.6, 74, 43.4, 80, 44.2, 88.5).Q(52, 87, 59.8, 80.5).C(60.2, 72, 60, 64, 59.5, 57).Z();
    neck.cover(v, ctx, c.skin);
    var ng = ctx.createLinearGradient(0, 66, 0, 78);
    ng.addColorStop(0, 'rgba(0,0,0,0.6)'); ng.addColorStop(1, 'rgba(0,0,0,0)');
    neck.fill(ctx, ng);
    P().M(41.6, 69.4).C(42.8, 75, 43.4, 81, 44.2, 88).ink(v, ctx, c.ink);

    // hair at the back of the head
    var hb = P().M(41, 24).C(43.5, 15, 54, 11, 63.5, 12.5).C(75, 14.5, 82, 24, 82.5, 36)
      .C(83, 47, 80.5 + sw, 56, 77 + sw, 63.5).L(74.6 + sw, 59).L(72.8 + sw, 65).L(69.6 + sw, 59.5)
      .L(66.8 + sw, 65.5).L(63.4, 58).L(58, 46).L(48, 33).Z();
    hb.cover(v, ctx, c.hair);
    for (i = 0; i < 4; i++) {
      P().M(56 + i * 5, 14 + i * 0.8).C(66 + i * 3, 22, 73 + i * 1.6, 38, 71 + i * 2.2 + sw, 58 + i).ink(v, ctx, c.line);
    }
    hb.ink(v, ctx, c.ink);

    // face
    var face = profile(P().M(44, 22)).L(61, 56).L(66, 30).L(56, 20).Z();
    face.cover(v, ctx, c.skin);
    oval(41.5, 54.5, 3.6, 1.6).Z().fill(ctx, '#484848');
    profile(P().M(44, 22)).ink(v, ctx, c.ink);

    // eye (half-lidded), brow, mouth
    var open = 1 - st.blink, lid = lerp(47.6, 44.6 - st.wide * 0.8, open);
    if (open > 0.25) {
      var white = P().M(42.4, 45.6).Q(40.6, lid - 0.8, 38.6, 45.9).Q(40.2, 48.6, 41.8, 48.4).Z();
      white.cover(v, ctx, c.white);
      ctx.save(); white.trace(ctx); ctx.clip();
      ctx.fillStyle = '#d0d0d0'; ctx.beginPath(); ctx.ellipse(40 + st.glance, 47.1, 1.5, 2.2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(39.8 + st.glance, 47.3, 0.7, 1.1, 0, 0, TAU); ctx.fill();
      ctx.restore();
    }
    P().M(42.6, 45.3).Q(40.6, lid - 1.1, 38.4, 45.7).L(37, 44.4).ink(v, ctx, c.ink);
    P().M(42.8, 41).Q(40.6, 40.2, 38.4, 41.2).ink(v, ctx, c.line);
    P().M(35.2, 60.1).L(37, 60.3).ink(v, ctx, c.line);

    // fringe and the tuft in front of the ear
    var bangs = P().M(57, 17).C(48, 16, 40, 19.5, 36.4, 27.5).Q(34.6, 32.5, 35, 37.6).L(37.8, 33.8)
      .Q(37.4 + sw * 0.4, 38.6, 38.6 + sw * 0.5, 42.6).L(40.6, 36).Q(41.6, 40.4, 43.6 + sw * 0.4, 43.4)
      .L(44.6, 35.4).Q(47.4, 38.6, 50.4, 40.6).L(49.6, 32.4).L(57, 31).Z();
    bangs.cover(v, ctx, c.hair);
    P().M(53, 19).Q(43, 24, 38.6 + sw * 0.5, 42).ink(v, ctx, c.line);
    P().M(55, 21).Q(47, 27, 43.6 + sw * 0.4, 43).ink(v, ctx, c.line);
    bangs.ink(v, ctx, c.ink);
    var tuft = P().M(52.5, 34).Q(55.2, 46, 54.2 + sw, 58.5).L(56.4, 54).Q(57.6, 45, 57.8, 36).Z();
    tuft.cover(v, ctx, c.hair); tuft.ink(v, ctx, c.ink);

    // headphones
    var band = P().M(58.6, 38.5).C(56.8, 28, 57, 19, 59.4, 11.2).L(62.8, 11.6).C(60.8, 19, 60.8, 28, 62.4, 38).Z();
    band.cover(v, ctx, c.phones); band.ink(v, ctx, c.ink);
    var cup = oval(62.4, 47.2, 7.4, 9.8, 0.14).Z();
    cup.cover(v, ctx, c.phones); cup.ink(v, ctx, c.ink);
    oval(62.6, 47.2, 4.6, 6.6, 0.14).ink(v, ctx, c.line);
    if (!st.playing || Math.sin(t * 6) > 0) P().M(66.2, 41.5).ink(v, ctx, c.ink, '*');

    // the cable
    var cs = Math.sin(t * 0.7) * 1.5;
    P().M(61.4, 56.8).C(59.8 + cs * 0.3, 66, 67 + cs, 74, 64.5 + cs, 88).C(62 + cs, 100, 71 + cs * 0.6, 110, 67, 126)
      .ink(v, ctx, c.ink);
  }

  function Wired() {
    var st = { blink: 0, blinkT: -1, next: 3, glance: 0, glanceT: 0, nextGlance: 4, wide: 0, playing: false };
    var cables = [], packets = [], r = rng(31);
    for (var i = 0; i < 4; i++) cables.push({ x: 4 + i * 5 + r() * 3, b: (r() - 0.5) * 8, p: r() * TAU });
    for (i = 0; i < 26; i++) packets.push({ y: r(), x: r(), s: 4 + r() * 10 });
    return {
      state: st,
      click: function (x, y, v) { st.wide = 1; v.kick(0.7); },
      draw: function (ctx, v, t, dt) {
        var W = v.W, H = v.H, F = crop(v, 10, 3, 86, 115);
        for (var i = 0; i < packets.length; i++) {
          var k = packets[i], x = ((k.x * W + t * k.s) % (W + 6)) - 3;
          P().M(x, k.y * H).L(x + 1.5, k.y * H).ink(v, ctx, '#3a3a3a', '-');
        }
        ctx.save();
        ctx.translate(F.x, F.y); ctx.scale(F.s, F.s);
        for (i = 0; i < cables.length; i++) {
          var c = cables[i], wob = Math.sin(t * 0.5 + c.p) * 1.2;
          P().M(c.x, -4).C(c.x + c.b, 30, c.x - c.b + wob, 70, c.x + wob * 0.5, 126).ink(v, ctx, WIRED.dim);
        }
        ctx.restore();

        blinker(st, t, dt, 3.5, 8);
        st.wide = Math.max(0, st.wide - dt * 0.8);
        if (t > st.nextGlance) { st.glanceT = t + rand(1, 2.5); st.nextGlance = t + rand(5, 10); }
        st.glance = lerp(st.glance, t < st.glanceT ? -0.7 : 0, ease(6, dt));

        ctx.save();
        ctx.translate(F.x, F.y + Math.sin(t * 1.0) * 0.3 * F.s);
        ctx.scale(F.s, F.s);
        var nod = st.playing ? Math.sin(t * TAU * 0.8) * 0.018 : Math.sin(t * 0.3) * 0.006;
        ctx.translate(56, 88); ctx.rotate(nod); ctx.translate(-56, -88);
        wiredFigure(v, ctx, st, t);
        ctx.restore();
        if (!A.reduced && Math.random() < dt * 0.15) v.kick(rand(0.2, 0.5));
      }
    };
  }

  /* ====================================================================
   * WIRES - power lines under a white sky
   * ==================================================================== */
  function Wires() {
    var st = { girl: 0, nextGirl: 5, girlUntil: 0, hum: false };
    var r = rng(21), bld = [], dots = [];
    for (var i = 0; i < 30; i++) bld.push({ w: 0.025 + r() * 0.06, h: 0.04 + r() * 0.15, roof: r() });
    for (i = 0; i < 90; i++) dots.push({ u: r(), v: r(), s: 0.3 + r() * 0.65, p: r() * TAU });
    return {
      state: st,
      click: function (x, y, v) { v.kick(0.9); st.girlUntil = v.t + 4; },
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

        // a girl stands on the road, sometimes
        if (t > st.nextGirl && t > st.girlUntil + 1) { st.girlUntil = t + rand(3, 6); st.nextGirl = t + rand(10, 22); }
        var target = t < st.girlUntil ? 1 : 0;
        st.girl = lerp(st.girl, target, 0.08);
        if (st.girl > 0.02) {
          var gx = W * 0.47, gb = H * 0.97, gh = H * 0.24;
          ctx.globalAlpha = st.girl;
          ctx.fillStyle = '#000';
          ctx.beginPath(); ctx.ellipse(gx, gb - gh * 0.87, gh * 0.085, gh * 0.1, 0, 0, TAU); ctx.fill();
          ctx.beginPath(); ctx.moveTo(gx - gh * 0.1, gb - gh * 0.86); ctx.lineTo(gx - gh * 0.11, gb - gh * 0.75); ctx.lineTo(gx + gh * 0.11, gb - gh * 0.75); ctx.lineTo(gx + gh * 0.1, gb - gh * 0.86); ctx.fill();
          ctx.beginPath(); ctx.moveTo(gx - gh * 0.1, gb - gh * 0.74); ctx.lineTo(gx - gh * 0.16, gb - gh * 0.36); ctx.lineTo(gx + gh * 0.16, gb - gh * 0.36); ctx.lineTo(gx + gh * 0.1, gb - gh * 0.74); ctx.fill();
          ctx.fillRect(gx - gh * 0.07, gb - gh * 0.37, gh * 0.04, gh * 0.37);
          ctx.fillRect(gx + gh * 0.03, gb - gh * 0.37, gh * 0.04, gh * 0.37);
          ctx.globalAlpha = 1;
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
        if (t > st.next && !A.reduced) {
          st.next = t + rand(0.7, 2.4);
          var win = st.win[(Math.random() * st.win.length) | 0];
          var target = 0.2 + 0.08 * Math.sin(t * 0.05);
          win.s = win.s ? 0 : (lit / st.win.length < target ? (Math.random() < 0.2 ? 2 : 1) : 0);
        }
      }
    };
  }

  global.SCENES = { Eye: Eye, Bloom: Bloom, Moon: Moon, Doll: Doll, Wired: Wired, Wires: Wires, Snow: Snow };
})(window);
