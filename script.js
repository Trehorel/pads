(() => {
  'use strict';

  /* ---------- Définition des pads ---------- */

  const PADS = [
    { name: 'Kick',     key: 'a', type: 'hit',  sound: 'kick',    color: '#ff5c5c' },
    { name: 'Snare',    key: 'z', type: 'hit',  sound: 'snare',   color: '#ff5c5c' },
    { name: 'Clap',     key: 'e', type: 'hit',  sound: 'clap',    color: '#ff5c5c' },
    { name: 'Hat',      key: 'r', type: 'hit',  sound: 'hat',     color: '#ff5c5c' },

    { name: 'Open hat', key: 'q', type: 'hit',  sound: 'openhat', color: '#ffb23c' },
    { name: 'Tom',      key: 's', type: 'hit',  sound: 'tom',     color: '#ffb23c' },
    { name: 'Rim',      key: 'd', type: 'hit',  sound: 'rim',     color: '#ffb23c' },
    { name: 'Cowbell',  key: 'f', type: 'hit',  sound: 'cowbell', color: '#ffb23c' },

    { name: 'Basse',    key: 'w', type: 'hit',  sound: 'bass',    color: '#3cd6ff' },
    { name: 'Accord',   key: 'x', type: 'hit',  sound: 'stab',    color: '#3cd6ff' },
    { name: 'Pluck',    key: 'c', type: 'hit',  sound: 'pluck',   color: '#3cd6ff' },
    { name: 'Laser',    key: 'v', type: 'hit',  sound: 'laser',   color: '#3cd6ff' },

    { name: 'Beat',     key: 't', type: 'loop', loop: 'beat',     color: '#b57cff' },
    { name: 'Hats',     key: 'y', type: 'loop', loop: 'hats',     color: '#b57cff' },
    { name: 'Basse',    key: 'u', type: 'loop', loop: 'bass',     color: '#b57cff' },
    { name: 'Arp',      key: 'i', type: 'loop', loop: 'arp',      color: '#b57cff' }
  ];

  const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- État audio ---------- */

  let ctx = null;
  let filter = null;
  let master = null;
  let delay = null;
  let delayGain = null;
  let analyser = null;
  let recDest = null;
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

  /* ---------- État de l'enregistreur ---------- */

  const MAX_REC = 300; // durée maximale d'un enregistrement, en secondes

  const rec = {
    on: false,
    start: 0,
    duration: 0,
    bpm: 110,
    events: []
  };

  const play = {
    on: false,
    start: 0,
    idx: 0,
    timer: null,
    timeouts: []
  };

  // Format audio pris en charge par le navigateur pour le téléchargement
  const MIME = (typeof MediaRecorder !== 'undefined')
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']
        .find((type) => MediaRecorder.isTypeSupported(type))
    : undefined;

  const EXT = MIME
    ? (MIME.includes('mp4') ? 'm4a' : MIME.includes('ogg') ? 'ogg' : 'webm')
    : '';

  let mediaRec = null;
  let audioUrl = null;

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

  const audioState = document.getElementById('audioState');
  const bpmRead = document.getElementById('bpmRead');
  const loopRead = document.getElementById('loopRead');

  const recBtn = document.getElementById('recBtn');
  const recLabel = document.getElementById('recLabel');
  const playBtn = document.getElementById('playBtn');
  const playLabel = document.getElementById('playLabel');
  const dlBtn = document.getElementById('dlBtn');
  const loopPlay = document.getElementById('loopPlay');
  const timelineEl = document.getElementById('timeline');
  const fillEl = document.getElementById('fill');
  const timeEl = document.getElementById('time');
  const statusEl = document.getElementById('recStatus');

  const padEls = [];
  const stepEls = [];

  if (!MIME) dlBtn.hidden = true;

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

    // Sortie dédiée à l'enregistrement audio (fichier téléchargeable)
    if (MIME && ctx.createMediaStreamDestination) {
      recDest = ctx.createMediaStreamDestination();
      comp.connect(recDest);
    }

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

    audioState.textContent = 'Audio actif';
    audioState.classList.add('on');
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
    clearTimeout(el._hitTimer);
    el._hitTimer = setTimeout(() => el.classList.remove('hit'), 300);
  }

  function updateLoopRead() {
    const n = state.loops.size;
    loopRead.textContent = n === 0 ? 'Aucune boucle' : n + (n > 1 ? ' boucles' : ' boucle');
  }

  // Active ou coupe une boucle, et renvoie son état final
  function setLoop(i, on) {
    const pad = PADS[i];
    const el = padEls[i];

    if (on) {
      state.loops.add(pad.loop);
    } else {
      state.loops.delete(pad.loop);
    }

    const active = state.loops.has(pad.loop);
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', String(active));

    if (state.loops.size === 0) {
      stopClock();
    } else {
      startClock();
    }

    updateLoopRead();
    return active;
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
    updateLoopRead();
  }

  // Note une action dans l'enregistrement en cours
  function record(ev) {
    if (!rec.on) return;
    ev.t = ctx.currentTime - rec.start;
    rec.events.push(ev);
  }

  function trigger(i) {
    initAudio();
    const pad = PADS[i];

    if (pad.type === 'loop') {
      const active = setLoop(i, !state.loops.has(pad.loop));
      record({ kind: 'loop', i, on: active });
    } else {
      SOUNDS[pad.sound](ctx.currentTime + 0.01, filter, pad.freq);
      flash(padEls[i]);
      record({ kind: 'hit', i });
    }
  }

  /* ---------- Réglages ---------- */

  // Colore la partie gauche du curseur
  function paintRange(input) {
    const p = ((input.value - input.min) / (input.max - input.min)) * 100;
    input.style.setProperty('--p', p + '%');
  }

  function applyVolume() {
    document.getElementById('volumeOut').textContent = Math.round(volume.value * 100);
    paintRange(volume);
    if (master) master.gain.setTargetAtTime(volume.value, ctx.currentTime, 0.02);
  }

  function applyFilter() {
    const v = Number(filterSlider.value);
    document.getElementById('filterOut').textContent = Math.round(v * 100);
    paintRange(filterSlider);
    if (filter) {
      const freq = 200 * Math.pow(90, v); // de 200 Hz à 18 000 Hz
      filter.frequency.setTargetAtTime(freq, ctx.currentTime, 0.02);
    }
  }

  function applyEcho() {
    const v = Number(echo.value);
    document.getElementById('echoOut').textContent = Math.round(v * 100);
    paintRange(echo);
    if (delayGain) delayGain.gain.setTargetAtTime(v * 0.6, ctx.currentTime, 0.02);
  }

  function applyTempo() {
    state.bpm = Number(tempo.value);
    document.getElementById('tempoOut').textContent = state.bpm;
    bpmRead.textContent = state.bpm + ' BPM';
    paintRange(tempo);
    document.documentElement.style.setProperty('--beat', (60 / state.bpm).toFixed(3) + 's');
    if (delay) delay.delayTime.setTargetAtTime((60 / state.bpm) * 0.75, ctx.currentTime, 0.05);
  }

  /* ---------- Enregistreur : affichage ---------- */

  function setTime(seconds) {
    const tenths = Math.floor(seconds * 10);
    const m = Math.floor(tenths / 600);
    const s = (tenths % 600) / 10;
    const txt = String(m).padStart(2, '0') + ':' + s.toFixed(1).padStart(4, '0');
    if (txt !== timeEl.textContent) timeEl.textContent = txt;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function idleStatus() {
    if (rec.events.length === 0) {
      setStatus('Appuie sur Enregistrer, puis joue.');
    } else {
      setStatus('Enregistré : ' + rec.events.length + ' actions, ' + rec.duration.toFixed(1) + ' s.');
    }
  }

  function updateButtons() {
    recLabel.textContent = rec.on ? 'Arrêter' : 'Enregistrer';
    recBtn.classList.toggle('rec', rec.on);
    playLabel.textContent = play.on ? 'Stop' : 'Lire';
    playBtn.classList.toggle('playing', play.on);
    playBtn.disabled = rec.events.length === 0 || rec.on;
    dlBtn.disabled = !audioUrl || rec.on;
    tempo.disabled = rec.on || play.on; // le tempo reste fixe pour que la lecture soit fidèle
  }

  function clearTimeline() {
    timelineEl.querySelectorAll('.tick').forEach((tick) => tick.remove());
    fillEl.style.width = '0';
  }

  function renderTimeline() {
    clearTimeline();
    const d = Math.max(rec.duration, 0.1);

    rec.events.forEach((ev) => {
      const tick = document.createElement('span');
      tick.className = 'tick' + (ev.kind === 'loop' ? ' loop' : '');
      tick.style.left = Math.min(99.5, (ev.t / d) * 100) + '%';
      tick.style.background = PADS[ev.i].color;
      timelineEl.appendChild(tick);
    });
  }

  /* ---------- Enregistreur : enregistrement ---------- */

  function startRecording() {
    initAudio();
    if (play.on) stopPlayback();

    rec.events = [];
    rec.bpm = state.bpm;
    rec.duration = 0;
    rec.start = ctx.currentTime;
    rec.on = true;

    // Les boucles déjà lancées font partie de la performance, dès le début
    PADS.forEach((pad, i) => {
      if (pad.type === 'loop' && state.loops.has(pad.loop)) {
        rec.events.push({ kind: 'loop', i, on: true, t: 0 });
      }
    });

    // Enregistrement du son lui-même (fichier téléchargeable)
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }
    if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop();

    if (MIME && recDest) {
      const chunks = [];
      const r = new MediaRecorder(recDest.stream, { mimeType: MIME });
      mediaRec = r;

      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };

      r.onstop = () => {
        if (mediaRec !== r || !chunks.length) return;
        audioUrl = URL.createObjectURL(new Blob(chunks, { type: MIME }));
        updateButtons();
      };

      r.start();
    }

    clearTimeline();
    setTime(0);
    setStatus('Enregistrement en cours… joue sur les pads.');
    updateButtons();
  }

  function stopRecording() {
    rec.on = false;
    rec.duration = ctx.currentTime - rec.start;

    // Petit délai pour ne pas couper la fin des sons
    const r = mediaRec;
    if (r) {
      setTimeout(() => {
        if (r.state !== 'inactive') r.stop();
      }, 500);
    }

    setTime(rec.duration);
    renderTimeline();
    idleStatus();
    updateButtons();
  }

  /* ---------- Enregistreur : lecture ---------- */

  function scheduleEvent(ev, at) {
    const wait = Math.max(0, (at - ctx.currentTime) * 1000);

    if (ev.kind === 'hit') {
      const pad = PADS[ev.i];
      SOUNDS[pad.sound](at, filter, pad.freq);
      play.timeouts.push(setTimeout(() => flash(padEls[ev.i]), wait));
    } else {
      play.timeouts.push(setTimeout(() => setLoop(ev.i, ev.on), wait));
    }
  }

  function clearPlayTimeouts() {
    play.timeouts.forEach(clearTimeout);
    play.timeouts.length = 0;
  }

  function playScheduler() {
    const elapsed = ctx.currentTime - play.start;

    while (play.idx < rec.events.length && rec.events[play.idx].t <= elapsed + 0.1) {
      scheduleEvent(rec.events[play.idx], play.start + rec.events[play.idx].t);
      play.idx++;
    }

    if (elapsed >= rec.duration + 0.4) {
      if (loopPlay.checked) {
        clearPlayTimeouts();
        stopAll();
        play.idx = 0;
        play.start = ctx.currentTime + 0.1;
      } else {
        stopPlayback();
      }
    }
  }

  function startPlayback() {
    if (!rec.events.length) return;
    initAudio();
    if (rec.on) stopRecording();

    stopAll();
    tempo.value = rec.bpm;
    applyTempo();

    play.on = true;
    play.idx = 0;
    play.start = ctx.currentTime + 0.1;
    play.timer = setInterval(playScheduler, 25);

    setStatus('Lecture en cours…');
    updateButtons();
  }

  function stopPlayback() {
    clearInterval(play.timer);
    play.timer = null;
    clearPlayTimeouts();
    play.on = false;

    stopAll();
    fillEl.style.width = '0';
    setTime(rec.duration);
    idleStatus();
    updateButtons();
  }

  /* ---------- Construction de l'interface ---------- */

  PADS.forEach((pad, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad';
    btn.style.setProperty('--c', pad.color);
    btn.setAttribute(
      'aria-label',
      (pad.type === 'loop' ? 'Boucle ' : '') + pad.name + ' (touche ' + pad.key.toUpperCase() + ')'
    );

    btn.innerHTML =
      '<i class="led"></i>' +
      '<span class="name">' + pad.name + '</span>' +
      (pad.type === 'loop' ? '<span class="tag">Boucle</span>' : '') +
      '<kbd class="key">' + pad.key + '</kbd>';

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

  /* ---------- Événements ---------- */

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const i = PADS.findIndex((pad) => pad.key === e.key.toLowerCase());
    if (i !== -1) trigger(i);
  });

  volume.addEventListener('input', applyVolume);
  filterSlider.addEventListener('input', applyFilter);
  echo.addEventListener('input', applyEcho);
  tempo.addEventListener('input', applyTempo);

  recBtn.addEventListener('click', () => {
    if (rec.on) {
      stopRecording();
    } else {
      startRecording();
    }
  });

  playBtn.addEventListener('click', () => {
    if (play.on) {
      stopPlayback();
    } else {
      startPlayback();
    }
  });

  dlBtn.addEventListener('click', () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = 'performance-pads.' + EXT;
    a.click();
  });

  stopBtn.addEventListener('click', () => {
    if (play.on) {
      stopPlayback();
      return;
    }

    // Pendant un enregistrement, l'arrêt des boucles fait partie de la performance
    PADS.forEach((pad, i) => {
      if (pad.type === 'loop' && state.loops.has(pad.loop)) {
        record({ kind: 'loop', i, on: false });
      }
    });
    stopAll();
  });

  /* ---------- Visualiseur, minuteur et lueur de fond ---------- */

  function resizeCanvas() {
    const r = canvas.getBoundingClientRect();
    const d = window.devicePixelRatio || 1;
    canvas.width = r.width * d;
    canvas.height = r.height * d;
  }

  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  let lastLevel = -1;

  // Règle la lueur de fond selon le volume du son (arrondi pour limiter les mises à jour)
  function setLevel(v) {
    const r = Math.round(v * 50) / 50;
    if (r !== lastLevel) {
      lastLevel = r;
      document.body.style.setProperty('--level', r);
    }
  }

  function bar(x, y, w, h) {
    gfx.beginPath();
    if (gfx.roundRect) {
      gfx.roundRect(x, y, w, h, w / 2);
    } else {
      gfx.rect(x, y, w, h);
    }
    gfx.fill();
  }

  function draw(now) {
    requestAnimationFrame(draw);

    const d = window.devicePixelRatio || 1;
    const w = canvas.width;
    const h = canvas.height;
    const mid = h / 2;
    gfx.clearRect(0, 0, w, h);

    let level = 0;

    if (ctx) {
      // Suivi du pas en cours, synchronisé sur l'horloge audio
      while (state.queue.length && state.queue[0].time <= ctx.currentTime) {
        showStep(state.queue.shift().step);
      }
      analyser.getByteFrequencyData(freqData);

      let sum = 0;
      for (let i = 0; i < 12; i++) sum += freqData[i];
      level = Math.min(1, (sum / (12 * 255)) * 1.4);

      // Minuteur et barre de progression
      if (rec.on) {
        const elapsed = ctx.currentTime - rec.start;
        setTime(elapsed);
        if (elapsed >= MAX_REC) stopRecording();
      } else if (play.on) {
        const elapsed = Math.max(0, ctx.currentTime - play.start);
        setTime(Math.min(elapsed, rec.duration));
        fillEl.style.width = Math.min(100, (elapsed / Math.max(rec.duration, 0.1)) * 100) + '%';
      }
    }

    if (!REDUCED) setLevel(level);

    // Ligne centrale
    gfx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    gfx.fillRect(0, mid - d / 2, w, d);

    // Barres symétriques, du vert au violet
    const bars = 40;
    const gap = 4 * d;
    const barW = (w - gap * (bars - 1)) / bars;

    for (let i = 0; i < bars; i++) {
      let v = freqData ? freqData[i] / 255 : 0;

      // Léger souffle quand rien ne joue
      if (v < 0.03) v = REDUCED ? 0.03 : 0.03 + 0.02 * Math.sin(now / 600 + i / 3);

      const half = Math.max(2 * d, v * mid * 0.92);
      const color = 'hsl(' + (80 + i * 5.2) + ', 100%, ' + (52 + v * 12) + '%)';

      gfx.fillStyle = color;
      gfx.shadowColor = color;
      gfx.shadowBlur = v > 0.1 ? 10 * d * v : 0;
      bar(i * (barW + gap), mid - half, barW, half * 2);
    }

    gfx.shadowBlur = 0;
  }

  requestAnimationFrame(draw);

  /* ---------- État initial ---------- */

  applyVolume();
  applyFilter();
  applyEcho();
  applyTempo();
  updateLoopRead();
  updateButtons();
})();
