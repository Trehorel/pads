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

// Nombre au hasard entre -a et +a, et petite variation d'une valeur :
// deux coups de suite ne sont jamais tout à fait identiques, comme avec un vrai instrument
const rand = (a) => (Math.random() * 2 - 1) * a;
const jit = (x, a) => x * (1 + rand(a));

// Réverbération (écho de salle) partagée par tous les sons
let reverbIn = null;

function getReverb() {
  if (reverbIn) return reverbIn;

  // Réponse de la salle : du bruit qui s'éteint et s'assombrit au fil du temps
  const len = Math.floor(ctx.sampleRate * 1.8);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);

  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    let smooth = 0;

    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 3);
      const alpha = 0.9 - 0.8 * (i / len);
      smooth += ((Math.random() * 2 - 1) * decay - smooth) * alpha;
      data[i] = smooth;
    }
  }

  const conv = ctx.createConvolver();
  const level = ctx.createGain();
  conv.buffer = ir;
  level.gain.value = 0.9;
  conv.connect(level);
  level.connect(filter);

  reverbIn = conv;
  return conv;
}

// Envoie une partie d'un son dans la réverbération
function wet(node, amount) {
  const g = ctx.createGain();
  g.gain.value = amount;
  node.connect(g).connect(getReverb());
}

// Saturation douce : donne du mordant (grosses caisses, basses, cuivres)
const satCurves = {};

function saturator(amount = 2) {
  if (!satCurves[amount]) {
    const n = 1024;
    const curve = new Float32Array(n);

    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
    }
    satCurves[amount] = curve;
  }

  const shaper = ctx.createWaveShaper();
  shaper.curve = satCurves[amount];
  shaper.oversample = '2x';
  return shaper;
}

// Son « vieille cassette » : un peu sourd et légèrement saturé
function lofi(out) {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 4800;
  lp.connect(saturator(1.6)).connect(out);
  return lp;
}

// Oscillateur avec enveloppe qui décroît (et glissando optionnel de f0 vers f1)
function tone(t, out, { type = 'sine', f0, f1, dur = 0.3, vol = 1, jitter = 0.003, send = 0 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const k = 1 + rand(jitter);

  o.type = type;
  o.frequency.setValueAtTime(f0 * k, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(f1 * k, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(out);
  if (send) wet(g, send);
  o.start(t);
  o.stop(t + dur + 0.02);
}

// Petit souffle de bruit filtré
function burst(t, out, { type = 'highpass', freq = 7000, q = 1, dur = 0.05, vol = 1, attack = 0, send = 0 }) {
  const s = ctx.createBufferSource();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();

  s.buffer = noiseBuf;
  f.type = type;
  f.frequency.value = jit(freq, 0.04);
  f.Q.value = q;

  if (attack > 0) {
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
  } else {
    g.gain.setValueAtTime(vol, t);
  }
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  s.connect(f).connect(g).connect(out);
  if (send) wet(g, send);

  // Chaque coup démarre à un endroit différent du bruit
  s.start(t, Math.random() * Math.max(0, 2 - dur - 0.05));
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

// Plusieurs notes jouées ensemble, avec filtre qui se ferme et voix dédoublées (spread, en cents)
function chord(t, out, freqs, { type = 'sawtooth', cutoff = 2000, cutoffEnd = cutoff, dur = 0.3, vol = 0.3, spread = 0, send = 0, attack = 0.005 }) {
  const lp = ctx.createBiquadFilter();
  const g = ctx.createGain();
  const voices = spread ? [-spread, spread] : [0];
  const count = freqs.length * voices.length;

  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cutoff, t);
  if (cutoffEnd !== cutoff) lp.frequency.exponentialRampToValueAtTime(cutoffEnd, t + dur);

  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol / Math.sqrt(count), t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  lp.connect(g).connect(out);
  if (send) wet(g, send);

  freqs.forEach((fr) => {
    voices.forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = jit(fr, 0.002);
      o.detune.value = cents + rand(3);
      o.connect(lp);
      o.start(t);
      o.stop(t + dur + 0.02);
    });
  });
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

// Son électrique de type piano ou cloche : une onde en module une autre
function fm(t, out, { f, ratio = 1, index = 2, dur = 1, vol = 0.2, modDecay = 0.4, send = 0 }) {
  const car = ctx.createOscillator();
  const mod = ctx.createOscillator();
  const modGain = ctx.createGain();
  const g = ctx.createGain();
  const fr = jit(f, 0.002);

  car.frequency.value = fr;
  mod.frequency.value = fr * ratio;
  modGain.gain.setValueAtTime(fr * index, t);
  modGain.gain.exponentialRampToValueAtTime(fr * 0.05, t + dur * modDecay);

  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);

  mod.connect(modGain).connect(car.frequency);
  car.connect(g).connect(out);
  if (send) wet(g, send);

  car.start(t);
  mod.start(t);
  car.stop(t + dur + 0.05);
  mod.stop(t + dur + 0.05);
}

// Source de voix : une onde douce, riche en harmoniques graves comme les cordes vocales
let glottal = null;

function glottalWave() {
  if (!glottal) {
    const n = 32;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);

    for (let k = 1; k < n; k++) imag[k] = 1 / (k * k);
    glottal = ctx.createPeriodicWave(real, imag);
  }
  return glottal;
}

