(() => {
  'use strict';

  /* ---------- Définition des pads ---------- */

  const PADS = [
    { name: 'Kick',        key: 'a', type: 'hit',  sound: 'kick',    color: '#ff5c5c' },
    { name: 'Snare',       key: 'z', type: 'hit',  sound: 'snare',   color: '#ff5c5c' },
    { name: 'Clap',        key: 'e', type: 'hit',  sound: 'clap',    color: '#ff5c5c' },
    { name: 'Hat',         key: 'r', type: 'hit',  sound: 'hat',     color: '#ff5c5c' },

    { name: 'Open hat',    key: 'q', type: 'hit',  sound: 'openhat', color: '#ffb23c' },
    { name: 'Tom',         key: 's', type: 'hit',  sound: 'tom',     color: '#ffb23c' },
    { name: 'Rim',         key: 'd', type: 'hit',  sound: 'rim',     color: '#ffb23c' },
    { name: 'Cowbell',     key: 'f', type: 'hit',  sound: 'cowbell', color: '#ffb23c' },

    { name: 'Basse',       key: 'w', type: 'hit',  sound: 'bass',    color: '#3cd6ff' },
    { name: 'Accord',      key: 'x', type: 'hit',  sound: 'stab',    color: '#3cd6ff' },
    { name: 'Pluck',       key: 'c', type: 'hit',  sound: 'pluck',   color: '#3cd6ff' },
    { name: 'Laser',       key: 'v', type: 'hit',  sound: 'laser',   color: '#3cd6ff' },

    { name: 'Boucle beat', key: 't', type: 'loop', loop: 'beat',     color: '#b57cff' },
    { name: 'Boucle hats', key: 'y', type: 'loop', loop: 'hats',     color: '#b57cff' },
    { name: 'Boucle basse', key: 'u', type: 'loop', loop: 'bass',    color: '#b57cff' },
    { name: 'Boucle arp',  key: 'i', type: 'loop', loop: 'arp',      color: '#b57cff' }
  ];

  /* ---------- État audio ---------- */

  let ctx = null;
  let filter = null;
  let master = null;
  let delay = null;
  let delayGain = null;
  let analyser = null;
  let noiseBuf = null;
  let freqData = null;

  const state = {
    bpm: 110,
    step: 0,
    nextTime: 0,
    timer: null,
    loops: new Set(),
    queue: []
  };

  /* ---------- Éléments de la page ---------- */

  const gridEl = document.getElementById('grid');
  const stepsEl = document.getElementById('steps');
  const canvas = document.getElementById('viz');
  const gfx = canvas.getContext('2d');
  const volume = document.getElementById('volume');
  const filterSlider = document.getElementById('filter');
  const echo = document.getElementById('echo');
  const tempo = document.getElementById('tempo');
  const stopBtn = document.getElementById('stop');

  const padEls = [];
  const stepEls = [];

  /* ---------- Initialisation de l'audio ---------- */

  function initAudio() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }

    ctx = new (window.AudioContext || window.webkitAudioContext)();

    filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.5;

    delay = ctx.createDelay(1.5);
    delayGain = ctx.createGain();
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;

    master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();

    analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.8;
    freqData = new Uint8Array(analyser.frequencyBinCount);

    // Routage : pads -> filtre -> master, avec une branche d'écho
    filter.connect(master);
    filter.connect(delay);
    delay.connect(delayGain);
    delayGain.connect(master);
    delay.connect(feedback);
    feedback.connect(delay);
    master.connect(comp);
    comp.connect(analyser);
    analyser.connect(ctx.destination);

    // Bruit blanc réutilisé pour caisse claire, charleston, clap
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    applyVolume();
    applyFilter();
    applyEcho();
    applyTempo();
  }

  /* ---------- Briques de synthèse ---------- */

  function tone(t, out, { type = 'sine', f0, f1, dur = 0.3, vol = 1 }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  function burst(t, out, { type = 'highpass', freq = 7000, q = 1, dur = 0.05, vol = 1 }) {
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noiseBuf;
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  /* ---------- Sons ---------- */

  const SOUNDS = {
    kick(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 150, f1: 42, dur: 0.45, vol: v });
    },

    snare(t, out, f, v = 1) {
      tone(t, out, { type: 'triangle', f0: 200, f1: 120, dur: 0.15, vol: 0.6 * v });
      burst(t, out, { type: 'highpass', freq: 1800, dur: 0.2, vol: 0.8 * v });
    },

    clap(t, out, f, v = 1) {
      for (let i = 0; i < 3; i++) {
        burst(t + i * 0.012, out, { type: 'bandpass', freq: 1500, q: 1, dur: 0.02, vol: 0.7 * v });
      }
      burst(t + 0.036, out, { type: 'bandpass', freq: 1500, q: 1, dur: 0.15, vol: 0.8 * v });
    },

    hat(t, out, f, v = 1) {
      burst(t, out, { type: 'highpass', freq: 8000, dur: 0.05, vol: 0.5 * v });
    },

    openhat(t, out, f, v = 1) {
      burst(t, out, { type: 'highpass', freq: 7000, dur: 0.3, vol: 0.5 * v });
    },

    tom(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 220, f1: 110, dur: 0.3, vol: 0.9 * v });
    },

    rim(t, out, f, v = 1) {
      tone(t, out, { type: 'square', f0: 800, dur: 0.04, vol: 0.3 * v });
      burst(t, out, { type: 'bandpass', freq: 3000, dur: 0.03, vol: 0.4 * v });
    },

    cowbell(t, out, f, v = 1) {
      tone(t, out, { type: 'square', f0: 540, dur: 0.3, vol: 0.25 * v });
      tone(t, out, { type: 'square', f0: 800, dur: 0.3, vol: 0.25 * v });
    },

    bass(t, out, f = 55, v = 1) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 500;
      lp.connect(out);
      tone(t, lp, { type: 'sawtooth', f0: f, dur: 0.4, vol: 0.5 * v });
      tone(t, lp, { type: 'sine', f0: f, dur: 0.4, vol: 0.6 * v });
    },

    stab(t, out, f, v = 1) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      lp.connect(out);
      [220, 277.2, 329.6].forEach((note) => {
        tone(t, lp, { type: 'sawtooth', f0: note, dur: 0.25, vol: 0.12 * v });
      });
    },

    pluck(t, out, f = 659.3, v = 1) {
      tone(t, out, { type: 'triangle', f0: f, dur: 0.25, vol: 0.35 * v });
    },

    laser(t, out, f, v = 1) {
      tone(t, out, { type: 'sawtooth', f0: 1800, f1: 80, dur: 0.35, vol: 0.25 * v });
    }
  };

  /* ---------- Boucles (16 pas) ---------- */

  const BASS_LINE = [55, 0, 0, 55, 0, 0, 65.4, 0, 0, 55, 0, 73.4, 0, 0, 65.4, 0];
  const ARP_NOTES = [440, 523.3, 659.3, 784, 659.3, 523.3, 440, 392];

  // Chaque boucle renvoie, pour un pas donné, une liste de [son, fréquence, volume]
  const LOOPS = {
    beat(s) {
      const hits = [];
      if (s % 4 === 0) hits.push(['kick']);
      if (s % 8 === 4) hits.push(['clap']);
      return hits;
    },

    hats(s) {
      if (s % 4 === 2) return [['openhat', null, 0.7]];
      if (s % 2 === 1) return [['hat', null, 0.4]];
      return [['hat', null, 1]];
    },

    bass(s) {
      return BASS_LINE[s] ? [['bass', BASS_LINE[s]]] : [];
    },

    arp(s) {
      return s % 2 === 0 ? [['pluck', ARP_NOTES[(s / 2) % 8]]] : [];
    }
  };

  /* ---------- Horloge des boucles ---------- */

  function playStep(step, time) {
    state.loops.forEach((id) => {
      LOOPS[id](step).forEach(([name, freq, vol]) => {
        SOUNDS[name](time, filter, freq || undefined, vol === undefined ? 1 : vol);
      });
    });
    state.queue.push({ step, time });
  }

  function scheduler() {
    while (state.nextTime < ctx.currentTime + 0.12) {
      playStep(state.step, state.nextTime);
      state.nextTime += 60 / state.bpm / 4;
      state.step = (state.step + 1) % 16;
    }
  }

  function startClock() {
    if (state.timer) return;
    state.step = 0;
    state.nextTime = ctx.currentTime + 0.05;
    state.timer = setInterval(scheduler, 25);
  }

  function stopClock() {
    clearInterval(state.timer);
    state.timer = null;
    state.queue.length = 0;
    showStep(-1);
  }

  /* ---------- Actions sur les pads ---------- */

  function flash(el) {
    el.classList.remove('hit');
    void el.offsetWidth; // relance l'animation
    el.classList.add('hit');
  }

  function toggleLoop(pad, el) {
    if (state.loops.has(pad.loop)) {
      state.loops.delete(pad.loop);
    } else {
      state.loops.add(pad.loop);
    }

    const active = state.loops.has(pad.loop);
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));

    if (state.loops.size === 0) {
      stopClock();
    } else {
      startClock();
    }
  }

  function trigger(i) {
    initAudio();
    const pad = PADS[i];
    const el = padEls[i];

    if (pad.type === 'loop') {
      toggleLoop(pad, el);
    } else {
      SOUNDS[pad.sound](ctx.currentTime + 0.01, filter, pad.freq);
      flash(el);
    }
  }

  function stopAll() {
    state.loops.clear();
    padEls.forEach((el, i) => {
      if (PADS[i].type === 'loop') {
        el.classList.remove('on');
        el.setAttribute('aria-pressed', 'false');
      }
    });
    stopClock();
  }

  /* ---------- Réglages ---------- */

  function applyVolume() {
    document.getElementById('volumeOut').textContent = Math.round(volume.value * 100);
    if (master) master.gain.setTargetAtTime(volume.value, ctx.currentTime, 0.02);
  }

  function applyFilter() {
    const v = Number(filterSlider.value);
    document.getElementById('filterOut').textContent = Math.round(v * 100);
    if (filter) {
      const freq = 200 * Math.pow(90, v); // de 200 Hz à 18 000 Hz
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02);
    }
  }

  function applyEcho() {
    const v = Number(echo.value);
    document.getElementById('echoOut').textContent = Math.round(v * 100);
    if (delayGain) delayGain.gain.setTargetAtTime(v * 0.6, ctx.currentTime, 0.02);
  }

  function applyTempo() {
    state.bpm = Number(tempo.value);
    document.getElementById('tempoOut').textContent = state.bpm;
    if (delay) delay.delayTime.setTargetAtTime((60 / state.bpm) * 0.75, ctx.currentTime, 0.05);
  }

  /* ---------- Construction de l'interface ---------- */

  PADS.forEach((pad, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad';
    btn.style.setProperty('--c', pad.color);
    btn.innerHTML =
      '<span class="name">' + pad.name + '</span>' +
      '<span class="key">' + pad.key + '</span>';

    if (pad.type === 'loop') btn.setAttribute('aria-pressed', 'false');

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      trigger(i);
    });

    // Activation au clavier (Entrée ou Espace sur un pad sélectionné)
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) trigger(i);
    });

    gridEl.appendChild(btn);
    padEls.push(btn);
  });

  for (let i = 0; i < 16; i++) {
    const dot = document.createElement('span');
    stepsEl.appendChild(dot);
    stepEls.push(dot);
  }

  let currentStep = -1;

  function showStep(step) {
    if (step === currentStep) return;
    currentStep = step;
    stepEls.forEach((dot, i) => dot.classList.toggle('cur', i === step));
  }

  /* ---------- Clavier ---------- */

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = PADS.findIndex((pad) => pad.key === e.key.toLowerCase());
    if (i !== -1) trigger(i);
  });

  /* ---------- Réglages : événements ---------- */

  volume.addEventListener('input', applyVolume);
  filterSlider.addEventListener('input', applyFilter);
  echo.addEventListener('input', applyEcho);
  tempo.addEventListener('input', applyTempo);
  stopBtn.addEventListener('click', stopAll);

  /* ---------- Visualiseur ---------- */

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    canvas.width = r.width * d;
    canvas.height = r.height * d;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function draw() {
    requestAnimationFrame(draw);

    const w = canvas.width;
    const h = canvas.height;
    gfx.clearRect(0, 0, w, h);

    // Suivi du pas en cours, synchronisé sur l'horloge audio
    if (ctx) {
      while (state.queue.length && state.queue[0].time <= ctx.currentTime) {
        showStep(state.queue.shift().step);
      }
      analyser.getByteFrequencyData(freqData);
    }

    const bars = 48;
    const gap = 3 * (window.devicePixelRatio || 1);
    const barW = (w - gap * (bars - 1)) / bars;

    for (let i = 0; i < bars; i++) {
      const v = freqData ? freqData[i] / 255 : 0;
      const barH = Math.max(4, v * h * 0.95);
      gfx.fillStyle = 'hsl(' + (80 + i * 2.2) + ', 100%, ' + (45 + v * 20) + '%)';
      gfx.fillRect(i * (barW + gap), h - barH, barW, barH);
    }
  }

  draw();
})();
