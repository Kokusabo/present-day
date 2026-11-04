/* main.js - everything around the canvases: boot screen, clock, sound,
 * the terminal, the media player, little eyes, glitches. */
(function () {
  'use strict';

  var A = window.ASCII, S = window.SCENES;
  var reduced = A.reduced, rand = A.rand, clamp = A.clamp;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function pad(n, w) { n = String(n); while (n.length < w) n = '0' + n; return n; }
  function repeat(s, n) { var o = ''; for (var i = 0; i < n; i++) o += s; return o; }
  function stamp() { var d = new Date(); return pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2); }
  function daysSince(y, m, d) { return Math.floor((Date.now() - Date.UTC(y, m - 1, d)) / 864e5); }
  function onView(el, cb, threshold) {
    if (!el) return;
    new IntersectionObserver(function (es) { es.forEach(function (e) { cb(e.isIntersecting, e); }); },
      { threshold: threshold || 0 }).observe(el);
  }

  var scenes = {};
  var views = {};

  /* ---------- boot ---------- */
  var BOOT = [
    ['WIRED BIOS (tm) v0.13', ''],
    ['copyleft (c) 1998 ∅ research', ''],
    ['', ''],
    ['NAVI-II cpu @ 33.3 MHz', 'ok'],
    ['memory test 65536K', 'ok'],
    ['detecting eyes', '2 found'],
    ['detecting flowers', 'blooming'],
    ['mounting /dev/moon', 'one side only'],
    ['mounting /dev/wired', 'everywhere'],
    ['checking heartbeat', 'faint'],
    ['loading layer:01', 'weird'],
    ['', ''],
    ['press any key to connect_', '']
  ];
  function boot() {
    var el = $('#boot'), log = $('#boot-log');
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      el.classList.add('off');
      setTimeout(function () { el.classList.add('gone'); }, 600);
      window.removeEventListener('keydown', finish);
    }
    if (reduced) { el.classList.add('gone'); return; }
    var probe = document.createElement('span');
    probe.textContent = 'MMMMMMMMMM';
    log.appendChild(probe);
    var cw = probe.getBoundingClientRect().width / 10 || 9;
    log.removeChild(probe);
    var width = clamp(Math.floor(log.clientWidth / cw) - 1, 26, 60);
    var lines = BOOT.map(function (l) {
      if (!l[1]) return l[0];
      return l[0] + ' ' + repeat('.', Math.max(3, width - l[0].length - l[1].length - 2)) + ' ' + l[1];
    });
    var i = 0;
    (function next() {
      if (done) return;
      if (i >= lines.length) { setTimeout(finish, 650); return; }
      log.textContent += lines[i++] + '\n';
      setTimeout(next, i < 3 ? 80 : rand(70, 180));
    })();
    window.addEventListener('keydown', finish);
    el.addEventListener('pointerdown', finish);
  }

  /* ---------- clock ---------- */
  function clock() {
    var el = $('#clock');
    function tick() { el.textContent = stamp(); }
    tick();
    setInterval(tick, 1000);
    $('#year').textContent = new Date().getFullYear();
  }

  /* ---------- sound: a power-line hum and a small generative player ---------- */
  var Sound = (function () {
    var ac = null, master = null, analyser = null, hum = null, player = null, noiseBuf = null, bins = null;
    function ctx() {
      if (!ac) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ac = new AC();
        master = ac.createGain();
        master.gain.value = 0.9;
        var comp = ac.createDynamicsCompressor();
        analyser = ac.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.82;
        bins = new Uint8Array(analyser.frequencyBinCount);
        master.connect(comp); comp.connect(analyser); analyser.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    }
    function noise() {
      if (noiseBuf) return noiseBuf;
      var len = ac.sampleRate * 2;
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      var d = noiseBuf.getChannelData(0);
      for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return noiseBuf;
    }
    function release(set, ms) {
      var now = ac.currentTime;
      set.out.gain.cancelScheduledValues(now);
      set.out.gain.setTargetAtTime(0, now, 0.25);
      setTimeout(function () {
        set.nodes.forEach(function (n) { try { n.stop(); } catch (e) { /* already stopped */ } });
        set.out.disconnect();
      }, ms || 1500);
    }
    function humStart() {
      var a = ctx();
      if (!a || hum) return !!a;
      var out = a.createGain();
      out.gain.value = 0;
      out.connect(master);
      var nodes = [];
      [[50, 0.5], [100, 0.32], [150, 0.18], [200, 0.07], [250, 0.06]].forEach(function (h) {
        var o = a.createOscillator(), g = a.createGain();
        o.frequency.value = h[0]; g.gain.value = h[1];
        o.connect(g); g.connect(out); o.start(); nodes.push(o);
      });
      var saw = a.createOscillator(), bp = a.createBiquadFilter(), sg = a.createGain();
      saw.type = 'sawtooth'; saw.frequency.value = 50;
      bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.9; sg.gain.value = 0.05;
      saw.connect(bp); bp.connect(sg); sg.connect(out); saw.start(); nodes.push(saw);
      var ns = a.createBufferSource(), hp = a.createBiquadFilter(), ng = a.createGain();
      ns.buffer = noise(); ns.loop = true;
      hp.type = 'highpass'; hp.frequency.value = 4000; ng.gain.value = 0.025;
      ns.connect(hp); hp.connect(ng); ng.connect(out); ns.start(); nodes.push(ns);
      var lfo = a.createOscillator(), lg = a.createGain();
      lfo.frequency.value = 0.13; lg.gain.value = 0.025;
      lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.push(lfo);
      out.gain.setValueAtTime(0, a.currentTime);
      out.gain.linearRampToValueAtTime(0.09, a.currentTime + 1.2);
      hum = { out: out, nodes: nodes };
      return true;
    }
    function humStop() { if (hum) { release(hum, 1500); hum = null; } }

    var TRACKS = [
      { name: 'present_day.wav', root: 45, scale: [0, 3, 5, 7, 10, 12, 15], wave: 'triangle', step: 1.9, cut: 900, len: 222 },
      { name: 'higanbana (reprise)', root: 50, scale: [0, 2, 3, 7, 8, 12, 14], wave: 'sine', step: 1.4, cut: 1500, len: 187 },
      { name: 'pattern blue', root: 43, scale: [0, 3, 7, 10, 14, 15, 19], wave: 'sawtooth', step: 2.6, cut: 520, len: 301 },
      { name: '9 floors, 4 lights', root: 48, scale: [0, 2, 5, 7, 9, 12, 14], wave: 'triangle', step: 1.1, cut: 1100, len: 164 },
      { name: 'heaven (or nothing)', root: 52, scale: [0, 4, 7, 11, 14, 16, 19], wave: 'sine', step: 2.3, cut: 2200, len: 259 }
    ];
    function mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }
    function play(tr) {
      var a = ctx();
      if (!a) return false;
      stop();
      var out = a.createGain();
      out.gain.value = 0;
      out.connect(master);
      var lp = a.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = tr.cut; lp.Q.value = 2;
      var lfo = a.createOscillator(), lfg = a.createGain();
      lfo.frequency.value = 0.07; lfg.gain.value = tr.cut * 0.5;
      lfo.connect(lfg); lfg.connect(lp.frequency); lfo.start();
      var dl = a.createDelay(2), fb = a.createGain(), wet = a.createGain();
      dl.delayTime.value = 0.62; fb.gain.value = 0.42; wet.gain.value = 0.5;
      lp.connect(out); lp.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(out);
      var nodes = [lfo];
      [0, 7, -12].forEach(function (iv, i) {
        var o = a.createOscillator(), g = a.createGain();
        o.type = i === 2 ? 'sine' : tr.wave;
        o.frequency.value = mtof(tr.root + iv);
        o.detune.value = (i - 1) * 6;
        g.gain.value = i === 2 ? 0.16 : 0.045;
        o.connect(g); g.connect(lp); o.start(); nodes.push(o);
      });
      var ns = a.createBufferSource(), nf = a.createBiquadFilter(), ng = a.createGain();
      ns.buffer = noise(); ns.loop = true;
      nf.type = 'bandpass'; nf.frequency.value = 6000; ng.gain.value = 0.012;
      ns.connect(nf); nf.connect(ng); ng.connect(out); ns.start(); nodes.push(ns);
      out.gain.linearRampToValueAtTime(0.5, a.currentTime + 2);
      var p = { out: out, nodes: nodes, timer: 0 };
      player = p;
      (function note() {
        if (player !== p) return;
        var now = a.currentTime;
        var m = tr.root + 12 + tr.scale[(Math.random() * tr.scale.length) | 0] + (Math.random() < 0.2 ? 12 : 0);
        var o = a.createOscillator(), g = a.createGain();
        o.type = tr.wave === 'sawtooth' ? 'triangle' : tr.wave;
        o.frequency.value = mtof(m);
        var att = rand(0.05, 1.2), rel = rand(2.5, 5);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(rand(0.08, 0.16), now + att);
        g.gain.exponentialRampToValueAtTime(0.0001, now + att + rel);
        o.connect(g); g.connect(lp);
        o.start(now); o.stop(now + att + rel + 0.1);
        p.timer = setTimeout(note, tr.step * rand(0.5, 1.5) * 1000);
      })();
      return true;
    }
    function stop() {
      if (!player) return;
      clearTimeout(player.timer);
      release(player, 1800);
      player = null;
    }
    function spectrum() {
      if (!analyser) return null;
      analyser.getByteFrequencyData(bins);
      return bins;
    }
    // a short burst of static, for the hands
    function crackle() {
      var a = ctx();
      if (!a) return;
      var src = a.createBufferSource(), bp = a.createBiquadFilter(), g = a.createGain(), now = a.currentTime;
      src.buffer = noise();
      bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.14, now + 0.02);
      g.gain.setValueAtTime(0.14, now + 0.18);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      src.connect(bp); bp.connect(g); g.connect(master);
      src.start(now, Math.random()); src.stop(now + 0.55);
    }
    return { unlock: ctx, humStart: humStart, humStop: humStop, play: play, stop: stop, spectrum: spectrum, crackle: crackle, TRACKS: TRACKS };
  })();

  function humToggle() {
    var btn = $('#hum');
    function set(on) {
      if (on && !Sound.humStart()) on = false;
      if (!on) Sound.humStop();
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.querySelector('.hum-state').textContent = on ? 'on' : 'off';
      if (scenes.wires) scenes.wires.state.hum = on;
      return on;
    }
    btn.addEventListener('click', function () { set(btn.getAttribute('aria-pressed') !== 'true'); });
    return { set: set, on: function () { return btn.getAttribute('aria-pressed') === 'true'; } };
  }

  /* ---------- the canvases ---------- */
  var DUO = ['#e8e3da', '#e3182d'];
  function makeViews() {
    var lightsEl = $('#lights');
    scenes.eye = S.Eye();
    views.eye = new A.AsciiView($('#cv-eye'), scenes.eye, {
      mode: 'color', duo: DUO, cols: 200, colsNarrow: 112, maxFont: 10, heightRatio: 0.48, heightRatioNarrow: 0.8,
      lumMix: 0.5, edges: true, edgeThresh: 0.34, jitter: 0.03, fps: 60
    });
    scenes.bloom = S.Bloom();
    views.bloom = new A.AsciiView($('#cv-bloom'), scenes.bloom, {
      mode: 'color', duo: DUO, cols: 150, colsNarrow: 108, heightRatio: 1.0, lumMix: 0.8, gamma: 0.8,
      edges: true, edgeThresh: 0.22, jitter: 0.02, fps: 60
    });
    scenes.moon = S.Moon();
    scenes.moon.state.phase = moonNow().phase;
    views.moon = new A.AsciiView($('#cv-moon'), scenes.moon, {
      mode: 'color', duo: DUO, cols: 150, colsNarrow: 108, heightRatio: 0.72, heightRatioNarrow: 0.9,
      ss: 1, gamma: 0.8, jitter: 0.015, fps: 60
    });
    scenes.wires = S.Wires();
    views.wires = new A.AsciiView($('#cv-lines'), scenes.wires, {
      mode: 'color', duo: DUO, cols: 210, colsNarrow: 112, heightRatio: 0.5, heightRatioNarrow: 0.9,
      gamma: 1.6, edges: true, edgeThresh: 0.16, jitter: 0.02, fps: 60
    });
    scenes.snow = S.Snow(function (n) { lightsEl.textContent = n; });
    views.snow = new A.AsciiView($('#cv-snow'), scenes.snow, {
      mode: 'color', duo: DUO, cols: 220, colsNarrow: 116, heightRatio: 0.5, heightRatioNarrow: 0.95, gamma: 1.4, jitter: 0.02, fps: 60
    });
    A.start();
  }
  // the real moon, roughly: phase from a known new moon, distance from the mean anomaly
  function moonNow() {
    var SYN = 29.530588853, now = Date.now();
    var days = (now - Date.UTC(2000, 0, 6, 18, 14)) / 864e5;
    var phase = ((days % SYN) + SYN) % SYN / SYN;
    var lit = (1 - Math.cos(phase * Math.PI * 2)) / 2;
    var dJ = (now - Date.UTC(2000, 0, 1, 12)) / 864e5;
    var M = (134.963 + 13.064993 * dJ) * Math.PI / 180;
    var dist = 385001 - 20905 * Math.cos(M);
    var names = [[0.03, 'new'], [0.22, 'waxing crescent'], [0.28, 'first quarter'], [0.47, 'waxing gibbous'],
      [0.53, 'full'], [0.72, 'waning gibbous'], [0.78, 'last quarter'], [0.97, 'waning crescent'], [1.01, 'new']];
    var name = 'new';
    for (var i = 0; i < names.length; i++) if (phase < names[i][0]) { name = names[i][1]; break; }
    return { phase: phase, lit: lit, dist: dist, name: name };
  }
  function whenFonts(cb) {
    var done = false;
    function go() { if (!done) { done = true; cb(); } }
    if (document.fonts && document.fonts.load) {
      Promise.all([
        document.fonts.load('400 12px "Courier Prime"')
      ]).then(go, go);
      setTimeout(go, 2500);
      // if the font arrives late, measure again so the columns line up
      document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', function () {
        A.clearRamps();
        A.views.forEach(function (v) { v.resize(); });
      });
    } else go();
  }

  /* ---------- live readouts ---------- */
  function readouts() {
    var gx = $('#eye-gx'), gy = $('#eye-gy'), pupil = $('#eye-pupil'), blinks = $('#eye-blinks'), status = $('#eye-status');
    function sign(n) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(2); }
    setInterval(function () {
      var st = scenes.eye && scenes.eye.state;
      if (!st) return;
      gx.textContent = sign(st.lx);
      gy.textContent = sign(-st.ly);
      pupil.textContent = (2.2 + 2.6 * st.pupil).toFixed(1) + ' mm';
      blinks.textContent = st.blinks;
      status.textContent = st.watched ? 'watching you' : st.blink > 0.4 ? 'blinking' : 'waiting';
    }, 150);

    var still = $('#still');
    $('#garden-day').textContent = daysSince(1998, 7, 6).toLocaleString('en-US');
    function moonText() {
      var m = moonNow();
      $('#moon-name').textContent = m.name;
      $('#moon-lit').textContent = Math.round(m.lit * 100) + '%';
      $('#moon-dist').textContent = Math.round(m.dist).toLocaleString('en-US') + ' km';
      $('#moon-delay').textContent = (m.dist / 299792.458).toFixed(2) + ' s';
      if (scenes.moon) scenes.moon.state.phase = m.phase;
    }
    moonText();
    setInterval(moonText, 60000);
    setInterval(function () {
      still.textContent = Math.max(0, Math.round((performance.now() - (A.Pointer.last || 0)) / 1000)) + ' s';
    }, 1000);

    var log = $('#see-log');
    if (!log) return;
    var MSG = [
      function () { var s = scenes.eye.state; return 'eye: saccade ' + sign(s.tx) + ' ' + sign(-s.ty); },
      function () { return 'eye: pupil ' + (2.2 + 2.6 * scenes.eye.state.pupil).toFixed(2) + 'mm'; },
      function () { return 'net: ping wired 0.000ms'; },
      function () { return 'net: packet from nobody'; },
      function () { return 'mem: 0x' + ((Math.random() * 0xffffff) | 0).toString(16) + ' ok'; },
      function () { return 'who: 1 watcher'; },
      function () { return 'moon: ' + moonNow().name; },
      function () { return 'wired: present'; },
      function () { return scenes.eye.state.watched ? 'eye: blink held (watched)' : 'eye: blink allowed'; },
      function () { return 'bloom: petal ' + ((Math.random() * 999) | 0) + ' fell'; },
      function () { return 'snow: -14c, 9 floors'; }
    ];
    var lines = [];
    setInterval(function () {
      if (!scenes.eye) return;
      var r = log.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) return;
      lines.push(stamp() + ' ' + MSG[(Math.random() * MSG.length) | 0]());
      if (lines.length > 60) lines.shift();
      log.textContent = lines.join('\n');
    }, 420);
  }

  /* ---------- text scramble ---------- */
  function scramble() {
    var CH = '!<>-_\\/[]{}=+*^?#01';
    $$('[data-scramble]').forEach(function (el) {
      var text = el.textContent;
      el.setAttribute('aria-label', text.replace(/\s+/g, ' '));
      var busy = false, seen = false;
      function run() {
        if (reduced || busy) return;
        busy = true;
        var n = text.length, start = performance.now(), dur = 450 + n * 16;
        (function step(now) {
          var p = (now - start) / dur, out = '';
          for (var i = 0; i < n; i++) {
            var c = text[i];
            out += (c === ' ' || c === '\n' || i / n < p * 1.2 - 0.2) ? c : CH[(Math.random() * CH.length) | 0];
          }
          el.textContent = out;
          if (p < 1) requestAnimationFrame(step);
          else { el.textContent = text; busy = false; }
        })(start);
      }
      onView(el, function (on) { if (on && !seen) { seen = true; run(); } else if (!on) seen = false; }, 0.6);
      el.addEventListener('pointerenter', run);
    });
  }

  /* ---------- present day. present time. ---------- */
  function presentDay() {
    var a = $('#pd1'), b = $('#pd2'), laugh = $('#laugh');
    var busy = false, armed = true;
    function type(el, text, cb) {
      var i = 0;
      el.classList.add('typing');
      (function s() {
        el.textContent = text.slice(0, ++i);
        if (i < text.length) setTimeout(s, rand(60, 130));
        else { el.classList.remove('typing'); if (cb) cb(); }
      })();
    }
    function doLaugh() {
      if (reduced) return;
      laugh.classList.remove('on');
      void laugh.offsetWidth;
      laugh.classList.add('on');
      A.views.forEach(function (v) { if (v.visible) v.kick(0.6); });
    }
    function play() {
      if (busy || reduced) return;
      busy = true;
      a.textContent = ''; b.textContent = '';
      type(a, 'PRESENT DAY', function () {
        setTimeout(function () {
          type(b, 'PRESENT TIME', function () { setTimeout(function () { doLaugh(); busy = false; }, 450); });
        }, 500);
      });
    }
    onView($('#present'), function (on) {
      if (on && armed) { armed = false; play(); } else if (!on) armed = true;
    }, 0.5);
    return { laugh: doLaugh, play: play };
  }

  /* ---------- terminal ---------- */
  function terminal(api) {
    var out = $('#term-out'), form = $('#term-form'), input = $('#term-in');
    var hist = [], hi = 0, queue = Promise.resolve();
    function print(text, cls) {
      var div = document.createElement('div');
      if (cls) div.className = cls;
      div.textContent = text;
      out.appendChild(div);
      while (out.childNodes.length > 200) out.removeChild(out.firstChild);
      out.scrollTop = out.scrollHeight;
    }
    function slow(lines, cls, gap) {
      queue = queue.then(function () {
        return new Promise(function (res) {
          var i = 0;
          (function s() {
            if (i >= lines.length) { res(); return; }
            print(lines[i++], cls);
            setTimeout(s, reduced ? 0 : (gap || 180));
          })();
        });
      });
    }
    var FILES = {
      'eye_01.raw': ['     .-~~~~-.', "   .'  .--.  '.", '  (   ( () )   )', "   '.  '--'  .'", "     '-....-'", '(it is still looking at you.)'],
      'higanbana.txt': ['the leaves and the flowers never meet.', 'that is the whole story.'],
      'moon.raw': ['binary file.', 'it only ever shows you one side.'],
      'layer_07.log': ['[03:12:07] you said you were here.', "[03:12:08] you weren't.", '[03:12:09] we waited anyway.'],
      'heaven.box': ['[ ] < heaven!', 'there is a box at the end of the page. check it.'],
      'one.txt': ['you already know what to do with it.']
    };
    function scrollTo(id) { var el = document.getElementById(id); if (el) el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); }
    var CMDS = {
      help: function () {
        return ['ls          cat <file>   whoami', 'connect     date         echo <text>', 'listen      moon         bloom',
          'hum         play         heaven', 'clear       exit'];
      },
      ls: function () { return ['eye_01.raw   higanbana.txt   moon.raw', 'layer_07.log   heaven.box   you.txt', 'one.txt']; },
      touch: function () { setTimeout(api.scream, 450); return ['...']; },
      cat: function (arg) {
        if (!arg) return { err: ['cat: what?'] };
        if (arg === 'you.txt') return { err: ['cat: you.txt: permission denied.', 'you are not readable.'] };
        if (FILES[arg]) return FILES[arg];
        return { err: ['cat: ' + arg + ': no such file.', 'but it could exist.'] };
      },
      whoami: function () {
        var a = ['you are not here.', 'nobody.', 'a visitor. visitors: 0.', 'the one being watched.'];
        return [a[(Math.random() * a.length) | 0]];
      },
      date: function () { setTimeout(api.laugh, 400); return ['present day.', 'present time.']; },
      connect: function () {
        slow(['dialing 0.0.0.0 ...', 'handshake ............ ok', 'protocol 7 ........... ok', 'you are connected.', 'everyone is here. no one is here.'], null, 420);
        return [];
      },
      echo: function (arg) { return [(arg || '').split('').reverse().join('') || '...']; },
      listen: function () { api.player.play(); return ['turning the volume up.']; },
      love: function () { return { err: ['love: connection refused.'] }; },
      moon: function () {
        if (!scenes.moon) return [];
        scenes.moon.state.blood = !scenes.moon.state.blood;
        setTimeout(function () { scrollTo('moon'); }, 600);
        var m = moonNow();
        return [m.name + ', ' + Math.round(m.lit * 100) + '% lit.', scenes.moon.state.blood ? 'and red now.' : 'and white again.'];
      },
      bloom: function () {
        if (scenes.bloom) scenes.bloom.shake(2.5);
        setTimeout(function () { scrollTo('bloom'); }, 600);
        return ['they fall for you.'];
      },
      hum: function () { var on = api.hum.set(!api.hum.on()); return ['hum: ' + (on ? 'on. listen to the wires.' : 'off.')]; },
      play: function () { api.player.play(); return ['playing: ' + api.player.name()]; },
      heaven: function () { api.heaven(); return ['ok.']; },
      clear: function () { out.textContent = ''; return []; },
      exit: function () { return { err: ["you can't log out.", 'you were never logged in.'] }; },
      sudo: function () { return { err: ['permission denied. god is busy.'] }; },
      god: function () { return ['who told you that name?']; },
      hello: function () { return ["hello. we've been expecting you.", 'for years.']; },
      ping: function () { return ['64 bytes from you: ttl=∞ time=0.000 ms', '64 bytes from you: ttl=∞ time=0.000 ms', '64 bytes from you: ttl=∞ time=0.000 ms']; },
      cd: function () { return ['there is nowhere to go.']; },
      pwd: function () { return ['/wired/present/day']; },
      rm: function () { return { err: ['nothing can be deleted here.', 'it is all remembered.'] }; }
    };
    CMDS.logout = CMDS.quit = CMDS.exit;
    CMDS.hi = CMDS.hello;
    function run(line) {
      var parts = line.trim().split(/\s+/), cmd = parts.shift().toLowerCase(), arg = parts.join(' ');
      var fn = CMDS[cmd];
      if (!fn) { slow([cmd + ': command not found.', 'but it found you.'], 'err', 160); return; }
      var res = fn(arg);
      if (res && res.err) slow(res.err, 'err', 160);
      else if (res && res.length) slow(res, null, 120);
    }
    print('wired shell  [build 0713]', 'dim');
    print("type help. or don't.", 'dim');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim();
      input.value = '';
      print('guest@wired:~$ ' + v, 'echo');
      if (!v) return;
      hist.push(v); hi = hist.length;
      run(v);
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' && hi > 0) { hi--; input.value = hist[hi]; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hi = Math.min(hist.length, hi + 1); input.value = hist[hi] || ''; e.preventDefault(); }
    });
  }

  /* ---------- wired media player ---------- */
  function mediaPlayer() {
    var list = $('#wmp-list'), playBtn = $('#wmp-play'), trackEl = $('#wmp-track'), timeEl = $('#wmp-time');
    var prog = $('#wmp-prog'), status = $('#wmp-status'), q = $('#wmp-q'), vis = $('#wmp-vis');
    var T = Sound.TRACKS, n = T.length;
    var idx = 0, playing = false, start = 0, elapsed = 0, visible = false;
    function fmt(s) { return pad(Math.floor(s / 60), 2) + ':' + pad(Math.floor(s % 60), 2); }
    T.forEach(function (tr, i) {
      var li = document.createElement('li'), b = document.createElement('button');
      b.type = 'button';
      var nm = document.createElement('span'); nm.textContent = tr.name;
      var ln = document.createElement('span'); ln.className = 'len'; ln.textContent = fmt(tr.len);
      b.appendChild(nm); b.appendChild(ln);
      b.addEventListener('click', function () { Sound.unlock(); select(i, true); });
      li.appendChild(b); list.appendChild(li);
    });
    function mark() {
      Array.prototype.forEach.call(list.children, function (li, i) { li.classList.toggle('on', i === idx); });
      trackEl.textContent = (idx + 1) + '. ' + T[idx].name;
    }
    function questions(ms) {
      q.textContent = repeat('?', 300);
      q.classList.add('on');
      setTimeout(function () { q.classList.remove('on'); }, ms);
    }
    function begin() {
      questions(reduced ? 0 : 650);
      setTimeout(function () {
        if (Sound.play(T[idx])) {
          playing = true;
          start = performance.now() - elapsed * 1000;
          playBtn.textContent = '||';
          playBtn.setAttribute('aria-label', 'Pause');
          status.textContent = 'playing';
        } else status.textContent = 'no audio';
      }, reduced ? 0 : 320);
    }
    function pause() {
      Sound.stop();
      playing = false;
      playBtn.textContent = '>';
      playBtn.setAttribute('aria-label', 'Play');
      status.textContent = 'paused';
    }
    function select(i, autoplay) {
      idx = (i + n) % n;
      elapsed = 0;
      mark();
      if (playing || autoplay) begin();
    }
    playBtn.addEventListener('click', function () { Sound.unlock(); if (playing) pause(); else begin(); });
    $('#wmp-prev').addEventListener('click', function () { Sound.unlock(); select(idx - 1, false); });
    $('#wmp-next').addEventListener('click', function () { Sound.unlock(); select(idx + 1, false); });
    mark();

    onView($('#wmp'), function (on) { visible = on; });
    var t0 = 0;
    setInterval(function () {
      if (playing) {
        elapsed = (performance.now() - start) / 1000;
        if (elapsed >= T[idx].len) { select(idx + 1, true); return; }
      }
      timeEl.textContent = fmt(elapsed);
      prog.style.width = (elapsed / T[idx].len * 100).toFixed(2) + '%';
      if (!visible) return;
      t0 += 0.09;
      var cols = Math.max(16, Math.floor((vis.clientWidth - 16) / 6.1));
      var rows = 10, data = playing ? Sound.spectrum() : null, outRows = [];
      var heights = [];
      for (var c = 0; c < cols; c++) {
        var h;
        if (data) h = data[Math.floor(c / cols * data.length * 0.7)] / 255 * rows;
        else h = 0.6 + 0.6 * Math.sin(t0 + c * 0.35) * Math.sin(t0 * 0.7 + c * 0.11);
        heights.push(h);
      }
      for (var r = rows - 1; r >= 0; r--) {
        var line = '';
        for (c = 0; c < cols; c++) {
          var hh = heights[c];
          line += hh > r + 1 ? '#' : hh > r + 0.5 ? ':' : hh > r ? '.' : ' ';
        }
        outRows.push(line);
      }
      if (!playing) {
        var msg = ' no signal ', mid = Math.floor(rows / 2) - 1, at = Math.max(0, Math.floor((cols - msg.length) / 2));
        outRows[mid] = outRows[mid].slice(0, at) + msg + outRows[mid].slice(at + msg.length);
      }
      vis.textContent = outRows.join('\n');
    }, 90);

    return { play: function () { Sound.unlock(); if (!playing) begin(); }, name: function () { return T[idx].name; } };
  }

  /* ---------- little eyes in the margins ---------- */
  function peeps() {
    var els = $$('.peep');
    var blinkUntil = 0;
    setInterval(function () {
      var now = performance.now(), closed = now < blinkUntil, rects = [], i;
      // read every position first, then write: mixing the two makes the browser re-layout per eye
      for (i = 0; i < els.length; i++) rects.push(els[i].getBoundingClientRect());
      for (i = 0; i < els.length; i++) {
        var el = els[i], r = rects[i];
        if (r.bottom < 0 || r.top > window.innerHeight) continue;
        var dx = A.Pointer.active ? A.Pointer.x - (r.left + r.width / 2) : Math.sin(now / 1400 + i) * 300;
        var pos = Math.round(clamp(dx / 260, -1, 1) + 1);
        var e = closed ? '(---)' : '(' + repeat(' ', pos) + '@' + repeat(' ', 2 - pos) + ')';
        if (el.textContent !== e + ' ' + e) el.textContent = e + ' ' + e;
      }
      if (!closed && Math.random() < 0.012) blinkUntil = now + 150;
    }, 90);
  }

  /* ---------- cursor trail ---------- */
  function trail() {
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
    var box = $('#trail'), pool = [], i = 0, last = 0;
    var CH = '01.:;+*#@<>/\\|アイウエオレイ';
    for (var k = 0; k < 28; k++) { var s = document.createElement('span'); box.appendChild(s); pool.push(s); }
    window.addEventListener('pointermove', function (e) {
      var now = performance.now();
      if (now - last < 30 || !e.isPrimary) return;
      last = now;
      var el = pool[i++ % pool.length], x = e.clientX + 10, y = e.clientY + 10;
      el.textContent = CH[(Math.random() * CH.length) | 0];
      if (el.animate) {
        el.animate([
          { opacity: 0.9, transform: 'translate(' + x + 'px,' + y + 'px)' },
          { opacity: 0, transform: 'translate(' + (x + rand(-14, 14)) + 'px,' + (y + 34) + 'px)' }
        ], { duration: 700, easing: 'ease-out', fill: 'forwards' });
      }
    }, { passive: true });
  }

  /* ---------- ?????????? ---------- */
  function bursts() {
    if (reduced) return;
    var box = $('#glitches');
    function once() {
      if (!document.hidden) {
        var n = 1 + ((Math.random() * 3) | 0);
        for (var i = 0; i < n; i++) {
          var s = document.createElement('span');
          s.textContent = repeat('?', 6 + ((Math.random() * 14) | 0));
          s.style.left = rand(0, 60) + '%';
          s.style.top = rand(12, 88) + '%';
          box.appendChild(s);
          setTimeout(s.remove.bind(s), rand(180, 650));
        }
        A.views.forEach(function (v) { if (v.visible) v.kick(0.7); });
      }
      setTimeout(once, rand(10000, 24000));
    }
    setTimeout(once, rand(7000, 12000));
  }

  /* ---------- heaven ---------- */
  /* ---------- the hands (a secret) ---------- */
  function screamer() {
    var el = $('#scream'), view = null, busy = false, opened = 0, timers = [];
    function clear() { timers.forEach(clearTimeout); timers = []; }
    function close(force) {
      if (!busy || (force !== true && performance.now() - opened < 600)) return;
      clear();
      el.classList.add('out');
      timers.push(setTimeout(function () { el.hidden = true; el.classList.remove('on', 'out'); busy = false; }, 450));
    }
    function open() {
      if (busy) return;
      busy = true;
      opened = performance.now();
      el.hidden = false;
      el.classList.remove('out', 'on');
      void el.offsetWidth;
      el.classList.add('on');
      requestAnimationFrame(function () {
        if (!view) {
          scenes.hands = S.Hands();
          view = new A.AsciiView($('#cv-hands'), scenes.hands, {
            mode: 'color', duo: DUO, cols: 200, colsNarrow: 110,
            heightRatio: function (w) { return Math.min(w < 600 ? 0.75 : 0.6, window.innerHeight * 0.6 / w); },
            gamma: 1.3, lumMix: 0.5, edges: true, edgeThresh: 0.16, jitter: 0.02, fps: 60
          });
        } else view.resize();
        scenes.hands.state.t0 = view.t;
        view.kick(1);
      });
      Sound.crackle();
      timers.push(setTimeout(function () { if (view) view.kick(0.9); Sound.crackle(); }, 2000));
      timers.push(setTimeout(function () { close(true); }, 3000));
    }
    el.addEventListener('pointerdown', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(true); });
    // ways in: the little eyes at the very bottom, or the big eye clicked five times in a row
    $('#secret').addEventListener('click', open);
    var clicks = [];
    $('#cv-eye').addEventListener('pointerdown', function () {
      var now = performance.now();
      clicks = clicks.filter(function (c) { return now - c < 2500; });
      clicks.push(now);
      if (clicks.length >= 5) { clicks = []; open(); }
    });
    return open;
  }

  function heaven() {
    var box = $('#heaven-box'), light = $('#heaven-light'), word = $('#heaven-word'), busy = false;
    function go() {
      if (busy) return;
      busy = true;
      box.setAttribute('aria-pressed', 'true');
      light.classList.add('on');
      setTimeout(function () { light.classList.remove('on'); }, 1800);
      setTimeout(function () { box.setAttribute('aria-pressed', 'false'); word.textContent = 'heaven?'; busy = false; }, 3000);
      setTimeout(function () { word.textContent = 'heaven!'; }, 12000);
    }
    box.addEventListener('click', go);
    return go;
  }

  /* ---------- hex dump of what was said ---------- */
  function hexdump() {
    var el = $('#hexdump');
    var msg = 'close the world. open the next. present day, present time. no matter where you are, everyone is ' +
      'always connected. the moon only shows one side. flowers for no one. the leaves and the flowers never meet. ' +
      '9 floors, nobody is awake. heaven!';
    var per = 0;
    function build() {
      var p = window.innerWidth < 700 ? 8 : 16;
      if (p === per) return;
      per = p;
      el.textContent = '';
      for (var off = 0; off < msg.length; off += per) {
        var chunk = msg.slice(off, off + per), hex = '';
        for (var i = 0; i < per; i++) {
          hex += i < chunk.length ? pad(chunk.charCodeAt(i).toString(16), 2) + ' ' : '   ';
          if (i === 7 && per === 16) hex += ' ';
        }
        el.appendChild(document.createTextNode(pad(off.toString(16), 8) + '  ' + hex + ' |'));
        var b = document.createElement('b');
        b.textContent = chunk + repeat(' ', per - chunk.length);
        el.appendChild(b);
        el.appendChild(document.createTextNode('|\n'));
      }
    }
    build();
    window.addEventListener('resize', build);
  }

  /* ---------- shaking the phone shakes the flowers ---------- */
  function phoneShake() {
    if (typeof window.DeviceMotionEvent === 'undefined') return;
    // iOS asks for permission first; there we keep to swiping across the bouquet
    if (typeof DeviceMotionEvent.requestPermission === 'function') return;
    var bloom = $('#bloom'), visible = false, last = null;
    onView(bloom, function (on) { visible = on; }, 0.2);
    window.addEventListener('devicemotion', function (e) {
      var a = e.accelerationIncludingGravity;
      if (!visible || !a || a.x === null || !scenes.bloom) return;
      if (last) {
        var jerk = Math.abs(a.x - last.x) + Math.abs(a.y - last.y) + Math.abs(a.z - last.z);
        if (jerk > 14) scenes.bloom.shake(Math.min(1, (jerk - 14) / 20));
      }
      last = { x: a.x, y: a.y, z: a.z };
    }, { passive: true });
  }

  /* ---------- write to me ---------- */
  var NAME_A = ['ghost', 'moth', 'static', 'nobody', 'lily', 'wire', 'snow', 'moon', 'signal', 'dust', 'echo', 'glass', 'ash', 'petal', 'crow'];
  var NAME_B = ['', '_', '.', '-'];
  function madeUpName() {
    var n = NAME_A[(Math.random() * NAME_A.length) | 0];
    return n + NAME_B[(Math.random() * NAME_B.length) | 0] + pad((Math.random() * 1000) | 0, 3);
  }
  function messages() {
    var form = $('#msg'), name = $('#msg-name'), text = $('#msg-text'), count = $('#msg-count');
    var status = $('#msg-status'), send = $('#msg-send'), trap = form.querySelector('.hp input');
    var key = (form.getAttribute('data-key') || '').trim();
    var MAX = 400, WAIT = 60000;
    name.placeholder = madeUpName();
    function say(t, cls) { status.textContent = t; status.className = 'msg-status' + (cls ? ' ' + cls : ''); }
    function counter() { count.textContent = text.value.length + ' / ' + MAX; }
    text.addEventListener('input', counter);
    counter();
    $('#msg-dice').addEventListener('click', function () { name.value = madeUpName(); name.focus(); });
    if (!key) say('the line is not connected yet. come back later.', 'off');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (trap && trap.checked) return;
      var who = name.value.replace(/\s+/g, ' ').trim().slice(0, 32) || name.placeholder;
      var body = text.value.trim().slice(0, MAX);
      if (body.length < 2) { say('say at least a word.', 'err'); text.focus(); return; }
      if (!key) { say('the line is not connected yet. your words are still here, nothing was sent.', 'off'); return; }
      var last = 0;
      try { last = +localStorage.getItem('pd-last-msg') || 0; } catch (err) { /* storage blocked */ }
      if (Date.now() - last < WAIT) { say('wait a minute before the next one.', 'err'); return; }
      send.disabled = true;
      say('transmitting...');
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          access_key: key,
          subject: 'present day: a message from ' + who,
          from_name: who,
          name: who,
          message: body,
          botcheck: false
        })
      }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return r.ok && j.success; }); })
        .then(function (ok) {
          if (!ok) throw new Error('rejected');
          try { localStorage.setItem('pd-last-msg', String(Date.now())); } catch (err) { /* storage blocked */ }
          text.value = '';
          counter();
          say('received. there will be no reply.', 'ok');
          A.views.forEach(function (v) { if (v.visible) v.kick(0.5); });
        })
        .catch(function () { say('the signal did not get through. try again later.', 'err'); })
        .then(function () { send.disabled = false; });
    });
  }

  /* ---------- small things ---------- */
  function ticker() {
    var track = $('#ticker');
    if (!track) return;
    Array.prototype.slice.call(track.children).forEach(function (c) {
      var d = c.cloneNode(true);
      d.setAttribute('aria-hidden', 'true');
      track.appendChild(d);
    });
  }
  function navActive() {
    var links = {};
    $$('.bar-nav a').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    $$('.layer').forEach(function (sec) {
      onView(sec, function (on) {
        if (!on) return;
        Object.keys(links).forEach(function (k) { links[k].classList.toggle('on', k === sec.id); });
      }, 0.3);
    });
  }
  function tabTitle() {
    var base = document.title;
    document.addEventListener('visibilitychange', function () {
      document.title = document.hidden ? '(@) (@) still here' : base;
    });
  }

  /* ---------- start ---------- */
  // ?lite in the address: start in the low-power mode straight away
  if (/[?&]lite\b/.test(location.search)) A.goLite();
  boot();
  clock();
  ticker();
  hexdump();
  scramble();
  peeps();
  trail();
  bursts();
  navActive();
  tabTitle();
  phoneShake();
  messages();
  var hum = humToggle();
  var pd = presentDay();
  var heavenGo = heaven();
  var scream = screamer();
  var player = mediaPlayer();
  terminal({ laugh: pd.laugh, hum: hum, heaven: heavenGo, player: player, scream: scream });
  whenFonts(function () { makeViews(); readouts(); });
})();