// Voix synthétique : la source passe par des filtres qui imitent les voyelles.
// formants : [[début, fin, netteté, volume], ...] en Hz, vibrato : [vitesse, profondeur]
function vowel(t, out, { f0, f1 = f0, formants, dur = 0.3, vol = 1, attack = 0.02, vibrato = null, breath = 0.1, send = 0 }) {
  const o = ctx.createOscillator();
  const src = ctx.createGain();
  const g = ctx.createGain();

  o.setPeriodicWave(glottalWave());
  o.frequency.setValueAtTime(jit(f0, 0.01), t);
  o.frequency.linearRampToValueAtTime(jit(f1, 0.01), t + dur);
  if (vibrato) addVibrato(o, t, dur, vibrato[0], vibrato[1]);
  o.connect(src);

  // Un peu de souffle mélangé à la voix, comme dans une vraie voix
  if (breath) {
    const n = ctx.createBufferSource();
    const ng = ctx.createGain();
    n.buffer = noiseBuf;
    n.loop = true;
    ng.gain.value = breath;
    n.connect(ng).connect(src);
    n.start(t);
    n.stop(t + dur + 0.05);
  }

  formants.forEach(([from, to, q, amp = 1]) => {
    const bp = ctx.createBiquadFilter();
    const fg = ctx.createGain();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.linearRampToValueAtTime(to, t + dur);
    fg.gain.value = amp;
    src.connect(bp).connect(fg).connect(g);
  });

  g.gain.setValueAtTime(0.001, t);
  g.gain.linearRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  g.connect(out);
  if (send) wet(g, send);

  o.start(t);
  o.stop(t + dur + 0.05);
}

// Un mouvement de scratch : la hauteur et la brillance suivent la vitesse du disque,
// et la coupure du fader rend le début et la fin nets
function scratchCut(t, out, { dur, from, to, vol = 1, base = 140 }) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.setPeriodicWave(glottalWave());
  o.frequency.setValueAtTime(base * from, t);
  o.frequency.exponentialRampToValueAtTime(base * to, t + dur);

  [[750, 7], [1250, 9], [2600, 6]].forEach(([fr, q]) => {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(fr * from, t);
    bp.frequency.exponentialRampToValueAtTime(fr * to, t + dur);
    o.connect(bp).connect(g);
  });

  g.gain.setValueAtTime(0.001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + dur - 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  g.connect(out);
  wet(g, 0.06);

  o.start(t);
  o.stop(t + dur + 0.02);

  // Bruit du sillon du disque
  sweepNoise(t, out, { f0: 1800 * from, f1: 1800 * to, dur, q: 3, vol: 0.12 * vol });
}

/* ---------- Batterie : coups réutilisés par plusieurs sons ---------- */

// Les six ondes carrées d'une vraie boîte à rythmes : ça donne le côté métallique
const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function metal(t, out, { dur = 0.05, vol = 0.5, hp = 7000, peak = 10000, send = 0 }) {
  const hpf = ctx.createBiquadFilter();
  const bpf = ctx.createBiquadFilter();
  const g = ctx.createGain();

  hpf.type = 'highpass';
  hpf.frequency.value = hp;
  bpf.type = 'bandpass';
  bpf.frequency.value = peak;
  bpf.Q.value = 0.7;

  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  hpf.connect(bpf).connect(g).connect(out);
  if (send) wet(g, send);

  METAL.forEach((fr) => {
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = jit(fr, 0.01);
    o.connect(hpf);
    o.start(t);
    o.stop(t + dur + 0.02);
  });
}

