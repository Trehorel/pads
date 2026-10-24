(() => {
  'use strict';

  /* ---------- Banques et pads ---------- */

  // Touches du clavier, dans l'ordre des 16 pads d'une banque (4 lignes de 4)
  const KEYS = ['a', 'z', 'e', 'r', 'q', 's', 'd', 'f', 'w', 'x', 'c', 'v', 't', 'y', 'u', 'i'];

  // Chaque banque a 12 pads avec un son à eux ([nom, son]) et 4 boucles complètes ([nom, boucle]).
  // Le nom du son sert aussi d'identifiant à la boucle du pad : il doit être unique.
  const BANKS = [
    {
      name: 'Classique',
      rows: ['Batterie', 'Percussions', 'Synthés', 'Boucles complètes'],
      colors: ['#ff5c5c', '#ffb23c', '#3cd6ff', '#b57cff'],
      pads: [
        ['Kick', 'kick'], ['Snare', 'snare'], ['Clap', 'clap'], ['Hat', 'hat'],
        ['Open hat', 'openhat'], ['Tom', 'tom'], ['Rim', 'rim'], ['Cowbell', 'cowbell'],
        ['Basse', 'bass'], ['Accord', 'stab'], ['Pluck', 'pluck'], ['Laser', 'laser']
      ],
      loops: [['Beat', 'beat'], ['Hats', 'hats'], ['Bassline', 'bassline'], ['Arp', 'arp']]
    },
    {
      name: 'Électro',
      rows: ['Batterie', 'Percussions', 'Synthés', 'Boucles complètes'],
      colors: ['#ff4fd8', '#4f8bff', '#3cff9a', '#b6ff3c'],
      pads: [
        ['Kick 808', 'kick808'], ['Snare', 'snare2'], ['Clap', 'clap2'], ['Hat 909', 'hat909'],
        ['Rimshot', 'rimshot'], ['Conga', 'conga'], ['Shaker', 'shaker'], ['Tambo', 'tambo'],
        ['Sub', 'sub'], ['Supersaw', 'supersaw'], ['Acid', 'acid'], ['Zap', 'zap']
      ],
      loops: [['Four floor', 'fourfloor'], ['Acid line', 'acidline'], ['Disco', 'disco'], ['Rave', 'rave']]
    },
    {
      name: 'Lo-fi',
      rows: ['Batterie', 'Percussions', 'Instruments', 'Boucles complètes'],
      colors: ['#ff9f6b', '#e8c07a', '#8be28b', '#c79bff'],
      pads: [
        ['Boom', 'boombap'], ['Snap', 'snap'], ['Rim', 'rimlofi'], ['Hat lofi', 'hatlofi'],
        ['Vinyle', 'vinylpop'], ['Bongo', 'bongo'], ['Wood', 'wood'], ['Cloche', 'bell'],
        ['Rhodes', 'rhodes'], ['Fat bass', 'fatbass'], ['Scratch', 'scratch'], ['Chop', 'chop']
      ],
      loops: [['Boom bap', 'boombapbeat'], ['Accords', 'lofichords'], ['Poussière', 'dusty'], ['Mélodie', 'melody']]
    },
    {
      name: 'FX',
      rows: ['Effets', 'Bruitages', 'Instruments', 'Boucles complètes'],
      colors: ['#6ee7ff', '#ff7a7a', '#ffd84f', '#b57cff'],
      pads: [
        ['Riser', 'riser'], ['Impact', 'impact'], ['Sirène', 'siren'], ['Glitch', 'glitch'],
        ['Bulle', 'bubble'], ['Coin', 'coin'], ['Drop', 'drop'], ['Whoosh', 'whoosh'],
        ['Marimba', 'marimba'], ['Kalimba', 'kalimba'], ['Gong', 'gong'], ['Chœur', 'choir']
      ],
      loops: [['Ambiance', 'ambient'], ['Tension', 'tension'], ['Arcade', 'arcade'], ['Monde', 'world']]
    },
    {
      name: 'DJ',
      rows: ['Effets DJ', 'Voix et foule', 'Drops', 'Boucles complètes'],
      colors: ['#ffe14a', '#4affb8', '#ff5ca8', '#8f7bff'],
      pads: [
        ['Airhorn', 'airhorn'], ['Rewind', 'rewind'], ['Scratch', 'scratchbaby'], ['Transform', 'scratchtrans'],
        ['Hey', 'voxhey'], ['Ooh', 'voxooh'], ['Foule', 'crowd'], ['Sifflet', 'whistle'],
        ['Build', 'build'], ['Bass drop', 'bassdrop'], ['Stutter', 'stutter'], ['Woop', 'woop']
      ],
      loops: [['House', 'djhouse'], ['Build-up', 'djbuild'], ['Drop', 'djdrop'], ['Cuts', 'djscratch']]
    }
  ];

  // Liste à plat des 80 pads : l'indice d'un pad est banque × 16 + position
  const PADS = [];

  BANKS.forEach((b, bankIndex) => {
    b.pads.forEach(([name, sound], p) => {
      PADS.push({
        name,
        key: KEYS[p],
        type: 'hit',
        sound,
        loop: sound,
        color: b.colors[Math.floor(p / 4)],
        bank: bankIndex
      });
    });

    b.loops.forEach(([name, loop], k) => {
      PADS.push({
        name,
        key: KEYS[12 + k],
        type: 'loop',
        loop,
        color: b.colors[3],
        bank: bankIndex
      });
    });
  });

  let bank = 0; // banque affichée

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

  // true : un appui joue un seul coup ; false : un appui lance ou coupe la boucle du pad
  let oneShot = false;

  /* ---------- Sons personnels ---------- */

  const MAX_SAMPLE_BYTES = 15 * 1024 * 1024; // 15 Mo
  const MAX_SAMPLE_SECONDS = 10;

  const samples = new Array(PADS.length).fill(null); // { buffer, label } par pad
  let editing = false;
  let pickIndex = -1;

  /* ---------- Séquenceur ---------- */

  // Rythmes dessinés par la personne : identifiant de boucle -> 16 pas ({ vol, freq } ou null)
  const userPatterns = {};
  let sequencing = false;
  let seqPad = -1; // pad en cours d'édition dans le séquenceur

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
    timeouts: [],
    saved: null
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
  let audioExt = EXT;
  let userRecorded = false; // vrai dès qu'on a lancé un enregistrement pendant cette visite

  /* ---------- Éléments de la page ---------- */

  const gridEl = document.getElementById('grid');
  const stepsEl = document.getElementById('steps');
  const banksEl = document.getElementById('banks');
  const legendEl = document.getElementById('legend');
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

  const modeBtn = document.getElementById('modeBtn');
  const seqBtn = document.getElementById('seqBtn');
  const editBtn = document.getElementById('editBtn');
  const editHint = document.getElementById('editHint');
  const resetSamples = document.getElementById('resetSamples');
  const resetAll = document.getElementById('resetAll');
  const fileInput = document.getElementById('fileInput');
  const toastEl = document.getElementById('toast');

  const seqPanel = document.getElementById('seqPanel');
  const seqPadLabel = document.getElementById('seqPad');
  const seqGrid = document.getElementById('seqGrid');
  const seqPlay = document.getElementById('seqPlay');
  const seqClear = document.getElementById('seqClear');
  const seqReset = document.getElementById('seqReset');

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
  const bankEls = [];
  const seqCells = [];

  if (!MIME) dlBtn.hidden = true;

  // Réglages qui sont enregistrés avec la performance
  const FX = {
    volume: { input: volume, apply: applyVolume },
    filter: { input: filterSlider, apply: applyFilter },
    echo:   { input: echo, apply: applyEcho }
  };

  /* ---------- Messages ---------- */

  let toastTimer = null;

  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  /* ---------- Sauvegarde dans le navigateur ---------- */

  // Petites données (réglages, performance, rythmes) : localStorage
  const LS_SETTINGS = 'pads.settings.v1';
  const LS_REC = 'pads.rec.v1';
  const LS_PATTERNS = 'pads.patterns.v1';

  function lsGet(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch (err) {
      return null;
    }
  }

  function lsSet(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  function lsDel(key) {
    try {
      localStorage.removeItem(key);
    } catch (err) {
      // stockage indisponible : rien à effacer
    }
  }

  // Fichiers audio (sons perso, dernier enregistrement) : IndexedDB
  const DB_NAME = 'pads-db';
  const STORE = 'blobs';
  let dbPromise = null;

  function openDb() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        if (!window.indexedDB) {
          reject(new Error('IndexedDB indisponible'));
          return;
        }

        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  function dbRun(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }));
  }

  const dbGet = (key) => dbRun('readonly', (store) => store.get(key));
  const dbSet = (key, value) => dbRun('readwrite', (store) => store.put(value, key));
  const dbDel = (key) => dbRun('readwrite', (store) => store.delete(key));
  const dbClear = () => dbRun('readwrite', (store) => store.clear());

  // Demande au navigateur de ne pas effacer nos données quand il manque de place
  function requestPersist() {
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  }

  // Décode un fichier audio sans avoir besoin de lancer le son
  function decodeAudio(data) {
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const decoder = new Offline(1, 1, 44100);
    return new Promise((resolve, reject) => decoder.decodeAudioData(data, resolve, reject));
  }

  // Réglages : sauvegardés un court instant après le dernier changement
  let saveTimer = null;

  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Pendant une lecture, on garde les réglages d'avant la lecture
      const live = (name) => (play.saved ? play.saved[name] : FX[name].input.value);

      lsSet(LS_SETTINGS, {
        bank,
        oneShot,
        volume: live('volume'),
        filter: live('filter'),
        echo: live('echo'),
        tempo: tempo.value,
        loopPlay: loopPlay.checked
      });
    }, 300);
  }

  function saveRecording() {
    const ok = lsSet(LS_REC, { events: rec.events, duration: rec.duration, bpm: rec.bpm });
    if (!ok) toast('Performance non sauvegardée (espace insuffisant).');
  }

  function savePatterns() {
    if (Object.keys(userPatterns).length === 0) {
      lsDel(LS_PATTERNS);
      return;
    }
    if (!lsSet(LS_PATTERNS, userPatterns)) toast('Rythmes non sauvegardés (espace insuffisant).');
  }

  function restoreSettings() {
    const s = lsGet(LS_SETTINGS);
    if (!s || typeof s !== 'object') return;

    const setRange = (input, value) => {
      if (value !== undefined && value !== null && !Number.isNaN(Number(value))) input.value = value;
    };

    setRange(volume, s.volume);
    setRange(filterSlider, s.filter);
    setRange(echo, s.echo);
    setRange(tempo, s.tempo);
    loopPlay.checked = Boolean(s.loopPlay);
    setOneShot(Boolean(s.oneShot), true);

    if (Number.isInteger(s.bank) && s.bank >= 0 && s.bank < BANKS.length) bank = s.bank;
  }

  function restoreRecording() {
    const saved = lsGet(LS_REC);
    if (!saved || !Array.isArray(saved.events)) return;

    // On ne garde que les actions qu'on sait encore rejouer
    rec.events = saved.events.filter((ev) => ev && typeof ev.t === 'number' && (
      (ev.kind === 'fx' && FX[ev.name]) ||
      ((ev.kind === 'hit' || ev.kind === 'loop') && PADS[ev.i])
    ));
    rec.duration = Number(saved.duration) || 0;
    rec.bpm = Number(saved.bpm) || 110;

    renderTimeline();
    setTime(rec.duration);
    idleStatus();
  }

  function restorePatterns() {
    const saved = lsGet(LS_PATTERNS);
    if (!saved || typeof saved !== 'object') return;

    Object.keys(saved).forEach((id) => {
      const steps = saved[id];

      const valid = LOOP_PAD[id] !== undefined &&
        Array.isArray(steps) &&
        steps.length === 16 &&
        steps.every((st) => st === null || (st && typeof st.vol === 'number' && (st.freq === null || typeof st.freq === 'number')));

      if (valid) userPatterns[id] = steps;
    });
  }

  // Sons perso et fichier de la dernière performance (chargés en arrière-plan)
  async function restoreFromStorage() {
    let count = 0;

    try {
      await openDb();

      for (let i = 0; i < PADS.length; i++) {
        if (PADS[i].type !== 'hit' || samples[i]) continue;

        const saved = await dbGet('sample:' + PADS[i].loop);
        if (!saved || !saved.data) continue;

        try {
          samples[i] = { buffer: await decodeAudio(saved.data.slice(0)), label: saved.label };
          count++;
        } catch (err) {
          // fichier abîmé : on l'ignore
        }
      }

      if (count) refreshAll();

      const savedAudio = await dbGet('rec-audio');
      if (savedAudio && savedAudio.data && !userRecorded && !audioUrl) {
        audioUrl = URL.createObjectURL(new Blob([savedAudio.data], { type: savedAudio.type }));
        audioExt = savedAudio.ext || 'webm';
        updateButtons();
      }
    } catch (err) {
      // stockage indisponible (navigation privée, par exemple) : le site marche sans sauvegarde
    }

    if (count || hasActions() || Object.keys(userPatterns).length) {
      toast('Ta dernière session a été restaurée.');
    }
  }

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

    // Bruit blanc réutilisé pour les caisses claires, charlestons, claps, effets
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

  // Oscillateur avec enveloppe qui décroît (et glissando optionnel de f0 vers f1)
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

  // Petit souffle de bruit filtré
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

  // Bruit dont le filtre glisse de f0 vers f1 (montée si up, sinon descente)
  function sweepNoise(t, out, { f0, f1, dur = 0.5, q = 2, vol = 0.5, up = false }) {
    const s = ctx.createBufferSource();
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    s.buffer = noiseBuf;
    s.loop = true;
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);

    if (up) {
      g.gain.setValueAtTime(0.01, t);
      g.gain.exponentialRampToValueAtTime(vol, t + dur);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    } else {
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    }

    s.connect(f).connect(g).connect(out);
    s.start(t);
    s.stop(t + dur + 0.1);
  }

  // Plusieurs notes jouées ensemble à travers un filtre passe-bas
  function chord(t, out, freqs, { type = 'sawtooth', cutoff = 2000, dur = 0.3, vol = 0.12 }) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.connect(out);
    freqs.forEach((fr) => tone(t, lp, { type, f0: fr, dur, vol }));
  }

  // Petit tremblement de la hauteur d'un oscillateur (vibrato)
  function addVibrato(osc, t, dur, rate, depth) {
    const lfo = ctx.createOscillator();
    const amount = ctx.createGain();
    lfo.frequency.value = rate;
    amount.gain.value = depth;
    lfo.connect(amount).connect(osc.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.05);
  }

  // Voix synthétique : une note passe par des filtres qui imitent les voyelles.
  // formants : [[début, fin, netteté], ...] en Hz, vibrato : [vitesse, profondeur]
  function vowel(t, out, { f0, f1 = f0, formants, dur = 0.3, vol = 1, attack = 0.02, vibrato = null }) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur);

    if (vibrato) addVibrato(o, t, dur, vibrato[0], vibrato[1]);

    formants.forEach(([from, to, q]) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.setValueAtTime(from, t);
      bp.frequency.linearRampToValueAtTime(to, t + dur);
      o.connect(bp).connect(g);
    });

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    g.connect(out);

    o.start(t);
    o.stop(t + dur + 0.05);
  }

  /* ---------- Sons ---------- */

  const SOUNDS = {
    /* ----- Classique ----- */

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
      chord(t, out, [220, 277.2, 329.6], { cutoff: 1800, dur: 0.25, vol: 0.12 * v });
    },

    pluck(t, out, f = 659.3, v = 1) {
      tone(t, out, { type: 'triangle', f0: f, dur: 0.25, vol: 0.35 * v });
    },

    laser(t, out, f, v = 1) {
      tone(t, out, { type: 'sawtooth', f0: 1800, f1: 80, dur: 0.35, vol: 0.25 * v });
    },

    /* ----- Électro ----- */

    kick808(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 120, f1: 38, dur: 0.9, vol: v });
    },

    snare2(t, out, f, v = 1) {
      tone(t, out, { type: 'triangle', f0: 330, f1: 180, dur: 0.12, vol: 0.5 * v });
      burst(t, out, { type: 'highpass', freq: 2500, dur: 0.25, vol: 0.9 * v });
    },

    clap2(t, out, f, v = 1) {
      for (let i = 0; i < 4; i++) {
        burst(t + i * 0.01, out, { type: 'bandpass', freq: 1200, q: 0.8, dur: 0.02, vol: 0.6 * v });
      }
      burst(t + 0.04, out, { type: 'bandpass', freq: 1200, q: 0.8, dur: 0.3, vol: 0.7 * v });
    },

    hat909(t, out, f, v = 1) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      hp.connect(out);
      [2093, 3136, 3520, 4186, 5920].forEach((fr) => {
        tone(t, hp, { type: 'square', f0: fr, dur: 0.06, vol: 0.05 * v });
      });
    },

    rimshot(t, out, f, v = 1) {
      tone(t, out, { type: 'square', f0: 1700, dur: 0.02, vol: 0.3 * v });
      tone(t, out, { type: 'square', f0: 480, dur: 0.03, vol: 0.3 * v });
      burst(t, out, { type: 'bandpass', freq: 2500, dur: 0.03, vol: 0.4 * v });
    },

    conga(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 330, f1: 240, dur: 0.22, vol: 0.8 * v });
      burst(t, out, { type: 'bandpass', freq: 1800, dur: 0.01, vol: 0.2 * v });
    },

    shaker(t, out, f, v = 1) {
      burst(t, out, { type: 'bandpass', freq: 6500, q: 1.5, dur: 0.09, vol: 0.45 * v });
    },

    tambo(t, out, f, v = 1) {
      burst(t, out, { type: 'highpass', freq: 4000, dur: 0.18, vol: 0.35 * v });
      burst(t, out, { type: 'bandpass', freq: 9000, dur: 0.1, vol: 0.25 * v });
    },

    sub(t, out, f = 41.2, v = 1) {
      tone(t, out, { type: 'sine', f0: f, dur: 0.8, vol: 0.9 * v });
    },

    supersaw(t, out, f = 220, v = 1) {
      const notes = [f, f * 1.5, f * 2].flatMap((fr) => [fr * 0.994, fr, fr * 1.006]);
      chord(t, out, notes, { cutoff: 3500, dur: 0.5, vol: 0.05 * v });
    },

    acid(t, out, f = 110, v = 1) {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.value = f;
      lp.type = 'lowpass';
      lp.Q.value = 14;
      lp.frequency.setValueAtTime(1800, t);
      lp.frequency.exponentialRampToValueAtTime(200, t + 0.25);
      g.gain.setValueAtTime(0.4 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.32);
    },

    zap(t, out, f, v = 1) {
      tone(t, out, { type: 'square', f0: 1200, f1: 100, dur: 0.15, vol: 0.2 * v });
      tone(t, out, { type: 'sawtooth', f0: 2400, f1: 200, dur: 0.1, vol: 0.15 * v });
    },

    /* ----- Lo-fi ----- */

    boombap(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 110, f1: 48, dur: 0.35, vol: v });
      burst(t, out, { type: 'lowpass', freq: 800, dur: 0.02, vol: 0.3 * v });
    },

    snap(t, out, f, v = 1) {
      burst(t, out, { type: 'bandpass', freq: 2200, q: 2, dur: 0.07, vol: 0.7 * v });
      tone(t, out, { type: 'triangle', f0: 1300, dur: 0.03, vol: 0.15 * v });
    },

    rimlofi(t, out, f, v = 1) {
      tone(t, out, { type: 'triangle', f0: 600, dur: 0.05, vol: 0.35 * v });
      burst(t, out, { type: 'bandpass', freq: 1800, dur: 0.03, vol: 0.3 * v });
    },

    hatlofi(t, out, f, v = 1) {
      burst(t, out, { type: 'highpass', freq: 5500, dur: 0.045, vol: 0.35 * v });
    },

    vinylpop(t, out, f, v = 1) {
      burst(t, out, { type: 'lowpass', freq: 1200, dur: 0.03, vol: 0.5 * v });
      burst(t, out, { type: 'highpass', freq: 3000, dur: 0.02, vol: 0.2 * v });
    },

    bongo(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 420, f1: 330, dur: 0.14, vol: 0.7 * v });
    },

    wood(t, out, f, v = 1) {
      tone(t, out, { type: 'triangle', f0: 880, dur: 0.08, vol: 0.4 * v });
      tone(t, out, { type: 'sine', f0: 1320, dur: 0.04, vol: 0.15 * v });
    },

    bell(t, out, f = 880, v = 1) {
      tone(t, out, { type: 'sine', f0: f, dur: 1.0, vol: 0.25 * v });
      tone(t, out, { type: 'sine', f0: f * 1.5, dur: 0.8, vol: 0.15 * v });
      tone(t, out, { type: 'sine', f0: f * 2.52, dur: 0.5, vol: 0.08 * v });
    },

    rhodes(t, out, f, v = 1) {
      chord(t, out, [261.6, 329.6, 392, 493.9], { type: 'sine', cutoff: 2500, dur: 0.9, vol: 0.11 * v });
      chord(t, out, [523.2, 659.2], { type: 'sine', cutoff: 2500, dur: 0.5, vol: 0.03 * v });
    },

    fatbass(t, out, f = 55, v = 1) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 260;
      lp.connect(out);
      tone(t, lp, { type: 'sawtooth', f0: f, dur: 0.5, vol: 0.5 * v });
      tone(t, lp, { type: 'sawtooth', f0: f * 1.005, dur: 0.5, vol: 0.4 * v });
    },

    scratch(t, out, f, v = 1) {
      sweepNoise(t, out, { f0: 600, f1: 2400, dur: 0.12, q: 6, vol: 0.5 * v });
      sweepNoise(t + 0.12, out, { f0: 2400, f1: 500, dur: 0.14, q: 6, vol: 0.5 * v });
    },

    chop(t, out, f = 196, v = 1) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 3;
      bp.connect(out);
      tone(t, bp, { type: 'sawtooth', f0: f, dur: 0.22, vol: 0.4 * v });
    },

    /* ----- FX ----- */

    riser(t, out, f, v = 1) {
      sweepNoise(t, out, { f0: 300, f1: 7000, dur: 1.4, q: 2, vol: 0.5 * v, up: true });
    },

    impact(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 90, f1: 28, dur: 1.2, vol: v });
      burst(t, out, { type: 'lowpass', freq: 600, dur: 1.2, vol: 0.6 * v });
    },

    siren(t, out, f, v = 1) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(600, t);
      o.frequency.linearRampToValueAtTime(1000, t + 0.4);
      o.frequency.linearRampToValueAtTime(600, t + 0.8);
      g.gain.setValueAtTime(0.2 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.85);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.9);
    },

    glitch(t, out, f, v = 1) {
      for (let k = 0; k < 6; k++) {
        tone(t + k * 0.03, out, { type: 'square', f0: 200 + k * 250, dur: 0.03, vol: 0.1 * v });
      }
    },

    bubble(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 300, f1: 900, dur: 0.12, vol: 0.35 * v });
    },

    coin(t, out, f, v = 1) {
      tone(t, out, { type: 'square', f0: 988, dur: 0.08, vol: 0.15 * v });
      tone(t + 0.08, out, { type: 'square', f0: 1319, dur: 0.35, vol: 0.15 * v });
    },

    drop(t, out, f, v = 1) {
      tone(t, out, { type: 'sine', f0: 400, f1: 40, dur: 0.7, vol: 0.8 * v });
    },

    whoosh(t, out, f, v = 1) {
      sweepNoise(t, out, { f0: 400, f1: 3000, dur: 0.5, q: 1, vol: 0.5 * v, up: true });
    },

    marimba(t, out, f = 523.3, v = 1) {
      tone(t, out, { type: 'sine', f0: f, dur: 0.35, vol: 0.5 * v });
      tone(t, out, { type: 'sine', f0: f * 4, dur: 0.1, vol: 0.15 * v });
    },

    kalimba(t, out, f = 784, v = 1) {
      tone(t, out, { type: 'sine', f0: f, dur: 0.6, vol: 0.4 * v });
      tone(t, out, { type: 'sine', f0: f * 2.76, dur: 0.15, vol: 0.12 * v });
    },

    gong(t, out, f, v = 1) {
      [110, 150.4, 222, 334].forEach((fr) => {
        tone(t, out, { type: 'sine', f0: fr, dur: 2, vol: 0.13 * v });
      });
    },

    choir(t, out, f = 196, v = 1) {
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      bp.type = 'bandpass';
      bp.frequency.value = 900;
      bp.Q.value = 1.2;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.5 * v, t + 0.2);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      bp.connect(g).connect(out);
      [f, f * 1.26, f * 1.5].forEach((fr, k) => {
        tone(t, bp, { type: 'sawtooth', f0: fr * (1 + (k - 1) * 0.004), dur: 0.9, vol: 0.2 });
      });
    },

    /* ----- DJ ----- */

    // Le klaxon de DJ : plusieurs notes de cuivre qui montent en un instant
    airhorn(t, out, f, v = 1) {
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      lp.type = 'lowpass';
      lp.frequency.value = 3200;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.12 * v, t + 0.03);
      g.gain.setValueAtTime(0.12 * v, t + 0.45);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
      lp.connect(g).connect(out);

      [392, 494, 587, 784].forEach((fr, k) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(fr * 0.93, t);
        o.frequency.exponentialRampToValueAtTime(fr, t + 0.06);
        o.detune.value = (k - 1.5) * 6;
        o.connect(lp);
        o.start(t);
        o.stop(t + 0.8);
      });
    },

    // Le disque qu'on rembobine : la hauteur s'effondre
    rewind(t, out, f, v = 1) {
      tone(t, out, { type: 'sawtooth', f0: 1400, f1: 50, dur: 0.55, vol: 0.18 * v });
      sweepNoise(t, out, { f0: 5000, f1: 250, dur: 0.55, q: 1.5, vol: 0.35 * v });
    },

    // Un aller-retour de scratch
    scratchbaby(t, out, f, v = 1) {
      const o = ctx.createOscillator();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(900, t + 0.09);
      o.frequency.exponentialRampToValueAtTime(250, t + 0.2);
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 3;
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
      o.connect(bp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.24);
      burst(t, out, { type: 'bandpass', freq: 3000, dur: 0.05, vol: 0.15 * v });
    },

    // Scratch haché : le son est coupé et relancé quatre fois très vite
    scratchtrans(t, out, f, v = 1) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      bp.Q.value = 2;
      bp.connect(out);

      for (let k = 0; k < 4; k++) {
        tone(t + k * 0.07, bp, { type: 'sawtooth', f0: 300, f1: 700, dur: 0.055, vol: 0.5 * v });
      }
    },

    // « Hey ! » : une voix qui passe du « é » au « a »
    voxhey(t, out, f, v = 1) {
      burst(t, out, { type: 'highpass', freq: 3000, dur: 0.04, vol: 0.2 * v });
      vowel(t, out, {
        f0: 210,
        f1: 170,
        formants: [[450, 650, 6], [2000, 1300, 8]],
        dur: 0.3,
        vol: 1.2 * v,
        attack: 0.03
      });
    },

    // « Ooh » tenu, avec un léger vibrato
    voxooh(t, out, f, v = 1) {
      vowel(t, out, {
        f0: 196,
        formants: [[300, 300, 6], [800, 800, 8]],
        dur: 0.8,
        vol: 1.1 * v,
        attack: 0.12,
        vibrato: [5.5, 4]
      });
    },

    // Acclamations de la foule : deux couches de bruit qui gonflent puis retombent
    crowd(t, out, f, v = 1) {
      [[1500, 0.7, 0.35], [3200, 1, 0.2]].forEach(([freq, q, vol]) => {
        const s = ctx.createBufferSource();
        const bp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        s.buffer = noiseBuf;
        s.loop = true;
        bp.type = 'bandpass';
        bp.frequency.value = freq;
        bp.Q.value = q;
        g.gain.setValueAtTime(0.001, t);
        g.gain.linearRampToValueAtTime(vol * v, t + 0.3);
        g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
        s.connect(bp).connect(g).connect(out);
        s.start(t);
        s.stop(t + 1.6);
      });
    },

    // Sifflet de DJ
    whistle(t, out, f, v = 1) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(2400, t);
      o.frequency.linearRampToValueAtTime(3100, t + 0.15);
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(0.22 * v, t + 0.02);
      g.gain.setValueAtTime(0.22 * v, t + 0.3);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
      addVibrato(o, t, 0.45, 12, 50);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.47);
    },

    // Roulement de caisse claire qui accélère et monte en puissance
    build(t, out, f, v = 1) {
      let at = 0;
      let gap = 0.22;
      let vol = 0.2;

      while (at < 1.5) {
        burst(t + at, out, { type: 'highpass', freq: 2000, dur: 0.07, vol: v * vol });
        tone(t + at, out, { type: 'triangle', f0: 220, f1: 150, dur: 0.08, vol: 0.25 * vol * v });
        at += gap;
        gap = Math.max(0.035, gap * 0.82);
        vol = Math.min(1, vol + 0.07);
      }
    },

    // Grosse basse qui s'écroule
    bassdrop(t, out, f, v = 1) {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(110, t);
      o.frequency.exponentialRampToValueAtTime(35, t + 1.0);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(1200, t);
      lp.frequency.exponentialRampToValueAtTime(120, t + 1.0);
      g.gain.setValueAtTime(0.5 * v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.35);
      tone(t, out, { type: 'sine', f0: 60, f1: 28, dur: 1.3, vol: 0.8 * v });
    },

    // Petites notes répétées de plus en plus aiguës
    stutter(t, out, f, v = 1) {
      for (let k = 0; k < 6; k++) {
        tone(t + k * 0.055, out, { type: 'square', f0: 330 + k * 40, dur: 0.04, vol: 0.12 * v });
      }
    },

    // Sirène « woop woop » : trois montées rapides
    woop(t, out, f, v = 1) {
      const o = ctx.createOscillator();
      const lp = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'square';

      for (let k = 0; k < 3; k++) {
        o.frequency.setValueAtTime(500, t + k * 0.22);
        o.frequency.exponentialRampToValueAtTime(1400, t + k * 0.22 + 0.2);
      }

      lp.type = 'lowpass';
      lp.frequency.value = 3000;
      g.gain.setValueAtTime(0.14 * v, t);
      g.gain.setValueAtTime(0.14 * v, t + 0.55);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.72);
    }
  };

  // Joue le son d'un pad : le son personnel s'il y en a un, sinon le son d'origine
  function playPad(i, t, v = 1, f = undefined) {
    const sample = samples[i];

    if (sample) {
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;

      if (v !== 1) {
        const g = ctx.createGain();
        g.gain.value = v;
        src.connect(g).connect(filter);
      } else {
        src.connect(filter);
      }

      src.start(t, 0, Math.min(sample.buffer.duration, MAX_SAMPLE_SECONDS));
    } else {
      SOUNDS[PADS[i].sound](t, filter, f, v);
    }
  }

  /* ---------- Boucles (16 pas) ---------- */

  // Construit le rythme d'un son : chaque élément est un numéro de pas,
  // ou [pas, volume, fréquence]
  function pat(sound, steps) {
    const map = new Map();

    steps.forEach((item) => {
      const [step, vol = 1, freq = null] = Array.isArray(item) ? item : [item];
      map.set(step, [sound, freq, vol]);
    });

    return (s) => (map.has(s) ? [map.get(s)] : []);
  }

  // Superpose plusieurs rythmes
  const mix = (...fns) => (s) => fns.flatMap((fn) => fn(s));

  const ALL16 = Array.from({ length: 16 }, (_, s) => s);
  const EVENS = ALL16.filter((s) => s % 2 === 0);
  const ODDS = ALL16.filter((s) => s % 2 === 1);

  const BASS_LINE = [55, 0, 0, 55, 0, 0, 65.4, 0, 0, 55, 0, 73.4, 0, 0, 65.4, 0];
  const ARP_NOTES = [440, 523.3, 659.3, 784, 659.3, 523.3, 440, 392];
  const ACID_LINE = [110, 0, 110, 165, 0, 110, 131, 0, 110, 0, 165, 0, 147, 0, 131, 0];
  const ACID_STEPS = ACID_LINE.map((fr, s) => (fr ? [s, 1, fr] : null)).filter(Boolean);
  const MARIMBA_STEPS = [[0, 1, 523.3], [2, 0.8, 659.3], [4, 0.8, 784], [8, 1, 659.3], [10, 0.8, 523.3], [12, 0.8, 392]];
  const KALIMBA_STEPS = [[1, 0.8, 784], [3, 0.7, 988], [5, 0.7, 880], [9, 0.8, 784], [11, 0.7, 659.3], [14, 0.7, 880]];

  // Chaque boucle renvoie, pour un pas donné, une liste de [son, fréquence, volume]
  const LOOPS = {
    /* ----- Classique : un rythme par pad ----- */
    kick:    pat('kick',    [0, 4, 8, 12]),
    snare:   pat('snare',   [4, 12, [7, 0.35], [15, 0.35]]),
    clap:    pat('clap',    [6, 14]),
    hat:     pat('hat',     EVENS),
    openhat: pat('openhat', [[2, 0.7], [6, 0.7], [10, 0.7], [14, 0.7]]),
    tom:     pat('tom',     [[3, 0.8], [6, 0.8], [11, 0.8]]),
    rim:     pat('rim',     [2, 5, 10, 13]),
    cowbell: pat('cowbell', [[3, 0.8], [6, 0.8], [10, 0.8], [14, 0.8]]),
    bass:    pat('bass',    [[0, 1, 55], [6, 1, 55], [10, 1, 65.4]]),
    stab:    pat('stab',    [2, 10, 14]),
    pluck:   pat('pluck',   [[0, 1, 659.3], [3, 1, 784], [6, 1, 880], [8, 1, 659.3], [11, 1, 784], [14, 1, 988]]),
    laser:   pat('laser',   [[12, 0.8]]),

    /* ----- Classique : boucles complètes ----- */
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

    bassline(s) {
      return BASS_LINE[s] ? [['bass', BASS_LINE[s]]] : [];
    },

    arp(s) {
      return s % 2 === 0 ? [['pluck', ARP_NOTES[(s / 2) % 8]]] : [];
    },

    /* ----- Électro ----- */
    kick808: pat('kick808', [0, [7, 0.8], 10]),
    snare2:  pat('snare2',  [4, 12]),
    clap2:   pat('clap2',   [4, [10, 0.6], 12]),
    hat909:  pat('hat909',  [2, 6, 10, 14]),
    rimshot: pat('rimshot', [[3, 0.7], [7, 0.7], [11, 0.7]]),
    conga:   pat('conga',   [[0, 0.8], [3, 0.7], [6, 0.8], [10, 0.7], [13, 0.8]]),
    shaker:  pat('shaker',  ALL16.map((s) => [s, s % 2 ? 0.5 : 0.9])),
    tambo:   pat('tambo',   [4, 12]),
    sub:     pat('sub',     [[0, 1, 41.2], [6, 0.9, 41.2], [10, 0.9, 49]]),
    supersaw: pat('supersaw', [[0, 1, 220], [6, 1, 261.6], [10, 1, 196]]),
    acid:    pat('acid',    ACID_STEPS),
    zap:     pat('zap',     [[14, 0.7]]),

    fourfloor: mix(pat('kick', [0, 4, 8, 12]), pat('clap2', [4, 12]), pat('hat909', [2, 6, 10, 14])),
    acidline:  mix(pat('acid', ACID_STEPS), pat('kick', [0, 4, 8, 12])),
    disco:     mix(pat('hat909', [2, 6, 10, 14]), pat('shaker', ODDS.map((s) => [s, 0.4])), pat('conga', [[3, 0.7], [10, 0.7]])),
    rave:      mix(
      pat('supersaw', [[0, 1, 220], [3, 1, 220], [6, 1, 261.6], [10, 1, 196], [14, 1, 196]]),
      pat('zap', [15])
    ),

    /* ----- Lo-fi ----- */
    boombap:  pat('boombap',  [0, [7, 0.8], 10]),
    snap:     pat('snap',     [4, 12]),
    rimlofi:  pat('rimlofi',  [[2, 0.6], [9, 0.6], [14, 0.6]]),
    hatlofi:  pat('hatlofi',  EVENS.map((s) => [s, s % 4 ? 0.6 : 0.9])),
    vinylpop: pat('vinylpop', [[1, 0.5], [6, 0.4], [11, 0.5], [13, 0.35]]),
    bongo:    pat('bongo',    [[3, 0.8], [5, 0.6], [11, 0.8], [14, 0.6]]),
    wood:     pat('wood',     [[2, 0.7], [7, 0.6], [12, 0.7]]),
    bell:     pat('bell',     [[0, 0.7, 880], [6, 0.6, 988], [10, 0.6, 740]]),
    rhodes:   pat('rhodes',   [[0, 1], [8, 0.8]]),
    fatbass:  pat('fatbass',  [[0, 1, 55], [3, 0.8, 55], [7, 0.9, 65.4], [10, 0.9, 49]]),
    scratch:  pat('scratch',  [[13, 0.8]]),
    chop:     pat('chop',     [[2, 0.8, 196], [5, 0.6, 196], [11, 0.8, 233]]),

    boombapbeat: mix(pat('boombap', [0, [7, 0.8], 10]), pat('snap', [4, 12]), pat('hatlofi', EVENS.map((s) => [s, 0.6]))),
    lofichords:  mix(pat('rhodes', [0, [8, 0.8]]), pat('fatbass', [[0, 1, 55], [10, 0.9, 49]])),
    dusty:       mix(pat('hatlofi', [2, 6, 10, 14]), pat('vinylpop', [[1, 0.5], [6, 0.4], [11, 0.5]]), pat('rimlofi', [[9, 0.6]])),
    melody:      mix(
      pat('bell', [[0, 0.7, 880], [3, 0.6, 988], [6, 0.6, 1175], [10, 0.6, 988], [13, 0.6, 880]]),
      pat('wood', [[8, 0.5]])
    ),

    /* ----- FX ----- */
    riser:    pat('riser',    [[0, 0.8]]),
    impact:   pat('impact',   [0]),
    siren:    pat('siren',    [[0, 0.8]]),
    glitch:   pat('glitch',   [[6, 0.8], [11, 0.7], [15, 0.6]]),
    bubble:   pat('bubble',   [[2, 0.7], [5, 0.6], [9, 0.7], [12, 0.5]]),
    coin:     pat('coin',     [[0, 0.8], [8, 0.7]]),
    drop:     pat('drop',     [[12, 0.8]]),
    whoosh:   pat('whoosh',   [[14, 0.7]]),
    marimba:  pat('marimba',  MARIMBA_STEPS),
    kalimba:  pat('kalimba',  KALIMBA_STEPS),
    gong:     pat('gong',     [[0, 0.9]]),
    choir:    pat('choir',    [[0, 0.9, 196], [8, 0.9, 220]]),

    ambient: mix(pat('gong', [[0, 0.7]]), pat('kalimba', KALIMBA_STEPS), pat('choir', [[0, 0.7, 196]])),
    tension: mix(pat('riser', [[0, 0.8]]), pat('glitch', [[12, 0.5], [14, 0.5], [15, 0.5]])),
    arcade:  mix(pat('coin', [0, 8]), pat('bubble', [[3, 0.6], [6, 0.5], [11, 0.6]]), pat('glitch', [[14, 0.5]])),
    world:   mix(pat('marimba', MARIMBA_STEPS), pat('conga', [[0, 0.7], [6, 0.7], [10, 0.7]]), pat('shaker', ODDS.map((s) => [s, 0.4]))),

    /* ----- DJ : un rythme par pad ----- */
    airhorn:      pat('airhorn',      [[0, 0.9], [3, 0.7], [6, 0.7]]),
    rewind:       pat('rewind',       [[12, 0.8]]),
    scratchbaby:  pat('scratchbaby',  [[2, 0.8], [5, 0.7], [9, 0.8], [13, 0.7]]),
    scratchtrans: pat('scratchtrans', [[6, 0.8], [14, 0.8]]),
    voxhey:       pat('voxhey',       [[4, 0.9], [12, 0.9]]),
    voxooh:       pat('voxooh',       [[0, 0.7], [8, 0.7]]),
    crowd:        pat('crowd',        [[0, 0.8]]),
    whistle:      pat('whistle',      [[10, 0.8]]),
    build:        pat('build',        [[0, 0.9]]),
    bassdrop:     pat('bassdrop',     [[0, 1]]),
    stutter:      pat('stutter',      [[3, 0.8], [11, 0.8]]),
    woop:         pat('woop',         [[0, 0.8], [8, 0.7]]),

    /* ----- DJ : boucles complètes ----- */
    djhouse: mix(
      pat('kick', [0, 4, 8, 12]),
      pat('clap', [4, 12]),
      pat('openhat', [[2, 0.7], [6, 0.7], [10, 0.7], [14, 0.7]]),
      pat('hat', ODDS.map((s) => [s, 0.4])),
      pat('bass', [[2, 0.9, 55], [6, 0.9, 55], [10, 0.9, 65.4], [14, 0.9, 55]])
    ),
    djbuild: mix(
      pat('snare', ALL16.map((s) => [s, 0.2 + s * 0.05])),
      pat('riser', [[0, 0.7]]),
      pat('kick', [0, 4, 8, 12])
    ),
    djdrop: mix(
      pat('impact', [0]),
      pat('kick808', [0, [7, 0.8], 10]),
      pat('clap2', [4, 12]),
      pat('sub', [[0, 1, 41.2], [6, 0.9, 41.2], [10, 0.9, 49]]),
      pat('hat909', [2, 6, 10, 14])
    ),
    djscratch: mix(
      pat('kick', [0, 4, 8, 12]),
      pat('hat', [2, 6, 10, 14]),
      pat('scratchbaby', [[3, 0.8], [7, 0.7], [11, 0.8]]),
      pat('scratchtrans', [[14, 0.8]])
    )
  };

  // Pad qui porte chaque boucle de pad (pour jouer son éventuel son perso)
  const LOOP_PAD = {};
  PADS.forEach((pad, i) => {
    if (pad.type === 'hit') LOOP_PAD[pad.loop] = i;
  });

  // Ce que joue une boucle à un pas donné : le rythme dessiné s'il y en a un, sinon celui d'origine
  function patternAt(id, s) {
    const custom = userPatterns[id];

    if (custom) {
      const st = custom[s];
      return st ? [[PADS[LOOP_PAD[id]].sound, st.freq, st.vol]] : [];
    }

    return LOOPS[id](s);
  }

  // Les 16 pas d'un pad ({ vol, freq } ou null), qu'ils soient dessinés ou d'origine
  function getSteps(i) {
    const id = PADS[i].loop;
    if (userPatterns[id]) return userPatterns[id];

    return ALL16.map((s) => {
      const hit = LOOPS[id](s)[0];
      return hit ? { vol: hit[2] === undefined ? 1 : hit[2], freq: hit[1] || null } : null;
    });
  }

  /* ---------- Horloge des boucles ---------- */

  function playStep(step, time) {
    state.loops.forEach((id) => {
      patternAt(id, step).forEach(([name, freq, vol]) => {
        const v = vol === undefined ? 1 : vol;
        const padIndex = LOOP_PAD[id];

        if (padIndex !== undefined) {
          playPad(padIndex, time, v, freq || undefined);
        } else {
          SOUNDS[name](time, filter, freq || undefined, v);
        }
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

  /* ---------- Affichage des pads et des banques ---------- */

  // Élément du pad d'indice i, s'il est dans la banque affichée
  function elOf(i) {
    const p = i - bank * 16;
    return p >= 0 && p < 16 ? padEls[p] : null;
  }

  function refreshPad(p) {
    const i = bank * 16 + p;
    const pad = PADS[i];
    const el = padEls[p];
    const sample = samples[i];
    const active = state.loops.has(pad.loop);

    el.style.setProperty('--c', pad.color);
    el.classList.toggle('is-loop', pad.type === 'loop');
    el.classList.toggle('custom', Boolean(sample));
    el.classList.toggle('on', active);
    el.classList.toggle('sel', sequencing && i === seqPad);
    el.setAttribute('aria-pressed', String(active));
    el.querySelector('.name').textContent = sample ? sample.label : pad.name;
    el.querySelector('.tag').textContent = sample ? 'Perso' : (pad.type === 'loop' ? 'Boucle' : '');
    el.setAttribute(
      'aria-label',
      (pad.type === 'loop' ? 'Boucle ' : '') + pad.name +
      (sample ? ' (son perso)' : '') +
      ' (touche ' + pad.key.toUpperCase() + ')'
    );
  }

  function refreshAll() {
    for (let p = 0; p < 16; p++) refreshPad(p);
  }

  function renderLegend() {
    const b = BANKS[bank];
    legendEl.innerHTML = b.rows
      .map((row, k) => '<li style="--c: ' + b.colors[k] + '">' + row + '</li>')
      .join('');
  }

  function showBank(b) {
    bank = b;

    bankEls.forEach((el, k) => {
      el.classList.toggle('active', k === b);
      el.setAttribute('aria-pressed', String(k === b));
    });

    refreshAll();
    renderLegend();

    gridEl.classList.remove('swap');
    void gridEl.offsetWidth; // relance l'animation
    gridEl.classList.add('swap');
  }

  // Changement de banque demandé par la personne (et mémorisé)
  function selectBank(b) {
    showBank(b);
    saveSettings();
  }

  // Allume le voyant d'une banque quand une de ses boucles tourne
  function updateBankTabs() {
    bankEls.forEach((el, k) => {
      const live = PADS.some((pad) => pad.bank === k && state.loops.has(pad.loop));
      el.classList.toggle('live', live);
    });
  }

  /* ---------- Séquenceur : affichage et édition ---------- */

  function updateSeqPlay() {
    if (seqPad < 0) return;
    const active = state.loops.has(PADS[seqPad].loop);
    seqPlay.textContent = active ? '■ Couper' : '▶ Écouter';
  }

  function renderSeq() {
    if (seqPad < 0) return;

    const pad = PADS[seqPad];
    const steps = getSteps(seqPad);

    seqPadLabel.textContent = pad.name + (userPatterns[pad.loop] ? ' · modifié' : '');
    seqPadLabel.style.setProperty('--c', pad.color);
    seqGrid.style.setProperty('--c', pad.color);

    seqCells.forEach((cell, s) => {
      const st = steps[s];
      const strong = Boolean(st) && st.vol > 0.6;

      cell.classList.toggle('on', strong);
      cell.classList.toggle('soft', Boolean(st) && !strong);
      cell.setAttribute('aria-label', 'Pas ' + (s + 1) + ' : ' + (!st ? 'vide' : strong ? 'fort' : 'doux'));
    });

    updateSeqPlay();
  }

  // Une case passe de vide à fort, puis à doux, puis à vide
  function cycleStep(s) {
    if (seqPad < 0) return;
    initAudio();

    const pad = PADS[seqPad];
    const steps = getSteps(seqPad).map((st) => (st ? { vol: st.vol, freq: st.freq } : null));
    const cur = steps[s];

    if (!cur) {
      steps[s] = { vol: 1, freq: null };
    } else if (cur.vol > 0.6) {
      steps[s] = { vol: 0.5, freq: cur.freq };
    } else {
      steps[s] = null;
    }

    userPatterns[pad.loop] = steps;
    savePatterns();
    renderSeq();

    // Petit aperçu du coup qu'on vient de poser
    if (steps[s]) playPad(seqPad, ctx.currentTime + 0.01, steps[s].vol, steps[s].freq || undefined);
  }

  function selectSeqPad(i) {
    initAudio();
    seqPad = i;
    playPad(i, ctx.currentTime + 0.01);
    flash(elOf(i));
    refreshAll();
    renderSeq();
  }

  function setSequencing(value) {
    sequencing = value;
    seqBtn.setAttribute('aria-pressed', String(sequencing));
    seqBtn.classList.toggle('active', sequencing);
    seqPanel.hidden = !sequencing;

    if (sequencing) {
      if (editing) setEditing(false);
      if (seqPad < 0) seqPad = bank * 16; // premier pad de la banque affichée
      renderSeq();
    }

    refreshAll();
  }

  function setEditing(value) {
    editing = value;
    editBtn.setAttribute('aria-pressed', String(editing));
    editBtn.classList.toggle('active', editing);
    gridEl.classList.toggle('editing', editing);
    editHint.hidden = !editing;

    if (editing && sequencing) setSequencing(false);
  }

  /* ---------- Actions sur les pads ---------- */

  function flash(el) {
    if (!el) return;
    el.classList.remove('hit');
    void el.offsetWidth; // relance l'animation
    el.classList.add('hit');
    clearTimeout(el._hitTimer);
    el._hitTimer = setTimeout(() => el.classList.remove('hit'), 300);
  }

  function updateLoopRead() {
    const n = state.loops.size;
    loopRead.textContent = n === 0 ? 'Aucune boucle' : n + (n > 1 ? ' boucles' : ' boucle');
    updateBankTabs();
    updateSeqPlay();
  }

  // Active ou coupe la boucle d'un pad, et renvoie son état final
  function setLoop(i, on) {
    const pad = PADS[i];

    if (on) {
      state.loops.add(pad.loop);
    } else {
      state.loops.delete(pad.loop);
    }

    const active = state.loops.has(pad.loop);
    const el = elOf(i);

    if (el) {
      el.classList.toggle('on', active);
      el.setAttribute('aria-pressed', String(active));
    }

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
    padEls.forEach((el) => {
      el.classList.remove('on');
      el.setAttribute('aria-pressed', 'false');
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

    if (pad.type === 'hit' && oneShot) {
      playPad(i, ctx.currentTime + 0.01);
      flash(elOf(i));
      record({ kind: 'hit', i });
      return;
    }

    const active = setLoop(i, !state.loops.has(pad.loop));
    if (active) flash(elOf(i));
    record({ kind: 'loop', i, on: active });
  }

  // Appui sur un pad : dans le séquenceur, un pad avec son à lui est sélectionné
  // au lieu de lancer sa boucle
  function press(i) {
    if (sequencing && PADS[i].type === 'hit') {
      selectSeqPad(i);
    } else {
      trigger(i);
    }
  }

  // Arrête toutes les boucles (et note l'arrêt si on enregistre)
  function stopAction() {
    if (play.on) {
      stopPlayback();
      return;
    }

    PADS.forEach((pad, i) => {
      if (state.loops.has(pad.loop)) {
        record({ kind: 'loop', i, on: false });
      }
    });
    stopAll();
  }

  // Mode « Tout en boucle » ou « Coup unique »
  function setOneShot(value, silent) {
    oneShot = value;
    modeBtn.classList.toggle('active', !oneShot);
    modeBtn.setAttribute('aria-pressed', String(!oneShot));
    modeBtn.textContent = oneShot ? '● Coup unique' : '↻ Tout en boucle';

    if (!silent) {
      toast(oneShot ? 'Chaque appui joue un seul coup.' : 'Tous les pads tournent en boucle.');
    }
  }

  /* ---------- Sons personnels : chargement ---------- */

  async function loadSample(i, file) {
    if (!file) return;

    if (PADS[i].type !== 'hit') {
      toast('Ce pad est une boucle complète : il ne peut pas recevoir de son perso.');
      return;
    }
    if (file.type && !file.type.startsWith('audio/')) {
      toast('Ce fichier n\'est pas un son.');
      return;
    }
    if (file.size > MAX_SAMPLE_BYTES) {
      toast('Fichier trop lourd (15 Mo maximum).');
      return;
    }

    initAudio();

    try {
      const data = await file.arrayBuffer();
      const copy = data.slice(0); // le décodage vide le tableau d'origine : on garde une copie
      const buffer = await decodeAudio(data);
      const label = file.name.replace(/\.[^.]+$/, '').slice(0, 14);

      samples[i] = { buffer, label };
      refreshAll();
      playPad(i, ctx.currentTime + 0.01);
      flash(elOf(i));
      toast('Son chargé sur « ' + PADS[i].name + ' ».');

      // Sauvegarde pour la prochaine visite
      dbSet('sample:' + PADS[i].loop, { label, data: copy })
        .then(requestPersist)
        .catch(() => toast('Son chargé, mais impossible de le sauvegarder (espace insuffisant ou navigation privée).'));
    } catch (err) {
      toast('Impossible de lire ce fichier audio.');
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

  // Note un changement de réglage pendant l'enregistrement (limité à un toutes les 60 ms)
  const fxLast = {};

  function recordFx(name, force) {
    if (!rec.on) return;
    const now = ctx.currentTime;
    if (!force && fxLast[name] !== undefined && now - fxLast[name] < 0.06) return;
    fxLast[name] = now;
    record({ kind: 'fx', name, value: FX[name].input.value });
  }

  /* ---------- Enregistreur : affichage ---------- */

  function hasActions() {
    return rec.events.some((ev) => ev.kind !== 'fx');
  }

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
    const n = rec.events.filter((ev) => ev.kind !== 'fx').length;

    if (n === 0) {
      setStatus('Appuie sur Enregistrer, puis joue.');
    } else {
      setStatus('Enregistré : ' + n + ' actions, ' + rec.duration.toFixed(1) + ' s.');
    }
  }

  function updateButtons() {
    recLabel.textContent = rec.on ? 'Arrêter' : 'Enregistrer';
    recBtn.classList.toggle('rec', rec.on);
    playLabel.textContent = play.on ? 'Stop' : 'Lire';
    playBtn.classList.toggle('playing', play.on);
    playBtn.disabled = !hasActions() || rec.on;
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
      // Les réglages de départ (à 0 s) ne sont pas affichés
      if (ev.kind === 'fx' && ev.t === 0) return;

      const tick = document.createElement('span');
      tick.className = 'tick' + (ev.kind === 'loop' ? ' loop' : ev.kind === 'fx' ? ' fx' : '');
      tick.style.left = Math.min(99.5, (ev.t / d) * 100) + '%';
      tick.style.background = ev.kind === 'fx' ? '#8b8b9c' : PADS[ev.i].color;
      timelineEl.appendChild(tick);
    });
  }

  /* ---------- Enregistreur : enregistrement ---------- */

  function startRecording() {
    initAudio();
    if (play.on) stopPlayback();

    userRecorded = true;
    rec.events = [];
    rec.bpm = state.bpm;
    rec.duration = 0;
    rec.start = ctx.currentTime;
    rec.on = true;

    // Réglages de départ, pour que la lecture retrouve le même son
    Object.keys(FX).forEach((name) => {
      delete fxLast[name];
      rec.events.push({ kind: 'fx', name, value: FX[name].input.value, t: 0 });
    });

    // Les boucles déjà lancées font partie de la performance, dès le début
    PADS.forEach((pad, i) => {
      if (state.loops.has(pad.loop)) {
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

        const blob = new Blob(chunks, { type: MIME });
        audioUrl = URL.createObjectURL(blob);
        audioExt = EXT;
        updateButtons();

        // Sauvegarde du fichier pour la prochaine visite
        blob.arrayBuffer()
          .then((data) => dbSet('rec-audio', { type: MIME, ext: EXT, data }))
          .catch(() => {});
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

    // La performance est sauvegardée tout de suite ; le fichier audio suivra
    saveRecording();
    dbDel('rec-audio').catch(() => {});

    setTime(rec.duration);
    renderTimeline();
    idleStatus();
    updateButtons();
  }

  function toggleRecording() {
    if (rec.on) {
      stopRecording();
    } else {
      startRecording();
    }
  }

  /* ---------- Enregistreur : lecture ---------- */

  function scheduleEvent(ev, at) {
    const wait = Math.max(0, (at - ctx.currentTime) * 1000);

    if (ev.kind === 'hit') {
      playPad(ev.i, at);
      play.timeouts.push(setTimeout(() => flash(elOf(ev.i)), wait));
    } else if (ev.kind === 'loop') {
      play.timeouts.push(setTimeout(() => setLoop(ev.i, ev.on), wait));
    } else {
      play.timeouts.push(setTimeout(() => {
        FX[ev.name].input.value = ev.value;
        FX[ev.name].apply();
      }, wait));
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
    if (!hasActions()) return;
    initAudio();
    if (rec.on) stopRecording();

    stopAll();
    tempo.value = rec.bpm;
    applyTempo();

    // Mémorise les réglages actuels, pour les rétablir à la fin de la lecture
    play.saved = {};
    Object.keys(FX).forEach((name) => {
      play.saved[name] = FX[name].input.value;
    });

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

    if (play.saved) {
      Object.keys(play.saved).forEach((name) => {
        FX[name].input.value = play.saved[name];
        FX[name].apply();
      });
      play.saved = null;
    }

    stopAll();
    fillEl.style.width = '0';
    setTime(rec.duration);
    idleStatus();
    updateButtons();
  }

  function togglePlayback() {
    if (play.on) {
      stopPlayback();
    } else if (hasActions() && !rec.on) {
      startPlayback();
    }
  }

  /* ---------- Remise à zéro ---------- */

  function resetSounds() {
    PADS.forEach((pad, i) => {
      if (samples[i]) dbDel('sample:' + pad.loop).catch(() => {});
    });
    samples.fill(null);
    refreshAll();
  }

  async function resetEverything() {
    if (!window.confirm('Effacer tes sons, tes rythmes, tes réglages et ta dernière performance sauvegardés ?')) return;

    if (play.on) stopPlayback();
    if (rec.on) stopRecording();
    mediaRec = null; // le fichier audio de l'enregistrement en cours ne sera pas sauvegardé

    stopAll();
    samples.fill(null);

    Object.keys(userPatterns).forEach((id) => delete userPatterns[id]);
    lsDel(LS_PATTERNS);

    rec.events = [];
    rec.duration = 0;
    rec.bpm = 110;

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      audioUrl = null;
    }

    lsDel(LS_SETTINGS);
    lsDel(LS_REC);

    try {
      await dbClear();
    } catch (err) {
      // stockage indisponible : rien à effacer
    }

    volume.value = 0.8;
    filterSlider.value = 1;
    echo.value = 0;
    tempo.value = 110;
    loopPlay.checked = false;
    applyVolume();
    applyFilter();
    applyEcho();
    applyTempo();
    setOneShot(false, true);

    clearTimeline();
    setTime(0);
    idleStatus();
    showBank(0);
    renderSeq();
    updateButtons();

    toast('Tout est remis à zéro.');
  }

  /* ---------- Construction de l'interface ---------- */

  // Onglets des banques
  BANKS.forEach((b, k) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bank';
    btn.textContent = b.name;
    btn.setAttribute('aria-pressed', 'false');
    btn.addEventListener('click', () => selectBank(k));
    banksEl.appendChild(btn);
    bankEls.push(btn);
  });

  // Les 16 pads sont créés une fois ; leur contenu change avec la banque
  for (let p = 0; p < 16; p++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pad';

    btn.innerHTML =
      '<i class="led"></i>' +
      '<span class="name"></span>' +
      '<span class="tag"></span>' +
      '<kbd class="key">' + KEYS[p] + '</kbd>';

    btn.addEventListener('pointerdown', (e) => {
      const i = bank * 16 + p;
      // En mode édition, un pad avec son propre son ouvre le sélecteur de fichier (voir « click »)
      if (editing && PADS[i].type === 'hit') return;
      e.preventDefault();
      press(i);
    });

    btn.addEventListener('click', (e) => {
      const i = bank * 16 + p;

      if (editing && PADS[i].type === 'hit') {
        pickIndex = i;
        fileInput.value = '';
        fileInput.click();
        return;
      }
      // Activation au clavier (Entrée ou Espace sur un pad sélectionné)
      if (e.detail === 0) press(i);
    });

    // Glisser-déposer d'un fichier audio sur un pad
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      btn.classList.add('drop');
    });
    btn.addEventListener('dragleave', () => btn.classList.remove('drop'));
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      btn.classList.remove('drop');
      loadSample(bank * 16 + p, e.dataTransfer.files[0]);
    });

    gridEl.appendChild(btn);
    padEls.push(btn);
  }

  for (let i = 0; i < 16; i++) {
    const dot = document.createElement('span');
    stepsEl.appendChild(dot);
    stepEls.push(dot);
  }

  // Les 16 cases du séquenceur
  for (let s = 0; s < 16; s++) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell';
    cell.addEventListener('click', () => cycleStep(s));
    seqGrid.appendChild(cell);
    seqCells.push(cell);
  }

  let currentStep = -1;

  // Montre le pas en cours, sous les pads et dans le séquenceur
  function showStep(step) {
    if (step === currentStep) return;
    currentStep = step;
    stepEls.forEach((dot, i) => dot.classList.toggle('cur', i === step));
    seqCells.forEach((cell, i) => cell.classList.toggle('cur', i === step));
  }

  /* ---------- Événements ---------- */

  // Évite que le navigateur ouvre un fichier lâché à côté d'un pad
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;

    const tag = document.activeElement ? document.activeElement.tagName : '';
    const onControl = tag === 'INPUT' || tag === 'BUTTON' || tag === 'SELECT';

    if (e.key === 'Escape') {
      stopAction();
      return;
    }

    // Touches 1 à 5 : changer de banque (fonctionne aussi sur un clavier AZERTY)
    const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
    if (digit) {
      selectBank(Number(digit[1]) - 1);
      return;
    }

    // Espace et Entrée ne servent de raccourcis que si aucun bouton n'est sélectionné
    if (!onControl && e.code === 'Space') {
      e.preventDefault();
      toggleRecording();
      return;
    }

    if (!onControl && e.key === 'Enter') {
      e.preventDefault();
      togglePlayback();
      return;
    }

    const p = KEYS.indexOf(e.key.toLowerCase());
    if (p !== -1) press(bank * 16 + p);
  });

  Object.keys(FX).forEach((name) => {
    const fx = FX[name];
    fx.input.addEventListener('input', () => {
      fx.apply();
      recordFx(name, false);
      saveSettings();
    });
    fx.input.addEventListener('change', () => recordFx(name, true));
  });

  tempo.addEventListener('input', () => {
    applyTempo();
    saveSettings();
  });

  loopPlay.addEventListener('change', saveSettings);

  recBtn.addEventListener('click', toggleRecording);
  playBtn.addEventListener('click', togglePlayback);

  dlBtn.addEventListener('click', () => {
    if (!audioUrl) return;
    const a = document.createElement('a');
    a.href = audioUrl;
    a.download = 'performance-pads.' + audioExt;
    a.click();
  });

  stopBtn.addEventListener('click', stopAction);

  modeBtn.addEventListener('click', () => {
    setOneShot(!oneShot, false);
    saveSettings();
  });

  seqBtn.addEventListener('click', () => setSequencing(!sequencing));
  editBtn.addEventListener('click', () => setEditing(!editing));

  // Lance ou coupe la boucle du pad en cours d'édition
  seqPlay.addEventListener('click', () => {
    if (seqPad < 0) return;
    initAudio();

    const active = setLoop(seqPad, !state.loops.has(PADS[seqPad].loop));
    if (active) flash(elOf(seqPad));
    record({ kind: 'loop', i: seqPad, on: active });
  });

  seqClear.addEventListener('click', () => {
    if (seqPad < 0) return;
    userPatterns[PADS[seqPad].loop] = new Array(16).fill(null);
    savePatterns();
    renderSeq();
  });

  seqReset.addEventListener('click', () => {
    if (seqPad < 0) return;
    delete userPatterns[PADS[seqPad].loop];
    savePatterns();
    renderSeq();
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (file && pickIndex >= 0) loadSample(pickIndex, file);
  });

  resetSamples.addEventListener('click', () => {
    resetSounds();
    toast('Sons d\'origine rétablis.');
  });

  resetAll.addEventListener('click', resetEverything);

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

  restoreSettings();
  restorePatterns();
  applyVolume();
  applyFilter();
  applyEcho();
  applyTempo();
  showBank(bank);
  restoreRecording();
  updateLoopRead();
  updateButtons();
  restoreFromStorage(); // sons perso et fichier audio : chargés en arrière-plan
})();