// Grosse caisse : le corps plonge vite en hauteur, avec le claquement de la peau au début
function kickHit(t, out, v = 1, { body = 150, end = 45, dur = 0.5, drive = 2.5 } = {}) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();

  o.type = 'sine';
  o.frequency.setValueAtTime(jit(body, 0.02), t);
  o.frequency.exponentialRampToValueAtTime(end * 1.6, t + 0.05);
  o.frequency.exponentialRampToValueAtTime(end, t + dur * 0.8);
  g.gain.setValueAtTime(v, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(saturator(drive)).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);

  burst(t, out, { type: 'bandpass', freq: 3500, q: 1, dur: 0.012, vol: 0.35 * v });
  tone(t, out, { type: 'triangle', f0: 320, f1: 90, dur: 0.03, vol: 0.3 * v, jitter: 0.02 });
}

// Caisse claire : le fût (deux notes), le choc de la baguette et le frottement du timbre
function snareHit(t, out, v = 1, { pitch = 1, snap = 1, send = 0.18 } = {}) {
  tone(t, out, { type: 'triangle', f0: 190 * pitch, f1: 150 * pitch, dur: 0.12, vol: 0.5 * v, jitter: 0.02 });
  tone(t, out, { type: 'sine', f0: 330 * pitch, f1: 250 * pitch, dur: 0.07, vol: 0.3 * v, jitter: 0.02 });
  burst(t, out, { type: 'bandpass', freq: 2200, q: 0.7, dur: 0.2, vol: 0.55 * v * snap, send });
  burst(t, out, { type: 'highpass', freq: 5000, dur: 0.12, vol: 0.3 * v * snap });
}

// Claquement de mains : plusieurs frappes très rapprochées, puis la résonance de la pièce
function clapHit(t, out, v = 1, { tail = 0.18, send = 0.3 } = {}) {
  let at = 0;

  for (let i = 0; i < 4; i++) {
    burst(t + at, out, {
      type: 'bandpass',
      freq: 1100,
      q: 1.1,
      dur: 0.012 + Math.random() * 0.006,
      vol: (0.5 + Math.random() * 0.2) * v
    });
    at += 0.008 + Math.random() * 0.008;
  }

  burst(t + at, out, { type: 'bandpass', freq: 1250, q: 0.9, dur: tail, vol: 0.7 * v, send });
}

// Charleston fermé ou ouvert
function hatHit(t, out, v = 1, open = false) {
  metal(t, out, {
    dur: open ? 0.38 : 0.06,
    vol: (open ? 0.4 : 0.45) * v,
    hp: 7200,
    peak: 10500,
    send: open ? 0.08 : 0
  });
  burst(t, out, { type: 'highpass', freq: 9000, dur: open ? 0.3 : 0.04, vol: 0.12 * v });
}

/* ---------- Sons ---------- */

const SOUNDS = {
  /* ----- Classique ----- */

  kick(t, out, f, v = 1) {
    kickHit(t, out, v);
  },

  snare(t, out, f, v = 1) {
    snareHit(t, out, v);
  },

  clap(t, out, f, v = 1) {
    clapHit(t, out, v);
  },

  hat(t, out, f, v = 1) {
    hatHit(t, out, v, false);
  },

  openhat(t, out, f, v = 1) {
    hatHit(t, out, v, true);
  },

  tom(t, out, f, v = 1) {
    tone(t, out, { type: 'sine', f0: 230, f1: 105, dur: 0.38, vol: 0.9 * v, jitter: 0.02, send: 0.1 });
    tone(t, out, { type: 'triangle', f0: 460, f1: 210, dur: 0.12, vol: 0.25 * v, jitter: 0.02 });
    burst(t, out, { type: 'bandpass', freq: 1800, q: 1, dur: 0.015, vol: 0.25 * v });
  },

  rim(t, out, f, v = 1) {
    tone(t, out, { type: 'triangle', f0: 1750, dur: 0.025, vol: 0.25 * v, jitter: 0.02 });
    tone(t, out, { type: 'square', f0: 520, dur: 0.04, vol: 0.25 * v, jitter: 0.02 });
    burst(t, out, { type: 'bandpass', freq: 3200, q: 1.2, dur: 0.03, vol: 0.4 * v, send: 0.08 });
  },

  cowbell(t, out, f, v = 1) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1000;
    bp.Q.value = 1.5;
    bp.connect(out);

    tone(t, bp, { type: 'square', f0: 540, dur: 0.35, vol: 0.55 * v, jitter: 0.005 });
    tone(t, bp, { type: 'square', f0: 800, dur: 0.35, vol: 0.55 * v, jitter: 0.005 });
    burst(t, out, { type: 'highpass', freq: 5000, dur: 0.01, vol: 0.15 * v });
  },

  bass(t, out, f = 55, v = 1) {
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    o.type = 'sawtooth';
    o.frequency.value = jit(f, 0.002);
    lp.type = 'lowpass';
    lp.Q.value = 4;
    lp.frequency.setValueAtTime(1100, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.25);
    g.gain.setValueAtTime(0.5 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    o.connect(lp).connect(saturator(2)).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.47);

    tone(t, out, { type: 'sine', f0: f, dur: 0.45, vol: 0.55 * v });
  },

  stab(t, out, f, v = 1) {
    chord(t, out, [220, 277.2, 329.6], { cutoff: 3200, cutoffEnd: 700, dur: 0.28, vol: 0.45 * v, spread: 8, send: 0.15 });
  },

  pluck(t, out, f = 659.3, v = 1) {
    chord(t, out, [f], { cutoff: 4200, cutoffEnd: 500, dur: 0.3, vol: 0.4 * v, spread: 6, send: 0.12 });
  },

  laser(t, out, f, v = 1) {
    tone(t, out, { type: 'sawtooth', f0: 1800, f1: 80, dur: 0.35, vol: 0.25 * v, send: 0.15 });
    tone(t, out, { type: 'square', f0: 900, f1: 60, dur: 0.3, vol: 0.1 * v });
  },

  /* ----- Électro ----- */

  kick808(t, out, f, v = 1) {
    kickHit(t, out, v, { body: 125, end: 38, dur: 1.0, drive: 3.2 });
  },

  snare2(t, out, f, v = 1) {
    snareHit(t, out, v, { pitch: 1.35, snap: 1.3, send: 0.25 });
  },

  clap2(t, out, f, v = 1) {
    clapHit(t, out, v, { tail: 0.3, send: 0.45 });
  },

  hat909(t, out, f, v = 1) {
    metal(t, out, { dur: 0.07, vol: 0.45 * v, hp: 6000, peak: 9000 });
    burst(t, out, { type: 'highpass', freq: 8500, dur: 0.05, vol: 0.12 * v });
  },

  rimshot(t, out, f, v = 1) {
    tone(t, out, { type: 'square', f0: 1700, dur: 0.02, vol: 0.3 * v, jitter: 0.02 });
    tone(t, out, { type: 'square', f0: 480, dur: 0.03, vol: 0.3 * v, jitter: 0.02 });
    burst(t, out, { type: 'bandpass', freq: 2500, dur: 0.03, vol: 0.4 * v, send: 0.1 });
  },

  conga(t, out, f, v = 1) {
    tone(t, out, { type: 'sine', f0: 340, f1: 250, dur: 0.25, vol: 0.8 * v, jitter: 0.02, send: 0.08 });
    tone(t, out, { type: 'triangle', f0: 700, f1: 400, dur: 0.05, vol: 0.25 * v, jitter: 0.02 });
    burst(t, out, { type: 'bandpass', freq: 2000, dur: 0.012, vol: 0.25 * v });
  },

  shaker(t, out, f, v = 1) {
    burst(t, out, { type: 'bandpass', freq: 6500, q: 1.5, attack: 0.012, dur: 0.09, vol: 0.5 * v });
  },

  tambo(t, out, f, v = 1) {
    metal(t, out, { dur: 0.25, vol: 0.3 * v, hp: 3500, peak: 7000 });
    burst(t, out, { type: 'highpass', freq: 4500, attack: 0.004, dur: 0.2, vol: 0.3 * v });
  },

  sub(t, out, f = 41.2, v = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.frequency.setValueAtTime(jit(f, 0.002), t);
    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.8 * v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(saturator(1.8)).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.92);
  },

  supersaw(t, out, f = 220, v = 1) {
    chord(t, out, [f, f * 1.5, f * 2], { cutoff: 4200, cutoffEnd: 1400, dur: 0.55, vol: 0.5 * v, spread: 14, send: 0.15 });
  },

  acid(t, out, f = 110, v = 1) {
    const o = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    o.type = 'sawtooth';
    o.frequency.value = jit(f, 0.002);
    lp.type = 'lowpass';
    lp.Q.value = 14;
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(200, t + 0.25);
    g.gain.setValueAtTime(0.4 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);

    o.connect(lp).connect(saturator(2.5)).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.32);
  },

  zap(t, out, f, v = 1) {
    tone(t, out, { type: 'square', f0: 1200, f1: 100, dur: 0.15, vol: 0.2 * v, send: 0.12 });
    tone(t, out, { type: 'sawtooth', f0: 2400, f1: 200, dur: 0.1, vol: 0.15 * v });
  },

  /* ----- Lo-fi ----- */

  boombap(t, out, f, v = 1) {
    kickHit(t, lofi(out), v, { body: 108, end: 50, dur: 0.42, drive: 1.8 });
  },

  snap(t, out, f, v = 1) {
    const o = lofi(out);
    burst(t, o, { type: 'bandpass', freq: 2200, q: 2, dur: 0.08, vol: 0.7 * v, send: 0.1 });
    tone(t, o, { type: 'triangle', f0: 1300, dur: 0.03, vol: 0.15 * v });
  },

  rimlofi(t, out, f, v = 1) {
    const o = lofi(out);
    tone(t, o, { type: 'triangle', f0: 600, dur: 0.06, vol: 0.4 * v, jitter: 0.02 });
    burst(t, o, { type: 'bandpass', freq: 1800, dur: 0.03, vol: 0.3 * v });
  },

  hatlofi(t, out, f, v = 1) {
    burst(t, lofi(out), { type: 'highpass', freq: 5000, dur: 0.05, vol: 0.4 * v });
  },

  // Craquement de vinyle : plein de minuscules claquements et un petit « pop »
  vinylpop(t, out, f, v = 1) {
    for (let k = 0; k < 5; k++) {
      burst(t + Math.random() * 0.06, out, { type: 'highpass', freq: 2500, dur: 0.004, vol: 0.25 * v });
    }
    burst(t, out, { type: 'lowpass', freq: 900, dur: 0.035, vol: 0.45 * v });
  },

  bongo(t, out, f, v = 1) {
    tone(t, out, { type: 'sine', f0: 430, f1: 320, dur: 0.16, vol: 0.75 * v, jitter: 0.02, send: 0.08 });
    tone(t, out, { type: 'triangle', f0: 900, f1: 500, dur: 0.04, vol: 0.25 * v, jitter: 0.02 });
    burst(t, out, { type: 'bandpass', freq: 2500, dur: 0.01, vol: 0.2 * v });
  },

  wood(t, out, f, v = 1) {
    tone(t, out, { type: 'triangle', f0: 900, f1: 850, dur: 0.09, vol: 0.45 * v, jitter: 0.01, send: 0.1 });
    tone(t, out, { type: 'sine', f0: 1350, dur: 0.05, vol: 0.15 * v, jitter: 0.01 });
    burst(t, out, { type: 'bandpass', freq: 2800, dur: 0.008, vol: 0.2 * v });
  },

  bell(t, out, f = 880, v = 1) {
    fm(t, out, { f, ratio: 3.5, index: 2.8, dur: 1.8, vol: 0.22 * v, modDecay: 0.3, send: 0.25 });
  },

  rhodes(t, out, f, v = 1) {
    [261.6, 329.6, 392, 493.9].forEach((note, k) => {
      fm(t + k * 0.012, out, { f: note, ratio: 1, index: 1.5, dur: 1.3, vol: 0.085 * v, modDecay: 0.25, send: 0.2 });
    });
  },

  fatbass(t, out, f = 55, v = 1) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.4);
    lp.connect(saturator(2.2)).connect(out);

    tone(t, lp, { type: 'sawtooth', f0: f, dur: 0.5, vol: 0.5 * v });
    tone(t, lp, { type: 'sawtooth', f0: f * 1.006, dur: 0.5, vol: 0.4 * v });
    tone(t, out, { type: 'sine', f0: f, dur: 0.5, vol: 0.45 * v });
  },

  scratch(t, out, f, v = 1) {
    scratchCut(t, out, { dur: 0.12, from: 0.8, to: 2.4, vol: 1.4 * v, base: 170 });
    scratchCut(t + 0.13, out, { dur: 0.14, from: 2.2, to: 0.7, vol: 1.0 * v, base: 170 });
  },

  // Petit extrait de voix « oh »
  chop(t, out, f = 196, v = 1) {
    vowel(t, out, {
      f0: f,
      f1: f * 0.97,
      formants: [[520, 480, 8, 1], [920, 880, 10, 0.7], [2500, 2500, 10, 0.3]],
      dur: 0.22,
      vol: 1.8 * v,
      attack: 0.01,
      breath: 0.1,
      send: 0.1
    });
  },

  /* ----- FX ----- */

  riser(t, out, f, v = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = 'sawtooth';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(1800, t + 1.5);
    g.gain.setValueAtTime(0.001, t);
    g.gain.exponentialRampToValueAtTime(0.1 * v, t + 1.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(g).connect(out);
    wet(g, 0.2);
    o.start(t);
    o.stop(t + 1.52);

    sweepNoise(t, out, { f0: 300, f1: 8000, dur: 1.5, q: 2, vol: 0.4 * v, up: true });
  },

  impact(t, out, f, v = 1) {
    kickHit(t, out, v, { body: 90, end: 26, dur: 1.3, drive: 2 });
    burst(t, out, { type: 'lowpass', freq: 700, dur: 1.3, vol: 0.6 * v, send: 0.45 });
    burst(t, out, { type: 'highpass', freq: 3000, dur: 0.3, vol: 0.25 * v, send: 0.5 });
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
    wet(g, 0.15);
    o.start(t);
    o.stop(t + 0.9);
  },

  glitch(t, out, f, v = 1) {
    for (let k = 0; k < 8; k++) {
      const freq = 200 + Math.floor(Math.random() * 8) * 260;
      tone(t + k * 0.025, out, { type: 'square', f0: freq, dur: 0.025, vol: 0.1 * v, jitter: 0 });
    }
    burst(t, out, { type: 'highpass', freq: 6000, dur: 0.2, vol: 0.1 * v });
  },

  bubble(t, out, f, v = 1) {
    tone(t, out, { type: 'sine', f0: 280, f1: 950, dur: 0.1, vol: 0.35 * v, jitter: 0.03, send: 0.12 });
    tone(t, out, { type: 'sine', f0: 560, f1: 1900, dur: 0.1, vol: 0.1 * v, jitter: 0.03 });
  },

  coin(t, out, f, v = 1) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 4200;
    lp.connect(out);

    tone(t, lp, { type: 'square', f0: 988, dur: 0.08, vol: 0.16 * v, jitter: 0 });
    tone(t + 0.08, lp, { type: 'square', f0: 1319, dur: 0.38, vol: 0.16 * v, jitter: 0, send: 0.15 });
  },

  drop(t, out, f, v = 1) {
    tone(t, out, { type: 'sine', f0: 420, f1: 38, dur: 0.75, vol: 0.85 * v, send: 0.1 });
    burst(t, out, { type: 'lowpass', freq: 400, dur: 0.2, vol: 0.3 * v });
  },

  whoosh(t, out, f, v = 1) {
    sweepNoise(t, out, { f0: 400, f1: 3500, dur: 0.55, q: 1, vol: 0.5 * v, up: true });
    sweepNoise(t, out, { f0: 900, f1: 6000, dur: 0.55, q: 2, vol: 0.2 * v, up: true });
  },

  marimba(t, out, f = 523.3, v = 1) {
    fm(t, out, { f, ratio: 4, index: 0.6, dur: 0.55, vol: 0.45 * v, modDecay: 0.12, send: 0.1 });
    burst(t, out, { type: 'bandpass', freq: f * 2, q: 2, dur: 0.01, vol: 0.15 * v });
  },

  kalimba(t, out, f = 784, v = 1) {
    fm(t, out, { f, ratio: 5.4, index: 0.35, dur: 0.9, vol: 0.4 * v, modDecay: 0.1, send: 0.15 });
    burst(t, out, { type: 'bandpass', freq: 3500, q: 2, dur: 0.008, vol: 0.18 * v });
  },

  // Gong : beaucoup de notes qui ne s'accordent pas, chacune s'éteignant à son rythme
  gong(t, out, f, v = 1) {
    [110, 150.4, 183, 247, 297, 372, 468, 531].forEach((fr) => {
      tone(t, out, { type: 'sine', f0: fr, dur: 1.2 + Math.random() * 2, vol: 0.07 * v, jitter: 0.004, send: 0.35 });
    });
    burst(t, out, { type: 'bandpass', freq: 800, q: 0.8, attack: 0.02, dur: 0.4, vol: 0.2 * v, send: 0.3 });
  },

  choir(t, out, f = 196, v = 1) {
    [f, f * 1.26, f * 1.5].forEach((fr, k) => {
      vowel(t, out, {
        f0: fr,
        formants: [[800, 800, 6, 1], [1150, 1150, 8, 0.6], [2900, 2900, 10, 0.25]],
        dur: 0.95,
        vol: 1.0 * v,
        attack: 0.22,
        vibrato: [5, 3 + k],
        breath: 0.06,
        send: 0.3
      });
    });
  },

  /* ----- DJ ----- */

  // Le klaxon : plusieurs cuivres qui montent en un instant, saturés comme un vrai
  airhorn(t, out, f, v = 1) {
    const pre = ctx.createGain();
    const horn = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    pre.gain.value = 0.18;
    horn.type = 'peaking'; // résonance du pavillon
    horn.frequency.value = 1100;
    horn.Q.value = 1.2;
    horn.gain.value = 9;
    lp.type = 'lowpass';
    lp.frequency.value = 5200;

    g.gain.setValueAtTime(0.001, t);
    g.gain.linearRampToValueAtTime(0.28 * v, t + 0.025);
    g.gain.setValueAtTime(0.28 * v, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.82);

    pre.connect(horn).connect(saturator(4)).connect(lp).connect(g).connect(out);
    wet(g, 0.18);

    [466, 588, 698, 933].forEach((fr) => {
      [-9, 9].forEach((cents) => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.setValueAtTime(fr * 0.94, t);
        o.frequency.exponentialRampToValueAtTime(fr, t + 0.07);
        o.detune.value = cents + rand(4);
        o.connect(pre);
        o.start(t);
        o.stop(t + 0.85);
      });
    });

    // Souffle de l'attaque
    burst(t, out, { type: 'bandpass', freq: 2500, q: 0.8, dur: 0.06, vol: 0.12 * v });
  },

  // Le disque qu'on freine : la hauteur s'effondre et le plateau tremble de plus en plus lentement
  rewind(t, out, f, v = 1) {
    const dur = 0.7;
    const o = ctx.createOscillator();
    const bp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    o.type = 'sawtooth';
    o.frequency.setValueAtTime(3200, t);
    o.frequency.exponentialRampToValueAtTime(70, t + dur);
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(5000, t);
    bp.frequency.exponentialRampToValueAtTime(300, t + dur);

    g.gain.setValueAtTime(0.28 * v, t);
    g.gain.setValueAtTime(0.28 * v, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);

    lfo.frequency.setValueAtTime(38, t);
    lfo.frequency.exponentialRampToValueAtTime(5, t + dur);
    lfoGain.gain.value = 0.1 * v;
    lfo.connect(lfoGain).connect(g.gain);

    o.connect(bp).connect(g).connect(out);
    wet(g, 0.1);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.02);
    lfo.stop(t + dur + 0.02);

    sweepNoise(t, out, { f0: 6000, f1: 200, dur, q: 1.2, vol: 0.22 * v });
    tone(t + dur - 0.02, out, { type: 'sine', f0: 90, f1: 50, dur: 0.12, vol: 0.3 * v });
  },

  // Un aller-retour de scratch
  scratchbaby(t, out, f, v = 1) {
    scratchCut(t, out, { dur: 0.14, from: 0.7, to: 2.6, vol: 1.5 * v });
    scratchCut(t + 0.15, out, { dur: 0.15, from: 2.3, to: 0.6, vol: 0.9 * v });
  },

  // Scratch haché : le fader coupe et relance le son quatre fois très vite
  scratchtrans(t, out, f, v = 1) {
    for (let k = 0; k < 4; k++) {
      scratchCut(t + k * 0.085, out, { dur: 0.06, from: 1.1, to: 1.7, vol: 1.5 * v });
    }
  },

  // « Hey ! » : un « h » soufflé, puis la voyelle qui passe de « é » à « i »
  voxhey(t, out, f, v = 1) {
    burst(t, out, { type: 'bandpass', freq: 1900, q: 1.5, dur: 0.07, vol: 0.25 * v });
    vowel(t + 0.03, out, {
      f0: 250,
      f1: 205,
      formants: [[560, 330, 8, 1], [1850, 2300, 10, 0.8], [2600, 2800, 10, 0.4]],
      dur: 0.34,
      vol: 2.2 * v,
      attack: 0.02,
      breath: 0.12,
      send: 0.14
    });
  },

  // « Ooh » tenu par trois voix légèrement décalées, avec vibrato
  voxooh(t, out, f, v = 1) {
    [-7, 0, 7].forEach((cents, k) => {
      vowel(t, out, {
        f0: 220 * Math.pow(2, cents / 1200),
        formants: [[310, 310, 8, 1], [870, 870, 10, 0.7], [2240, 2240, 10, 0.3]],
        dur: 0.95,
        vol: 1.3 * v,
        attack: 0.15,
        vibrato: [5.3, 4 + k],
        breath: 0.05,
        send: 0.25
      });
    });
  },

  // Foule : un grondement, beaucoup d'applaudissements au hasard et quelques « wouh »
  crowd(t, out, f, v = 1) {
    [[420, 0.5, 0.22], [1100, 0.6, 0.18]].forEach(([freq, q, vol]) => {
      const s = ctx.createBufferSource();
      const bp = ctx.createBiquadFilter();
      const g = ctx.createGain();

      s.buffer = noiseBuf;
      s.loop = true;
      bp.type = 'bandpass';
      bp.frequency.value = freq;
      bp.Q.value = q;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol * v, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.7);
      s.connect(bp).connect(g).connect(out);
      wet(g, 0.2);
      s.start(t);
      s.stop(t + 1.75);
    });

    for (let k = 0; k < 55; k++) {
      const at = Math.random() * 1.5;
      const swell = Math.sin(Math.PI * Math.min(1, at / 1.5));

      burst(t + at, out, {
        type: 'bandpass',
        freq: 900 + Math.random() * 3200,
        q: 0.9,
        dur: 0.012 + Math.random() * 0.02,
        vol: (0.08 + Math.random() * 0.12) * v * (0.3 + swell)
      });
    }

    [0.25, 0.6, 0.95].forEach((at, k) => {
      vowel(t + at, out, {
        f0: 330 + k * 60,
        f1: 420 + k * 70,
        formants: [[500, 700, 6, 1], [1100, 1400, 8, 0.7]],
        dur: 0.35,
        vol: 1.2 * v,
        attack: 0.05,
        breath: 0.15,
        send: 0.2
      });
    });
  },

  // Sifflet à bille : deux coups avec le trille caractéristique
  whistle(t, out, f, v = 1) {
    [[0, 0.2], [0.26, 0.2]].forEach(([at, dur]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();

      o.type = 'sine';
      o.frequency.setValueAtTime(2650 * 0.96, t + at);
      o.frequency.linearRampToValueAtTime(2650 * 1.04, t + at + 0.05);
      addVibrato(o, t + at, dur, 24, 90);

      g.gain.setValueAtTime(0.001, t + at);
      g.gain.linearRampToValueAtTime(0.2 * v, t + at + 0.015);
      g.gain.setValueAtTime(0.2 * v, t + at + dur - 0.04);
      g.gain.exponentialRampToValueAtTime(0.001, t + at + dur);

      o.connect(g).connect(out);
      wet(g, 0.15);
      o.start(t + at);
      o.stop(t + at + dur + 0.02);

      burst(t + at, out, { type: 'bandpass', freq: 3200, q: 2, dur, vol: 0.06 * v });
    });
  },

  // Roulement de caisse claire qui accélère, sur un souffle qui monte
  build(t, out, f, v = 1) {
    let at = 0;
    let gap = 0.22;
    let vol = 0.2;
    let pitch = 1;

    while (at < 1.5) {
      snareHit(t + at, out, v * vol, { pitch, send: 0.1 });
      at += gap;
      gap = Math.max(0.035, gap * 0.82);
      vol = Math.min(1, vol + 0.07);
      pitch += 0.02;
    }

    sweepNoise(t, out, { f0: 400, f1: 9000, dur: 1.5, q: 1.5, vol: 0.3 * v, up: true });
  },

  // Grosse basse qui s'écroule : grondement saturé, sous-grave et choc
  bassdrop(t, out, f, v = 1) {
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    lp.type = 'lowpass';
    lp.Q.value = 6;
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + 1.1);
    g.gain.setValueAtTime(0.4 * v, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
    lp.connect(saturator(3)).connect(g).connect(out);

    [0, 12].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = cents;
      o.frequency.setValueAtTime(96, t);
      o.frequency.exponentialRampToValueAtTime(34, t + 1.1);
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.45);
    });

    tone(t, out, { type: 'sine', f0: 62, f1: 30, dur: 1.4, vol: 0.9 * v });
    burst(t, out, { type: 'lowpass', freq: 500, dur: 0.35, vol: 0.5 * v, send: 0.3 });
  },

  // Effet « stutter » : la même petite note répétée de plus en plus vite
  stutter(t, out, f, v = 1) {
    let at = 0;
    let gap = 0.07;

    for (let k = 0; k < 8; k++) {
      const up = 1 + k * 0.06;
      chord(t + at, out, [330 * up, 415 * up], { cutoff: 3500, cutoffEnd: 900, dur: gap * 0.9, vol: 0.5 * v, spread: 8 });
      at += gap;
      gap = Math.max(0.03, gap * 0.9);
    }
  },

  // Sirène « woop woop » : trois montées rapides
  woop(t, out, f, v = 1) {
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();

    lp.type = 'lowpass';
    lp.frequency.value = 2800;
    g.gain.setValueAtTime(0.16 * v, t);
    g.gain.setValueAtTime(0.16 * v, t + 0.55);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
    lp.connect(saturator(2)).connect(g).connect(out);
    wet(g, 0.15);

    [0, 14].forEach((cents) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = cents;

      for (let k = 0; k < 3; k++) {
        o.frequency.setValueAtTime(480, t + k * 0.22);
        o.frequency.exponentialRampToValueAtTime(1350, t + k * 0.22 + 0.2);
      }

      o.connect(lp);
      o.start(t);
      o.stop(t + 0.72);
    });
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
